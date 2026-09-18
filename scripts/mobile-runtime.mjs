import { createRequire } from "node:module";
import { resolve } from "node:path";

const project = resolve("apps/mobile");
const require = createRequire(resolve(project, "package.json"));
const expoRequire = createRequire(require.resolve("expo/package.json"));
const { createFingerprintAsync } = expoRequire("@expo/fingerprint");
const { getConfig } = expoRequire("@expo/config");
const { exp } = getConfig(project);
if (exp.runtimeVersion?.policy !== "appVersion")
  throw new Error("Review the OTA gate for this runtime policy.");
if (!exp.extra?.eas?.projectId || !exp.updates?.enabled)
  throw new Error("Configure the deployment's EAS project before fingerprinting.");

const hashes = {};
for (const platform of ["ios", "android"]) {
  const fingerprint = await createFingerprintAsync(project, {
    platforms: [platform],
    // SDK 54's default nested-node_modules exclusion also matches pnpm's store.
    // Include linked native packages, but still exclude their nested dependencies.
    ignorePaths: [
      "!**/node_modules/**/node_modules/**",
      "**/node_modules/.pnpm/*/node_modules/**/node_modules/**",
    ],
  });
  if (!fingerprint.sources.length || fingerprint.sources.some((source) => source.hash == null)) {
    throw new Error(`Incomplete ${platform} native fingerprint. Publication stopped.`);
  }
  hashes[platform] = fingerprint.hash;
}

if (process.argv.includes("--check")) {
  for (const [name, actual] of Object.entries({
    MOBILE_RUNTIME_VERSION: exp.version,
    MOBILE_IOS_NATIVE_HASH: hashes.ios,
    MOBILE_ANDROID_NATIVE_HASH: hashes.android,
  })) {
    if (!process.env[name])
      throw new Error(`Set ${name} from the installed signed build's source and EAS environment.`);
    if (process.env[name] !== actual)
      throw new Error(
        `${name} differs from the installed build. A native build and new baseline are required.`,
      );
  }
  console.log("Both native fingerprints and the installed runtime match.");
} else {
  // Hashes and version only. Fingerprint sources may contain deployment configuration.
  console.log(
    `MOBILE_RUNTIME_VERSION=${exp.version}\nMOBILE_IOS_NATIVE_HASH=${hashes.ios}\nMOBILE_ANDROID_NATIVE_HASH=${hashes.android}`,
  );
}
