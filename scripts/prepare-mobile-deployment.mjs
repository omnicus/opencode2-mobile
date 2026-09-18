import { appendFileSync, copyFileSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Run from apps/mobile after eas env:pull. env:exec does not download file variables.
const envFile = process.argv[2];
if (!envFile) throw new Error("Pass the environment file written by eas env:pull.");
const contents = readFileSync(envFile, "utf8");
const environment = parseEnv(contents);
if (/^#\s*GOOGLE_SERVICES_JSON=/m.test(contents)) {
  throw new Error("Set GOOGLE_SERVICES_JSON to Sensitive visibility in the EAS environment.");
}
if (Object.hasOwn(environment, "GOOGLE_SERVICES_JSON")) {
  const source = environment.GOOGLE_SERVICES_JSON;
  if (!source || source === "null" || source === "undefined") {
    throw new Error("EAS did not download GOOGLE_SERVICES_JSON.");
  }
  // A stable relative path keeps fingerprints independent of the runner directory.
  copyFileSync(source, "google-services.json");
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, "GOOGLE_SERVICES_JSON=./google-services.json\n");
  }
  console.log("Firebase client file ready. Use GOOGLE_SERVICES_JSON=./google-services.json.");
}
