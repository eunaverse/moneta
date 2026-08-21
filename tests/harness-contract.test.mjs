import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const read = (path) => readFile(new URL(path, root), "utf8");

test("package scripts expose the TDD, full E2E, verification, and PR gates", async () => {
  const pkg = JSON.parse(await read("package.json"));

  assert.equal(pkg.scripts["test:unit"], "node --experimental-strip-types --test tests/*.test.mjs");
  assert.equal(pkg.scripts["test:ai:live"], "node --experimental-strip-types tests/ai-transaction-live-eval.mjs");
  assert.equal(pkg.scripts["test:e2e"], "playwright test");
  assert.equal(pkg.scripts.verify, "node scripts/change-harness.mjs verify");
  assert.equal(pkg.scripts.pr, "node scripts/change-harness.mjs pr");
  assert.match(pkg.scripts.lint, /\.codex-conflict-worktrees/);
});

test("the repository documents and automates the mandatory change lifecycle", async () => {
  const [agents, harness, quality, deploy, productionDeploy, gitignore] = await Promise.all([
    read("AGENTS.md"),
    read("scripts/change-harness.mjs"),
    read(".github/workflows/quality.yml"),
    read(".github/workflows/deploy-cloudflare.yml"),
    read("scripts/production-deploy.mjs"),
    read(".gitignore"),
  ]);

  assert.match(agents, /Red → Green → Refactor/);
  assert.match(agents, /npm run verify/);
  assert.match(agents, /pull request/i);
  assert.match(agents, /live model output/i);
  assert.match(agents, /mock[^.]+not[^.]+substitute/i);
  assert.match(harness, /test:unit/);
  assert.match(harness, /test:ai:live/);
  assert.match(harness, /test:e2e/);
  assert.match(harness, /"pr", "create"/);
  assert.match(harness, /"credential", "fill"/);
  assert.match(harness, /api\.github\.com/);
  assert.match(quality, /pull_request:/);
  assert.match(quality, /npm run verify/);
  assert.match(quality, /MONETA_TRANSACTION_AI_TOKEN/);
  assert.match(deploy, /npm run verify/);
  assert.match(deploy, /MONETA_TRANSACTION_AI_TOKEN/);
  assert.match(deploy, /run: node scripts\/production-deploy\.mjs/);
  assert.doesNotMatch(deploy, /cloudflare\/wrangler-action/);
  assert.doesNotMatch(deploy, /secrets:\s*\|/);
  assert.match(productionDeploy, /withSecretFile/);
  assert.match(productionDeploy, /--secrets-file/);
  assert.match(productionDeploy, /dist\/server\/wrangler\.json/);
  assert.match(gitignore, /\.codex-conflict-worktrees\//);
});

test("every AI feature has an executable live-output eval", async () => {
  const { aiFeatures } = await import("./ai-feature-inventory.mjs");
  assert.ok(aiFeatures.length >= 1, "keep a live-eval inventory for AI behavior");

  const ids = new Set();
  for (const feature of aiFeatures) {
    assert.ok(feature.id && feature.journey && feature.eval);
    assert.equal(ids.has(feature.id), false, `duplicate AI feature id: ${feature.id}`);
    ids.add(feature.id);
    await access(new URL(feature.eval, root));
  }
});

test("production deploy binds the AI secret to the same Worker version and removes the temporary file", async () => {
  const { deployProduction } = await import("../scripts/production-deploy.mjs");
  let secretPath = "";
  let invocation;

  await deployProduction({
    environment: {
      CLOUDFLARE_API_TOKEN: "cloudflare-token",
      CLOUDFLARE_ACCOUNT_ID: "cloudflare-account",
      MONETA_TRANSACTION_AI_TOKEN: "ai-token",
    },
    spawn: (command, args, options) => {
      secretPath = args.at(-1);
      invocation = { command, args, options };
      assert.deepEqual(JSON.parse(readFileSync(secretPath, "utf8")), {
        MONETA_TRANSACTION_AI_TOKEN: "ai-token",
      });
      return { status: 0 };
    },
  });

  assert.match(invocation.command, /node_modules\/\.bin\/wrangler$/);
  assert.deepEqual(invocation.args.slice(0, 4), ["deploy", "--config", "dist/server/wrangler.json", "--secrets-file"]);
  assert.equal(invocation.options.env.CLOUDFLARE_ACCOUNT_ID, "cloudflare-account");
  assert.equal(existsSync(secretPath), false);
});

test("every product feature is assigned to an executable E2E spec", async () => {
  const { features } = await import("./e2e/feature-inventory.mjs");
  assert.ok(features.length >= 12, "keep a product-level feature inventory");

  const ids = new Set();
  for (const feature of features) {
    assert.ok(feature.id && feature.journey && feature.spec);
    assert.equal(ids.has(feature.id), false, `duplicate feature id: ${feature.id}`);
    ids.add(feature.id);
    await access(new URL(feature.spec, root));
  }
});
