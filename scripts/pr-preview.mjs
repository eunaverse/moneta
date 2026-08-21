#!/usr/bin/env node

import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const WORKER_NAME = "moneta";
const SHARED_PREVIEW_WORKER_NAME = "review-moneta";
const COMMENT_MARKER = "<!-- moneta-pr-preview -->";

const required = (value, name) => {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
};

export function previewAlias(prNumber) {
  const value = String(prNumber ?? "").trim();
  if (!/^[1-9]\d*$/.test(value)) throw new Error("A numeric PR number is required.");
  return `pr-${value}`;
}

export const sharedPreviewWorkerName = () => SHARED_PREVIEW_WORKER_NAME;

const previewTag = (prNumber) => `moneta-${previewAlias(prNumber)}`;

export function validatePreviewSupabase({ url, anonKey, projectRef, productionProjectRef }) {
  const expectedRef = required(projectRef, "PREVIEW_SUPABASE_PROJECT_REF");
  const productionRef = required(productionProjectRef, "PRODUCTION_SUPABASE_PROJECT_REF");
  if (!/^[a-z0-9]+$/.test(expectedRef)) throw new Error("The preview Supabase project ref is invalid.");
  if (!/^[a-z0-9]+$/.test(productionRef)) throw new Error("The production Supabase project ref is invalid.");
  if (expectedRef === productionRef) throw new Error("Preview deployment cannot use the production Supabase project.");
  required(anonKey, "PREVIEW_SUPABASE_ANON_KEY");

  let parsed;
  try {
    parsed = new URL(required(url, "PREVIEW_SUPABASE_URL"));
  } catch {
    throw new Error("The preview Supabase URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== `${expectedRef}.supabase.co` ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("The preview Supabase URL does not match the approved preview project ref.");
  }

  return { url: parsed.origin, projectRef: expectedRef };
}

export function parsePreviewDeploy(output, workerName) {
  const entries = String(output)
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const upload = entries.findLast((entry) => entry.type === "deploy");
  if (!upload?.version_id || upload.worker_name !== workerName || !Array.isArray(upload.targets)) {
    throw new Error("Wrangler did not return the expected shared preview Worker deployment.");
  }

  const target = upload.targets.find((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        url.hostname.startsWith(`${workerName}.`) &&
        url.hostname.endsWith(".workers.dev") &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash;
    } catch {
      return false;
    }
  });
  if (!target) {
    throw new Error("Wrangler did not return the shared preview Worker URL.");
  }

  const previewUrl = new URL(target);
  return { versionId: upload.version_id, previewUrl: previewUrl.origin };
}

export async function withSecretFile(secret, callback, temporaryPrefix = join(tmpdir(), "moneta-preview-")) {
  const directory = await mkdtemp(temporaryPrefix);
  const path = join(directory, "worker-secrets.json");
  try {
    await writeFile(path, JSON.stringify({ MONETA_TRANSACTION_AI_TOKEN: required(secret, "MONETA_TRANSACTION_AI_TOKEN") }), {
      encoding: "utf8",
      mode: 0o600,
    });
    return await callback(path, directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export const createCloudflareRequest = ({ fetchImpl = fetch, environment = process.env } = {}) => (
  async (path, { method = "GET", allowErrorCodes = [] } = {}) => {
    const accountId = required(environment.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
    const token = required(environment.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));
    const errorCodes = Array.isArray(payload.errors)
      ? payload.errors.map(({ code }) => code).filter(Boolean)
      : [];
    if (response.status === 404 && errorCodes.some((code) => allowErrorCodes.includes(code))) {
      return { notFound: true };
    }
    if (!response.ok || payload.success === false) {
      const codes = errorCodes.join(", ") || "unknown";
      throw new Error(`Cloudflare API request failed (${response.status}; codes: ${codes}).`);
    }
    return payload;
  }
);

const cloudflareRequest = createCloudflareRequest();

export const deleteSharedPreviewWorkerIfOwned = async (prNumber, request = cloudflareRequest) => {
  const expectedTag = previewTag(prNumber);
  const workerPath = `/workers/scripts/${encodeURIComponent(SHARED_PREVIEW_WORKER_NAME)}`;
  const settings = await request(`${workerPath}/settings`, {
    allowErrorCodes: [10007],
  });
  if (settings.notFound) return { deletedCount: 0, status: "absent" };
  if (settings.result?.annotations?.["workers/tag"] !== expectedTag) {
    return { deletedCount: 0, status: "not-owner" };
  }

  const result = await request(workerPath, {
    method: "DELETE",
    allowErrorCodes: [10007],
  });
  return result.notFound
    ? { deletedCount: 0, status: "absent" }
    : { deletedCount: 1, status: "deleted" };
};

const writeOutputs = async (values) => {
  const outputPath = required(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT");
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  await appendFile(outputPath, `${lines}\n`, "utf8");
};

const validateCommand = () => {
  validatePreviewSupabase({
    url: process.env.VITE_SUPABASE_URL,
    anonKey: process.env.VITE_SUPABASE_ANON_KEY,
    projectRef: process.env.PREVIEW_SUPABASE_PROJECT_REF,
    productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  });
  console.log("Preview configuration targets the approved isolated Supabase project.");
};

const uploadCommand = async () => {
  validateCommand();
  const prNumber = required(process.env.PR_NUMBER, "PR_NUMBER");
  const workerName = SHARED_PREVIEW_WORKER_NAME;
  const sha = required(process.env.PREVIEW_HEAD_SHA, "PREVIEW_HEAD_SHA").slice(0, 12);
  const configPath = "dist/server/wrangler.json";
  await readFile(configPath, "utf8");

  const result = await withSecretFile(process.env.MONETA_TRANSACTION_AI_TOKEN, async (secretPath, directory) => {
    const outputPath = join(directory, "wrangler-output.jsonl");
    const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
    const invocation = spawnSync(wrangler, [
      "deploy",
      "--config", configPath,
      "--name", workerName,
      "--tag", previewTag(prNumber),
      "--message", `PR #${prNumber} ${sha}`,
      "--secrets-file", secretPath,
    ], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
        WRANGLER_OUTPUT_FILE_PATH: outputPath,
      },
      stdio: "inherit",
    });
    if (invocation.status !== 0) throw new Error(`Wrangler preview deploy failed (${invocation.status ?? "unknown"}).`);
    return parsePreviewDeploy(await readFile(outputPath, "utf8"), workerName);
  });

  await writeOutputs({
    preview_url: result.previewUrl,
    version_id: result.versionId,
  });
  console.log(`Deployed ${workerName} without changing the production ${WORKER_NAME} Worker.`);
};

const githubRequest = async (path, { method = "GET", body } = {}) => {
  const token = required(process.env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status}).`);
  return payload;
};

const repositoryParts = () => {
  const [owner, repository, extra] = required(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY").split("/");
  if (!owner || !repository || extra) throw new Error("GITHUB_REPOSITORY is invalid.");
  return { owner, repository };
};

const upsertPreviewComment = async (body) => {
  const { owner, repository } = repositoryParts();
  const prNumber = previewAlias(process.env.PR_NUMBER).slice(3);
  const comments = await githubRequest(
    `/repos/${owner}/${repository}/issues/${prNumber}/comments?per_page=100`,
  );
  const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
  if (existing) {
    await githubRequest(`/repos/${owner}/${repository}/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: { body },
    });
  } else {
    await githubRequest(`/repos/${owner}/${repository}/issues/${prNumber}/comments`, {
      method: "POST",
      body: { body },
    });
  }
};

const deactivatePreviewDeployments = async () => {
  const { owner, repository } = repositoryParts();
  const sha = required(process.env.PREVIEW_HEAD_SHA, "PREVIEW_HEAD_SHA");
  const deployments = await githubRequest(
    `/repos/${owner}/${repository}/deployments?sha=${encodeURIComponent(sha)}&environment=pr-preview&per_page=100`,
  );
  for (const deployment of deployments) {
    await githubRequest(`/repos/${owner}/${repository}/deployments/${deployment.id}/statuses`, {
      method: "POST",
      body: { state: "inactive" },
    });
  }
};

const publishCommand = async () => {
  const previewUrl = new URL(required(process.env.PREVIEW_URL, "PREVIEW_URL"));
  const prNumber = previewAlias(process.env.PR_NUMBER).slice(3);
  const expectedPrefix = `${SHARED_PREVIEW_WORKER_NAME}.`;
  if (!previewUrl.hostname.startsWith(expectedPrefix) || !previewUrl.hostname.endsWith(".workers.dev")) {
    throw new Error("PREVIEW_URL is not the shared preview Worker.");
  }
  const versionId = required(process.env.VERSION_ID, "VERSION_ID");
  const body = `${COMMENT_MARKER}\n## Moneta PR preview\n\n` +
    `- Preview: ${previewUrl.origin}\n` +
    `- Active PR: #${prNumber}\n` +
    `- Worker version: \`${versionId}\`\n` +
    `- Database: isolated preview Supabase project (never production)\n\n` +
    `This shared Worker was updated after the full quality gate and manual deployment approval. A later approved PR replaces what this same URL serves. This URL is public unless Cloudflare Access is separately enabled. Use synthetic data only.`;
  await upsertPreviewComment(body);
  await appendFile(
    required(process.env.GITHUB_STEP_SUMMARY, "GITHUB_STEP_SUMMARY"),
    `## Moneta PR preview\n\n[Open the isolated preview](${previewUrl.origin})\n\n` +
      `Active PR: #${prNumber}\n\nWorker version: \`${versionId}\`\n\n` +
      `A later approved PR replaces what this same URL serves. This URL is public unless Cloudflare Access is separately enabled. Use synthetic data only.\n`,
    "utf8",
  );
  console.log("Published the preview URL to the PR and job summary.");
};

const cleanupCommand = async () => {
  const prNumber = required(process.env.PR_NUMBER, "PR_NUMBER");
  const result = await deleteSharedPreviewWorkerIfOwned(prNumber);
  await writeOutputs({ deleted_count: result.deletedCount, cleanup_status: result.status });
  if (result.status === "deleted") {
    console.log(`Deleted the ${SHARED_PREVIEW_WORKER_NAME} shared preview Worker owned by PR #${prNumber}.`);
  } else if (result.status === "not-owner") {
    console.log(`PR #${prNumber} is not the active shared preview owner; leaving ${SHARED_PREVIEW_WORKER_NAME} unchanged.`);
  } else {
    console.log(`The ${SHARED_PREVIEW_WORKER_NAME} shared preview Worker was already absent.`);
  }
};

const publishClosedCommand = async () => {
  const cleanupStatus = process.env.CLEANUP_STATUS ?? (Number(process.env.DELETED_COUNT ?? 0) ? "deleted" : "absent");
  await deactivatePreviewDeployments();
  const cleanupDescription = cleanupStatus === "deleted"
    ? "This PR owned the active shared Worker, so it was deleted."
    : cleanupStatus === "not-owner"
      ? "A different approved PR owns the shared Worker, so it was left unchanged."
      : "The shared Worker was already absent.";
  const body = `${COMMENT_MARKER}\n## Moneta PR preview closed\n\n` +
    `${cleanupDescription} ` +
    `The shared preview Supabase project remains isolated from production and contains no production data.`;
  await upsertPreviewComment(body);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(summaryPath, `## Moneta PR preview cleanup\n\n${cleanupDescription}\n`, "utf8");
  }
};

const command = process.argv[2];
if (command === "validate") validateCommand();
else if (command === "upload") await uploadCommand();
else if (command === "publish") await publishCommand();
else if (command === "cleanup") await cleanupCommand();
else if (command === "publish-closed") await publishClosedCommand();
else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.error("Usage: node scripts/pr-preview.mjs <validate|upload|publish|cleanup|publish-closed>");
  process.exit(2);
}
