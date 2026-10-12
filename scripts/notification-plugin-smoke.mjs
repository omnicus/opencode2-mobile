import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const directory = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const { stdout } = await promisify(execFile)(
  "opencode",
  ["api", "get", "/api/plugin", "--header", `x-opencode-directory:${directory}`],
  { timeout: 30_000 },
);
const response = JSON.parse(stdout);
const path = `${directory}/packages/opencode-notification-plugin/dist`;
const plugin = response.data.find(
  (entry) =>
    entry.source.type === "local" &&
    (entry.source.path === path || entry.source.path === `${path}/index.js`),
);

if (plugin?.state.status !== "active") {
  console.error("FAIL: notification plugin is not active in the OpenCode server");
  if (plugin?.state.ref) console.error(`Server log reference: ${plugin.state.ref}`);
  process.exitCode = 1;
} else {
  console.log("PASS: notification plugin is active in the OpenCode server");
}
