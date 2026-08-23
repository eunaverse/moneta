import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authGatePath = new URL("../components/moneta-auth-gate.tsx", import.meta.url);
const stylesPath = new URL("../app/globals.css", import.meta.url);

test("the sign-in screen leads with Moneta's planning promise and plain-language trust copy", async () => {
  const [authGate, styles] = await Promise.all([
    readFile(authGatePath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(authGate, /className="auth-brand"/);
  assert.match(authGate, />MONETA</);
  assert.match(authGate, /Know what you can spend/);
  assert.match(authGate, /monthly spending target/);
  assert.match(authGate, /Your financial data stays private to your account/);
  assert.doesNotMatch(authGate, /Your finances,[\s\S]*available anywhere/);
  assert.match(styles, /\.auth-card > small[^}]*font-size:\s*12px/);
});
