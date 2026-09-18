import { execFileSync } from "node:child_process";

const allowed =
  /^(apps\/mobile\/src\/|packages\/opencode-adapter\/(src|integration)\/|packages\/test-fixtures\/src\/)/;
const base = process.argv[2];
if (!base || !/^[0-9a-f]{40}$/.test(base)) throw new Error("Supply the original candidate commit.");
const changed = execFileSync("git", ["diff", base, "--name-only", "-z"], { encoding: "utf8" });
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
});
if (
  `${changed}${untracked}`
    .split("\0")
    .filter(Boolean)
    .some((path) => !allowed.test(path))
) {
  throw new Error("Repair changed files outside the permitted source directories. Push stopped.");
}
