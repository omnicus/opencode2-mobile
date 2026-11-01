import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "@jest/globals";

// Acronyms and protocol tokens that are written in capitals in normal copy.
const ignoredCapsWords = new Set([
  "API",
  "DELETE",
  "GET",
  "HEAD",
  "HTTP",
  "HTTPS",
  "ID",
  "JSON",
  "OK",
  "OPTIONS",
  "PATCH",
  "POST",
  "PTY",
  "PUT",
  "QR",
  "SSH",
  "TLS",
  "URL",
]);

type Counts = { typography: number; allCaps: number };

// Raw font literals and all-caps copy that predate the shared type scale. Restyling each
// screen should shrink these to 0. A new entry needs a reason in a comment above it.
const allowed: Record<string, Partial<Counts>> = {
  "app.tsx": { typography: 8, allCaps: 1 },
  "navigation/root-navigation.tsx": { typography: 6 },
  "screens/app-shell.tsx": { typography: 25, allCaps: 11 },
  "screens/connection-screen.tsx": { allCaps: 35 },
  "screens/diff-screen.tsx": { typography: 4 },
  "screens/model-picker.tsx": { typography: 2 },
  "screens/notification-pairing-screen.tsx": { allCaps: 11 },
  "screens/session-composer.tsx": { allCaps: 1 },
  "screens/session-execution-panel.tsx": { allCaps: 2 },
  "screens/session-transcript.tsx": { typography: 1, allCaps: 1 },
  "screens/transcript-markdown.tsx": { typography: 11 },
  "screens/workspace-screen.tsx": { typography: 52, allCaps: 1 },
  "security/app-lock-context.tsx": { allCaps: 3 },
};

const typographyLiterals = [
  /fontSize:\s*\d/g,
  /fontWeight:\s*"\d/g,
  /letterSpacing:/g,
  /lineHeight:\s*\d/g,
  /fontFamily:\s*(?:["'`]|Platform\.select)/g,
];
const quotedText = [/"([^"\\\n]*)"/g, /`([^`]*)`/g, />([^<>{}]*)</g];
const capsPhrase =
  /(?<![A-Za-z-])[A-Z]{2,}(?:-[A-Z]{2,})*(?:[ \t]+[A-Z]{2,}(?:-[A-Z]{2,})*)+(?![A-Za-z-])/g;
const capsJsxWord = />\s*([A-Z]{4,})\s*</g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

function isIgnored(text: string) {
  return text.split(/[\s-]+/).every((word) => ignoredCapsWords.has(word));
}

function countThemeBypasses(source: string): Counts {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const typography = typographyLiterals.reduce(
    (count, pattern) => count + (code.match(pattern)?.length ?? 0),
    0,
  );
  const caps = new Set<number>();
  for (const pattern of quotedText) {
    for (const match of code.matchAll(pattern)) {
      const text = match[1] ?? "";
      if (text.includes("_")) continue;
      for (const phrase of text.matchAll(capsPhrase)) {
        if (!isIgnored(phrase[0])) caps.add((match.index ?? 0) + 1 + (phrase.index ?? 0));
      }
    }
  }
  for (const match of code.matchAll(capsJsxWord)) {
    const word = match[1] ?? "";
    if (!isIgnored(word)) caps.add((match.index ?? 0) + match[0].indexOf(word));
  }
  return { typography, allCaps: caps.size };
}

test("counts raw font literals and all-caps copy but not theme references", () => {
  expect(
    countThemeBypasses(`
      // OLD COMMENT
      const styles = { a: { fontSize: 15, fontWeight: "600", letterSpacing: 1 } };
      const code = { fontFamily: typography.code.fontFamily, lineHeight: 20 };
      const mono = { fontFamily: Platform.select({ ios: "Menlo" }) };
      throw new Error("CLIPBOARD_WRITE_FAILED");
      const status = "UNAVAILABLE";
      const hint = "Use an HTTP or HTTPS URL.";
      <Text>TEST CONNECTION</Text>;
      <Text>RETRY</Text>;
      <Text>ALLOW PRIVATE-NETWORK HTTP</Text>;
      <Text>{"PENDING WORK"}</Text>;
    `),
  ).toEqual({ typography: 5, allCaps: 4 });
});

test("screens do not add raw typography or all-caps copy", () => {
  const root = __dirname;
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const path of sourceFiles(root)) {
    const file = relative(root, path).split(sep).join("/");
    if (file === "theme.ts") continue;
    seen.add(file);
    const counts = countThemeBypasses(readFileSync(path, "utf8"));
    for (const kind of ["typography", "allCaps"] as const) {
      const limit = allowed[file]?.[kind] ?? 0;
      if (counts[kind] > limit) {
        problems.push(
          `${file} has ${counts[kind]} ${kind} occurrences (allowed ${limit}); use theme roles and sentence case`,
        );
      } else if (counts[kind] < limit) {
        problems.push(
          `${file} now has ${counts[kind]} ${kind}; set allowed["${file}"].${kind} to ${counts[kind]}`,
        );
      }
    }
  }
  for (const file of Object.keys(allowed)) {
    if (!seen.has(file)) problems.push(`${file} no longer exists; remove it from allowed`);
  }
  expect(problems).toEqual([]);
});
