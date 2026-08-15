import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("vinext resolves an image-size version without the known infinite-loop advisories", async () => {
  const [pkg, lock] = await Promise.all([
    readJson("package.json"),
    readJson("package-lock.json"),
  ]);

  assert.equal(pkg.devDependencies.vinext, "1.0.0-beta.6");
  assert.equal(pkg.devDependencies["@vitejs/plugin-rsc"], "0.5.34");
  const version = lock.packages["node_modules/image-size"]?.version;
  if (!version) return;
  const [major, minor, patch] = version.split(".").map(Number);
  assert.ok(
    major > 2 || (major === 2 && (minor > 0 || patch > 2)),
    `image-size ${version} is affected by GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq`,
  );
});
