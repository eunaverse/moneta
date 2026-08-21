#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withSecretFile } from "./pr-preview.mjs";

const required = (value, name) => {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
};

export const productionDeployArgs = (secretPath) => [
  "deploy",
  "--config", "dist/server/wrangler.json",
  "--secrets-file", secretPath,
];

export async function deployProduction({ environment = process.env, spawn = spawnSync } = {}) {
  required(environment.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
  required(environment.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const secret = required(environment.MONETA_TRANSACTION_AI_TOKEN, "MONETA_TRANSACTION_AI_TOKEN");
  const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));

  await withSecretFile(secret, async (secretPath) => {
    const invocation = spawn(wrangler, productionDeployArgs(secretPath), {
      env: environment,
      stdio: "inherit",
    });
    if (invocation.status !== 0) {
      throw new Error(`Wrangler production deploy failed (${invocation.status ?? "unknown"}).`);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await deployProduction();
}
