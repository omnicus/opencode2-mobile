import assert from "node:assert/strict";
import { test } from "node:test";

import { newerVersion, stableV2 } from "./opencode-release.mjs";

test("release detection compares numeric components and never downgrades", () => {
  assert.equal(newerVersion("2.0.10", "2.0.9"), true);
  assert.equal(newerVersion("2.1.0", "2.0.99"), true);
  assert.equal(newerVersion("2.0.3", "2.0.3"), false);
  assert.equal(newerVersion("2.0.3", "2.0.7"), false);
});

test("release automation rejects other majors, prereleases and command input", () => {
  for (const version of [
    "1.18.0",
    "3.0.0",
    "2.0.8-beta.1",
    "latest",
    "2.0.7\ncommand",
    "2.0.7;command",
    undefined,
  ]) {
    assert.equal(stableV2(version), false);
  }
  assert.throws(() => newerVersion("3.0.0", "2.0.7"));
});
