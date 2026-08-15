#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const output = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
};

const verify = () => {
  const steps = [
    ["npm", ["run", "lint"]],
    ["npm", ["run", "build"]],
    ["npm", ["run", "test:unit"]],
    ["npm", ["run", "test:e2e"]],
  ];
  for (const [command, args] of steps) run(command, args);
};

const githubRepository = () => {
  const remote = output("git", ["remote", "get-url", "origin"]);
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) throw new Error("Origin is not a GitHub repository.");
  return { owner: match[1], repository: match[2] };
};

const gitCredential = () => {
  const result = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) return null;
  const values = Object.fromEntries(result.stdout.trim().split("\n").flatMap((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
  }));
  return values.username && values.password ? values : null;
};

const createWithGitHubApi = async ({ base, branch }) => {
  const credential = gitCredential();
  if (!credential) throw new Error("GitHub CLI auth failed and no Git credential is available.");
  const { owner, repository } = githubRepository();
  const authorization = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: authorization,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const api = `https://api.github.com/repos/${owner}/${repository}`;
  const existing = await fetch(`${api}/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${branch}`)}`, { headers });
  if (existing.ok) {
    const pulls = await existing.json();
    if (pulls[0]?.html_url) return pulls[0].html_url;
  }

  const title = process.env.PR_TITLE || output("git", ["log", "-1", "--pretty=%s"]);
  const body = process.env.PR_BODY || "## Summary\n\nCreated by the Moneta change harness.\n\n## Validation\n\n- `npm run verify`";
  const response = await fetch(`${api}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title, body, head: branch, base }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.html_url) throw new Error(`GitHub API could not create the PR (${response.status}).`);
  return payload.html_url;
};

const createPullRequest = async () => {
  const base = process.env.PR_BASE || "main";
  const branch = output("git", ["branch", "--show-current"]);
  if (!branch || branch === base || branch === "master") {
    console.error(`Refusing to create a PR from protected branch: ${branch || "unknown"}`);
    process.exit(1);
  }
  if (output("git", ["status", "--porcelain"])) {
    console.error("Commit the change before creating its pull request.");
    process.exit(1);
  }

  verify();
  run("git", ["push", "-u", "origin", branch]);

  const existing = spawnSync("gh", ["pr", "view", branch, "--json", "url", "--jq", ".url"], { encoding: "utf8", shell: false });
  if (existing.status === 0 && existing.stdout.trim()) {
    console.log(existing.stdout.trim());
    return;
  }
  const created = spawnSync("gh", ["pr", "create", "--base", base, "--head", branch, "--fill"], { encoding: "utf8", shell: false });
  if (created.status === 0 && created.stdout.trim()) {
    console.log(created.stdout.trim().split("\n").at(-1));
    return;
  }
  console.log(await createWithGitHubApi({ base, branch }));
};

const command = process.argv[2] || "verify";
if (command === "verify") verify();
else if (command === "pr") await createPullRequest();
else {
  console.error("Usage: node scripts/change-harness.mjs <verify|pr>");
  process.exit(2);
}
