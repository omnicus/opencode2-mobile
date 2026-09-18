import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "mobile-deployment-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const envFile = join(directory, ".env.preview");
  const githubEnv = join(directory, "github-env");
  const run = () =>
    spawnSync(process.execPath, [resolve("scripts/prepare-mobile-deployment.mjs"), envFile], {
      cwd: directory,
      env: { ...process.env, GITHUB_ENV: githubEnv },
      encoding: "utf8",
    });
  return { directory, envFile, githubEnv, run };
}

test("downloaded Firebase bytes and a stable relative path reach later publishing steps", (t) => {
  const { directory, envFile, githubEnv, run } = fixture(t);
  const downloaded = join(directory, "downloaded client.json");
  const content = '{"project_info":{"project_id":"fixture"}}\n';
  writeFileSync(downloaded, content);
  writeFileSync(envFile, `GOOGLE_SERVICES_JSON=${downloaded}\n`);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(directory, "google-services.json"), "utf8"), content);
  assert.equal(readFileSync(githubEnv, "utf8"), "GOOGLE_SERVICES_JSON=./google-services.json\n");
  assert.ok(!result.stdout.includes(content));
});

test("a build-only secret cannot silently produce a Firebase-free fingerprint", (t) => {
  const { envFile, githubEnv, run } = fixture(t);
  writeFileSync(envFile, "# GOOGLE_SERVICES_JSON=***** (secret)\n");
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Sensitive/);
  assert.equal(existsSync(githubEnv), false);
});

test("a missing downloaded file stops publishing even when an old local copy exists", (t) => {
  const { directory, envFile, githubEnv, run } = fixture(t);
  writeFileSync(join(directory, "google-services.json"), "old file");
  writeFileSync(envFile, "GOOGLE_SERVICES_JSON=/missing/firebase-client.json\n");
  assert.notEqual(run().status, 0);
  assert.equal(existsSync(githubEnv), false);
});

test("deployments without Firebase need no file variable", (t) => {
  const { envFile, githubEnv, run } = fixture(t);
  writeFileSync(envFile, "OPENCODE2_MOBILE_APP_SLUG=fixture\n");
  assert.equal(run().status, 0);
  assert.equal(existsSync(githubEnv), false);
});
