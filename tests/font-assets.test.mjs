import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("loads the self-hosted UI font through the application module graph", async () => {
  const [layout, globalStyles] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /import "@fontsource-variable\/manrope";/);
  assert.doesNotMatch(globalStyles, /@import "@fontsource-variable\/manrope";/);
});
