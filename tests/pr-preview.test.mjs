import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("PR preview waits for the full gate and deploys only a PR-scoped Worker", async () => {
  const [workflow, helper] = await Promise.all([
    read(".github/workflows/quality.yml"),
    read("scripts/pr-preview.mjs"),
  ]);

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /opened/);
  assert.match(workflow, /synchronize/);
  assert.match(workflow, /closed/);
  assert.match(workflow, /needs:\s*verify/);
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /vars\.PR_PREVIEW_ENABLED == 'true'/);
  assert.match(workflow, /vars\.PR_PREVIEW_ACCESS_REVIEWED == 'true'/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(helper, /"deploy"/);
  assert.match(helper, /--name/);
  assert.match(helper, /previewWorkerName/);
  assert.doesNotMatch(helper, /versions", "upload/);
  assert.doesNotMatch(helper, /--preview-alias/);
});

test("preview builds can only use the dedicated Supabase project and a server-side AI secret", async () => {
  const [workflow, helper] = await Promise.all([
    read(".github/workflows/quality.yml"),
    read("scripts/pr-preview.mjs"),
  ]);

  assert.match(workflow, /VITE_SUPABASE_URL:\s*\$\{\{ secrets\.PREVIEW_SUPABASE_URL \}\}/);
  assert.match(workflow, /VITE_SUPABASE_ANON_KEY:\s*\$\{\{ secrets\.PREVIEW_SUPABASE_ANON_KEY \}\}/);
  assert.match(workflow, /PREVIEW_SUPABASE_PROJECT_REF:\s*\$\{\{ vars\.PR_PREVIEW_SUPABASE_PROJECT_REF \}\}/);
  assert.match(workflow, /PRODUCTION_SUPABASE_PROJECT_REF:\s*\$\{\{ vars\.PRODUCTION_SUPABASE_PROJECT_REF \}\}/);
  assert.doesNotMatch(workflow, /secrets\.VITE_SUPABASE_URL/);
  assert.doesNotMatch(workflow, /secrets\.VITE_SUPABASE_ANON_KEY/);
  assert.match(workflow, /MONETA_TRANSACTION_AI_TOKEN:\s*\$\{\{ secrets\.MONETA_TRANSACTION_AI_TOKEN \}\}/);
  assert.match(helper, /--secrets-file/);
  assert.doesNotMatch(workflow, /echo[^\n]*MONETA_TRANSACTION_AI_TOKEN/);
});

test("preview URL publication and close cleanup are first-class workflow behavior", async () => {
  const [workflow, helper] = await Promise.all([
    read(".github/workflows/quality.yml"),
    read("scripts/pr-preview.mjs"),
  ]);

  assert.match(workflow, /environment:/);
  assert.match(workflow, /url:\s*\$\{\{ steps\.upload\.outputs\.preview_url \}\}/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /publish/);
  assert.match(workflow, /github\.event\.action == 'closed'/);
  assert.match(workflow, /cleanup/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /PREVIEW_HEAD_SHA:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(helper, /state:\s*"inactive"/);
  assert.match(helper, /public unless Cloudflare Access is separately enabled/i);
  assert.match(helper, /synthetic data only/i);
});

test("Wrangler makes previews explicit and refuses versions without the AI secret", async () => {
  const config = JSON.parse(await read("wrangler.jsonc"));

  assert.equal(config.name, "moneta");
  assert.equal(config.preview_urls, true);
  assert.deepEqual(config.secrets?.required, ["MONETA_TRANSACTION_AI_TOKEN"]);
});

test("preview helpers validate project identity and accept only the PR-scoped Worker deploy target", async () => {
  const {
    createCloudflareRequest,
    deletePreviewWorker,
    parsePreviewDeploy,
    previewAlias,
    previewWorkerName,
    validatePreviewSupabase,
  } = await import("../scripts/pr-preview.mjs");

  assert.equal(previewAlias("42"), "pr-42");
  assert.equal(previewWorkerName("42"), "pr-42-moneta");
  assert.throws(() => previewAlias("not-a-number"), /PR number/);
  assert.deepEqual(validatePreviewSupabase({
    url: "https://previewref.supabase.co",
    anonKey: "sb_publishable_example",
    projectRef: "previewref",
    productionProjectRef: "productionref",
  }), { url: "https://previewref.supabase.co", projectRef: "previewref" });
  assert.throws(() => validatePreviewSupabase({
    url: "https://productionref.supabase.co",
    anonKey: "sb_publishable_example",
    projectRef: "previewref",
    productionProjectRef: "productionref",
  }), /project ref/);
  assert.throws(() => validatePreviewSupabase({
    url: "https://productionref.supabase.co",
    anonKey: "sb_publishable_example",
    projectRef: "productionref",
    productionProjectRef: "productionref",
  }), /production Supabase project/);

  const upload = parsePreviewDeploy(`${JSON.stringify({
    type: "deploy",
    worker_name: "pr-42-moneta",
    version_id: "version-42",
    targets: ["https://pr-42-moneta.example.workers.dev"],
  })}\n`, "pr-42-moneta");
  assert.equal(upload.versionId, "version-42");
  assert.equal(upload.previewUrl, "https://pr-42-moneta.example.workers.dev");

  assert.throws(() => parsePreviewDeploy(`${JSON.stringify({
    type: "deploy",
    worker_name: "moneta",
    version_id: "production-version",
    targets: ["https://moneta.example.workers.dev"],
  })}\n`, "pr-42-moneta"), /PR-scoped Worker/);

  const requests = [];
  assert.equal(await deletePreviewWorker("42", async (path, options) => {
    requests.push({ path, options });
    return {};
  }), 1);
  assert.deepEqual(requests, [{
    path: "/workers/scripts/pr-42-moneta",
    options: { method: "DELETE", allowErrorCodes: [10007] },
  }]);

  assert.equal(await deletePreviewWorker("42", async () => ({ notFound: true })), 0);

  const request = createCloudflareRequest({
    environment: {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async () => new Response(JSON.stringify({
      success: false,
      errors: [{ code: 10007, message: "Worker not found" }],
    }), { status: 404, headers: { "content-type": "application/json" } }),
  });
  assert.deepEqual(await request("/workers/scripts/pr-42-moneta", {
    method: "DELETE",
    allowErrorCodes: [10007],
  }), { notFound: true });
  await assert.rejects(request("/workers/scripts/pr-42-moneta", { method: "DELETE" }), /404.*10007/);
});

test("the temporary Wrangler secret file is private and always removed", async () => {
  const { withSecretFile } = await import("../scripts/pr-preview.mjs");
  let filePath;

  await assert.rejects(
    withSecretFile("synthetic-secret", async (path) => {
      filePath = path;
      const contents = JSON.parse(await readFile(path, "utf8"));
      assert.equal(contents.MONETA_TRANSACTION_AI_TOKEN, "synthetic-secret");
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      throw new Error("exercise cleanup");
    }, join(tmpdir(), "moneta-preview-test-")),
    /exercise cleanup/,
  );
  await assert.rejects(access(filePath), /ENOENT/);
});

test("the runbook documents cost approval, narrow OAuth redirects, empty data, Access, and cleanup", async () => {
  const [runbook, readme] = await Promise.all([
    read("docs/engineering/pr-preview-environments.md"),
    read("README.md"),
  ]);

  assert.match(runbook, /\$0\.01344 per hour/);
  assert.match(runbook, /Spend Cap/);
  assert.match(runbook, /explicit approval/i);
  assert.match(runbook, /https:\/\/pr-\*-moneta\.<workers-dev-subdomain>\.workers\.dev\/\*\*/);
  assert.match(runbook, /https:\/\/<preview-project-ref>\.supabase\.co\/auth\/v1\/callback/);
  assert.match(runbook, /production data/i);
  assert.match(runbook, /synthetic|empty/i);
  assert.match(runbook, /Cloudflare Access/);
  assert.match(runbook, /protect the `pr-\*-moneta/);
  assert.match(runbook, /payment method/i);
  assert.match(runbook, /overage/i);
  assert.match(runbook, /Access was not activated/i);
  assert.match(runbook, /public preview/i);
  assert.match(runbook, /PR_PREVIEW_ACCESS_REVIEWED=true/);
  assert.match(runbook, /PR.*closed/i);
  assert.match(runbook, /PR-scoped Worker/i);
  assert.match(runbook, /wrangler deploy --name/i);
  assert.doesNotMatch(runbook, /Deleting every tagged target version/i);
  assert.match(readme, /PR preview/);
  assert.match(readme, /PR_PREVIEW_ENABLED/);
  assert.match(readme, /PR-scoped Worker/i);
  assert.doesNotMatch(readme, /never runs `wrangler deploy`/i);
});
