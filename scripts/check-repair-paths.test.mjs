import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("repair path gate checks the original candidate, including agent-created commits", () => {
  const directory = mkdtempSync(join(tmpdir(), "mobile-repair-gate-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "Base");
    const base = git("rev-parse", "HEAD");
    const check = () =>
      spawnSync(process.execPath, [resolve("scripts/check-repair-paths.mjs"), base], {
        cwd: directory,
        encoding: "utf8",
      }).status;
    mkdirSync(join(directory, "apps/mobile/src"), { recursive: true });
    writeFileSync(join(directory, "apps/mobile/src/fix.ts"), "export const fix = true;\n");
    assert.equal(check(), 0);
    mkdirSync(join(directory, ".github/workflows"), { recursive: true });
    writeFileSync(join(directory, ".github/workflows/modified.yml"), "name: modified\n");
    assert.notEqual(check(), 0);
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-m", "Agent commit");
    assert.notEqual(check(), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
