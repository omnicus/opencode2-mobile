import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function stableV2(version) {
  return typeof version === "string" && /^2\.\d+\.\d+$/.test(version);
}

export function newerVersion(candidate, current) {
  if (!stableV2(candidate) || !stableV2(current))
    throw new Error("Expected stable OpenCode V2 versions.");
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

async function registry(packageName, version) {
  const response = await fetch(`https://registry.npmjs.org/${packageName}/${version}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Registry lookup failed for ${packageName}.`);
  return response.json();
}

async function main() {
  const path = "packages/opencode-adapter/package.json";
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const current = manifest.dependencies["@opencode/client"];
  const requested = process.env.OPENCODE_TARGET_VERSION;
  if (requested && !stableV2(requested)) throw new Error("Invalid target release.");
  const latest = await registry("@opencode/client", requested ?? "latest");
  if (!stableV2(latest.version))
    throw new Error("Latest client is outside the stable V2 release line.");
  const changed = newerVersion(latest.version, current);
  const target = changed ? latest.version : current;
  // Do not publish for a client whose corresponding server has not shipped yet.
  const server = await registry("@opencode/cli", target);
  if (server.version !== target) throw new Error("Matching V2 server is unavailable.");
  const outputs = { current, target, changed: String(changed) };
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  }
  if (process.argv.includes("--apply") && changed) {
    manifest.dependencies["@opencode/client"] = target;
    const adapterPath = "packages/opencode-adapter/src/index.ts";
    const source = readFileSync(adapterPath, "utf8");
    const expected = `export const openCodeClientContractVersion = "${current}";`;
    if (!source.includes(expected)) throw new Error("Adapter version and dependency disagree.");
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(
      adapterPath,
      source.replace(expected, `export const openCodeClientContractVersion = "${target}";`),
    );
  }
  console.log(JSON.stringify(outputs));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
