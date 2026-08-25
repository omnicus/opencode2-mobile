import { execFileSync } from "node:child_process";

const trackedPaths = new Set(
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean),
);
const forbiddenExtensions = [".jks", ".keystore", ".mobileprovision", ".p8", ".p12", ".log"];
const forbidden = [...trackedPaths].filter((path) => {
  const lowerPath = path.toLowerCase();
  const fileName = lowerPath.split("/").at(-1);

  return (
    (fileName?.startsWith(".env") && fileName !== ".env.example") ||
    path.startsWith("apps/mobile/config/local/") ||
    path === "apps/mobile/GoogleService-Info.plist" ||
    path === "apps/mobile/google-services.json" ||
    forbiddenExtensions.some((extension) => lowerPath.endsWith(extension))
  );
});

if (forbidden.length > 0) {
  process.stderr.write(`Private deployment files must not be tracked:\n${forbidden.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Public tree contains no tracked private deployment files.\n");
}
