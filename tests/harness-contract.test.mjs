import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const read = (path) => readFile(new URL(path, root), "utf8");

test("package scripts expose the TDD, full E2E, verification, and PR gates", async () => {
  const pkg = JSON.parse(await read("package.json"));

  assert.equal(pkg.scripts["test:unit"], "node --experimental-strip-types --test tests/*.test.mjs");
  assert.equal(pkg.scripts["test:e2e"], "playwright test");
  assert.equal(pkg.scripts.verify, "node scripts/change-harness.mjs verify");
  assert.equal(pkg.scripts.pr, "node scripts/change-harness.mjs pr");
  assert.match(pkg.scripts.lint, /\.codex-conflict-worktrees/);
});

test("the repository documents and automates the mandatory change lifecycle", async () => {
  const [agents, harness, quality, deploy, gitignore] = await Promise.all([
    read("AGENTS.md"),
    read("scripts/change-harness.mjs"),
    read(".github/workflows/quality.yml"),
    read(".github/workflows/deploy-cloudflare.yml"),
    read(".gitignore"),
  ]);

  assert.match(agents, /Red → Green → Refactor/);
  assert.match(agents, /npm run verify/);
  assert.match(agents, /pull request/i);
  assert.match(harness, /test:unit/);
  assert.match(harness, /test:e2e/);
  assert.match(harness, /"pr", "create"/);
  assert.match(harness, /"credential", "fill"/);
  assert.match(harness, /api\.github\.com/);
  assert.match(quality, /pull_request:/);
  assert.match(quality, /npm run verify/);
  assert.match(deploy, /npm run verify/);
  assert.match(gitignore, /\.codex-conflict-worktrees\//);
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
