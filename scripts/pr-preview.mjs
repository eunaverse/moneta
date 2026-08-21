#!/usr/bin/env node

import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const WORKER_NAME = "moneta";
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

export function parseVersionUpload(output, alias) {
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
  const upload = entries.findLast((entry) => entry.type === "version-upload");
  if (!upload?.version_id || upload.worker_name !== WORKER_NAME || !upload.preview_alias_url) {
    throw new Error("Wrangler did not return a Moneta preview version and alias URL.");
  }

  const previewUrl = new URL(upload.preview_alias_url);
  const expectedPrefix = `${alias}-${WORKER_NAME}.`;
  if (
    previewUrl.protocol !== "https:" ||
    !previewUrl.hostname.startsWith(expectedPrefix) ||
    !previewUrl.hostname.endsWith(".workers.dev")
  ) {
    throw new Error("Wrangler returned an unexpected preview alias URL.");
  }

  return { versionId: upload.version_id, previewUrl: previewUrl.origin };
}

export function selectPreviewVersions(versions, prNumber, keepVersionId) {
  const tag = previewTag(prNumber);
  return versions.filter((version) => (
    version?.id &&
    version.id !== keepVersionId &&
    version.annotations?.["workers/tag"] === tag
  ));
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

const cloudflareRequest = async (path, { method = "GET" } = {}) => {
  const accountId = required(process.env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const token = required(process.env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const codes = Array.isArray(payload.errors)
      ? payload.errors.map(({ code }) => code).filter(Boolean).join(", ")
      : "unknown";
    throw new Error(`Cloudflare API request failed (${response.status}; codes: ${codes}).`);
  }
  return payload;
};

const listWorkerVersions = async () => {
  const versions = [];
  for (let page = 1; page <= 50; page += 1) {
    const payload = await cloudflareRequest(
      `/workers/workers/${WORKER_NAME}/versions?page=${page}&per_page=100`,
    );
    const pageVersions = Array.isArray(payload.result)
      ? payload.result
      : Array.isArray(payload.result?.items)
        ? payload.result.items
        : [];
    versions.push(...pageVersions);
    const totalPages = Number(payload.result_info?.total_pages ?? 1);
    if (page >= totalPages || pageVersions.length === 0) break;
  }
  return versions;
};

const cleanupPreviewVersions = async (prNumber, keepVersionId) => {
  const versions = await listWorkerVersions();
  const targets = selectPreviewVersions(versions, prNumber, keepVersionId);
  for (const { id } of targets) {
    await cloudflareRequest(`/workers/workers/${WORKER_NAME}/versions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  return targets.length;
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
  const alias = previewAlias(prNumber);
  const sha = required(process.env.PREVIEW_HEAD_SHA, "PREVIEW_HEAD_SHA").slice(0, 12);
  const configPath = "dist/server/wrangler.json";
  await readFile(configPath, "utf8");

  const result = await withSecretFile(process.env.MONETA_TRANSACTION_AI_TOKEN, async (secretPath, directory) => {
    const outputPath = join(directory, "wrangler-output.jsonl");
    const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
    const invocation = spawnSync(wrangler, [
      "versions", "upload",
      "--config", configPath,
      "--preview-alias", alias,
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
    if (invocation.status !== 0) throw new Error(`Wrangler preview upload failed (${invocation.status ?? "unknown"}).`);
    return parseVersionUpload(await readFile(outputPath, "utf8"), alias);
  });

  const deletedCount = await cleanupPreviewVersions(prNumber, result.versionId);
  await writeOutputs({
    preview_url: result.previewUrl,
    version_id: result.versionId,
    stale_versions_deleted: deletedCount,
  });
  console.log(`Uploaded ${alias} without changing production traffic; removed ${deletedCount} stale version(s).`);
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
  const expectedPrefix = `${previewAlias(process.env.PR_NUMBER)}-${WORKER_NAME}.`;
  if (!previewUrl.hostname.startsWith(expectedPrefix) || !previewUrl.hostname.endsWith(".workers.dev")) {
    throw new Error("PREVIEW_URL is not a Moneta Workers preview alias.");
  }
  const versionId = required(process.env.VERSION_ID, "VERSION_ID");
  const body = `${COMMENT_MARKER}\n## Moneta PR preview\n\n` +
    `- Preview: ${previewUrl.origin}\n` +
    `- Worker version: \`${versionId}\`\n` +
    `- Database: isolated preview Supabase project (never production)\n\n` +
    `The alias is updated after the full quality gate passes. Cloudflare Access may require sign-in.`;
  await upsertPreviewComment(body);
  await appendFile(
    required(process.env.GITHUB_STEP_SUMMARY, "GITHUB_STEP_SUMMARY"),
    `## Moneta PR preview\n\n[Open the isolated preview](${previewUrl.origin})\n\n` +
      `Worker version: \`${versionId}\`\n`,
    "utf8",
  );
  console.log("Published the preview URL to the PR and job summary.");
};

const cleanupCommand = async () => {
  const prNumber = required(process.env.PR_NUMBER, "PR_NUMBER");
  const deletedCount = await cleanupPreviewVersions(prNumber);
  await writeOutputs({ deleted_count: deletedCount });
  console.log(`Deleted ${deletedCount} tagged preview version(s) for ${previewAlias(prNumber)}.`);
};

const publishClosedCommand = async () => {
  const deletedCount = Number(process.env.DELETED_COUNT ?? 0);
  await deactivatePreviewDeployments();
  const body = `${COMMENT_MARKER}\n## Moneta PR preview closed\n\n` +
    `The PR preview is no longer active. ${deletedCount} tagged Cloudflare version(s) were deleted. ` +
    `The shared preview Supabase project remains isolated from production and contains no production data.`;
  await upsertPreviewComment(body);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(summaryPath, `## Moneta PR preview cleanup\n\nDeleted ${deletedCount} tagged version(s).\n`, "utf8");
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
