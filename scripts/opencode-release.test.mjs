import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { newerVersion, stableV2 } from "./opencode-release.mjs";

const run = promisify(execFile);
const releaseScript = fileURLToPath(new URL("./opencode-release.mjs", import.meta.url));

async function runRelease(
  t,
  mockFetch,
  {
    adapterMode = 0o644,
    adapterVersion = "2.1.0",
    args = ["--apply"],
    githubOutput = true,
    targetVersion,
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "opencode-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "packages/opencode-adapter/src"), { recursive: true });
  await writeFile(
    join(directory, "packages/opencode-adapter/package.json"),
    JSON.stringify({ dependencies: { "@opencode/client": "2.1.0" } }),
  );
  if (adapterVersion !== null) {
    await writeFile(
      join(directory, "packages/opencode-adapter/src/index.ts"),
      `export const openCodeClientContractVersion = "${adapterVersion}";\n`,
      { mode: adapterMode },
    );
  }
  const output = join(directory, "output");
  const result = run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import assert from "node:assert/strict";
       import { pathToFileURL } from "node:url";
       delete process.env.OPENCODE_TARGET_VERSION;
       ${targetVersion === undefined ? "" : `process.env.OPENCODE_TARGET_VERSION = ${JSON.stringify(targetVersion)};`}
       process.argv = [process.execPath, ${JSON.stringify(releaseScript)}, ...${JSON.stringify(args)}];
       ${mockFetch}
       await import(pathToFileURL(process.argv[1]).href);`,
    ],
    {
      cwd: directory,
      env: { ...process.env, GITHUB_OUTPUT: githubOutput ? output : "" },
    },
  );
  return { directory, output, result };
}

async function assertUnchanged(directory, adapterVersion = "2.1.0") {
  const manifest = JSON.parse(
    await readFile(join(directory, "packages/opencode-adapter/package.json"), "utf8"),
  );
  assert.equal(manifest.dependencies["@opencode/client"], "2.1.0");
  assert.equal(
    await readFile(join(directory, "packages/opencode-adapter/src/index.ts"), "utf8"),
    `export const openCodeClientContractVersion = "${adapterVersion}";\n`,
  );
}

function registryVersions(client, server = client) {
  return `globalThis.fetch = async (url) => {
    if (url === "https://registry.npmjs.org/@opencode/client/latest")
      return Response.json({ version: ${JSON.stringify(client)} });
    assert.match(url, /^https:\\/\\/registry\\.npmjs\\.org\\/@opencode\\/cli\\/2\\.\\d+\\.\\d+$/);
    return Response.json({ version: ${JSON.stringify(server)} });
  };`;
}

test("release detection recovers from a transient registry timeout before applying", async (t) => {
  const { directory, output, result } = await runRelease(
    t,
    `let attempts = 0;
     globalThis.fetch = async (url, options) => {
       assert.ok(options.signal instanceof AbortSignal);
       if (++attempts === 1) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
       assert.equal(url, attempts === 2
         ? "https://registry.npmjs.org/@opencode/client/latest"
         : "https://registry.npmjs.org/@opencode/cli/2.1.2");
       return Response.json({ version: "2.1.2" });
     };`,
  );
  const { stdout } = await result;
  assert.deepEqual(JSON.parse(stdout), { current: "2.1.0", target: "2.1.2", changed: "true" });
  assert.equal(await readFile(output, "utf8"), "current=2.1.0\ntarget=2.1.2\nchanged=true\n");
  const manifest = JSON.parse(
    await readFile(join(directory, "packages/opencode-adapter/package.json"), "utf8"),
  );
  assert.equal(manifest.dependencies["@opencode/client"], "2.1.2");
  assert.equal(
    await readFile(join(directory, "packages/opencode-adapter/src/index.ts"), "utf8"),
    'export const openCodeClientContractVersion = "2.1.2";\n',
  );
});

for (const failure of ["network", "body timeout", 408, 429, 503]) {
  test(`release detection retries a transient ${failure} failure for the matching server`, async (t) => {
    const { result } = await runRelease(
      t,
      `let attempts = 0;
       const signals = new Set();
       globalThis.fetch = async (url, options) => {
         assert.ok(!signals.has(options.signal), "Each attempt needs a fresh timeout");
         signals.add(options.signal);
         if (url.endsWith("/latest")) return Response.json({ version: "2.1.2" });
         assert.equal(url, "https://registry.npmjs.org/@opencode/cli/2.1.2");
         if (++attempts === 1) {
           const failure = ${JSON.stringify(failure)};
           if (failure === "network") throw new TypeError("fetch failed");
           if (failure === "body timeout") return {
             ok: true,
             json: async () => { throw new DOMException("Timed out reading body", "AbortError"); },
           };
           return { ok: false, status: failure, body: { cancel: async () => { globalThis.cancelled = true; } } };
         }
         assert.equal(attempts, 2);
         if (typeof ${JSON.stringify(failure)} === "number") assert.equal(globalThis.cancelled, true);
         return Response.json({ version: "2.1.2" });
       };`,
    );
    const { stdout } = await result;
    assert.equal(JSON.parse(stdout).target, "2.1.2");
  });
}

for (const failure of ["timeout", 503, 404, "invalid JSON"]) {
  test(`release detection fails safely on ${failure} without outputs or edits`, async (t) => {
    const { directory, output, result } = await runRelease(
      t,
      `globalThis.fetch = async (url) => {
         if (url.endsWith("/latest")) return Response.json({ version: "2.1.2" });
         const failure = ${JSON.stringify(failure)};
         if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
         if (failure === "invalid JSON") return new Response("invalid");
         return new Response("Registry error", { status: failure });
       };`,
    );
    await assert.rejects(result, (error) => {
      const attempts = failure === "timeout" || failure === 503 ? 3 : 1;
      assert.match(
        error.stderr,
        new RegExp(
          `Registry lookup failed for @opencode/cli@2\\.1\\.2 after ${attempts} attempts?`,
        ),
      );
      return true;
    });
    await assert.rejects(readFile(output), { code: "ENOENT" });
    const manifest = JSON.parse(
      await readFile(join(directory, "packages/opencode-adapter/package.json"), "utf8"),
    );
    assert.equal(manifest.dependencies["@opencode/client"], "2.1.0");
    assert.equal(
      await readFile(join(directory, "packages/opencode-adapter/src/index.ts"), "utf8"),
      'export const openCodeClientContractVersion = "2.1.0";\n',
    );
  });
}

test("release detection applies a requested target release", async (t) => {
  const { directory, output, result } = await runRelease(
    t,
    `const urls = [];
     globalThis.fetch = async (url) => {
       urls.push(url);
       assert.deepEqual(urls, [
         "https://registry.npmjs.org/@opencode/client/2.1.1",
         "https://registry.npmjs.org/@opencode/cli/2.1.1",
       ].slice(0, urls.length));
       return Response.json({ version: "2.1.1" });
     };`,
    { targetVersion: "2.1.1" },
  );
  const { stdout } = await result;
  assert.deepEqual(JSON.parse(stdout), { current: "2.1.0", target: "2.1.1", changed: "true" });
  assert.equal(await readFile(output, "utf8"), "current=2.1.0\ntarget=2.1.1\nchanged=true\n");
  assert.equal(
    await readFile(join(directory, "packages/opencode-adapter/src/index.ts"), "utf8"),
    'export const openCodeClientContractVersion = "2.1.1";\n',
  );
});

for (const latest of ["2.1.0", "2.0.9"]) {
  test(`release detection keeps the current client when the registry offers ${latest}`, async (t) => {
    const { directory, output, result } = await runRelease(
      t,
      `globalThis.fetch = async (url) => {
         if (url.endsWith("/latest")) return Response.json({ version: ${JSON.stringify(latest)} });
         assert.equal(url, "https://registry.npmjs.org/@opencode/cli/2.1.0");
         return Response.json({ version: "2.1.0" });
       };`,
    );
    const { stdout } = await result;
    assert.deepEqual(JSON.parse(stdout), { current: "2.1.0", target: "2.1.0", changed: "false" });
    assert.equal(await readFile(output, "utf8"), "current=2.1.0\ntarget=2.1.0\nchanged=false\n");
    await assertUnchanged(directory);
  });
}

test("release detection only reports without --apply or a GitHub output file", async (t) => {
  const { directory, output, result } = await runRelease(t, registryVersions("2.1.2"), {
    args: [],
    githubOutput: false,
  });
  const { stdout } = await result;
  assert.deepEqual(JSON.parse(stdout), { current: "2.1.0", target: "2.1.2", changed: "true" });
  await assert.rejects(readFile(output), { code: "ENOENT" });
  await assertUnchanged(directory);
});

for (const [name, mockFetch, options, message] of [
  [
    "an invalid requested target",
    `globalThis.fetch = async () => assert.fail("Registry must not be queried");`,
    { targetVersion: "2.1.1\ncommand" },
    "Invalid target release.",
  ],
  [
    "a latest client outside V2",
    registryVersions("3.0.0"),
    {},
    "Latest client is outside the stable V2 release line.",
  ],
  [
    "a missing matching server",
    registryVersions("2.1.2", "2.1.1"),
    {},
    "Matching V2 server is unavailable.",
  ],
]) {
  test(`release detection rejects ${name} without outputs or edits`, async (t) => {
    const { directory, output, result } = await runRelease(t, mockFetch, options);
    await assert.rejects(result, (error) => {
      assert.equal(error.code, 1);
      assert.ok(error.stderr.includes(message), error.stderr);
      return true;
    });
    await assert.rejects(readFile(output), { code: "ENOENT" });
    await assertUnchanged(directory);
  });
}

test("release detection refuses to apply when the adapter version disagrees", async (t) => {
  const { directory, output, result } = await runRelease(t, registryVersions("2.1.2"), {
    adapterVersion: "2.0.9",
  });
  await assert.rejects(result, (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Adapter version and dependency disagree\./);
    return true;
  });
  await assert.rejects(readFile(output), { code: "ENOENT" });
  await assertUnchanged(directory, "2.0.9");
});

test("release detection writes no outputs when the adapter source is missing", async (t) => {
  const { directory, output, result } = await runRelease(t, registryVersions("2.1.2"), {
    adapterVersion: null,
  });
  await assert.rejects(result, (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /ENOENT/);
    return true;
  });
  await assert.rejects(readFile(output), { code: "ENOENT" });
  const manifest = JSON.parse(
    await readFile(join(directory, "packages/opencode-adapter/package.json"), "utf8"),
  );
  assert.equal(manifest.dependencies["@opencode/client"], "2.1.0");
});

test("release detection writes no outputs when the adapter cannot be updated", {
  skip: process.getuid?.() === 0 && "root ignores file permissions",
}, async (t) => {
  const { directory, output, result } = await runRelease(t, registryVersions("2.1.2"), {
    adapterMode: 0o444,
  });
  await assert.rejects(result, (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /EACCES/);
    return true;
  });
  await assert.rejects(readFile(output), { code: "ENOENT" });
  assert.equal(
    await readFile(join(directory, "packages/opencode-adapter/src/index.ts"), "utf8"),
    'export const openCodeClientContractVersion = "2.1.0";\n',
  );
});

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
