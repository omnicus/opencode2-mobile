import { expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { codePalette } from "../theme";
import {
  codeLanguage,
  HighlightedCode,
  highlightCode,
  maxHighlightedCodeLength,
} from "./transcript-code";

const sample = [
  "type Row = { id: string; top: number };",
  "",
  "export function overlaps(rows: Row[]) {",
  '  return rows.length > 1 ? true : "none"; // done',
  "}",
].join("\n");

function colorOf(lines: ReturnType<typeof highlightCode>, content: string) {
  return lines?.flat().find((token) => token.content === content)?.color;
}

test("colors TypeScript tokens like the OpenCode app", () => {
  const lines = highlightCode(sample, "ts");
  expect(lines).toHaveLength(5);
  expect(colorOf(lines, "type")).toBe(codePalette.keyword);
  expect(colorOf(lines, "export")).toBe(codePalette.keyword);
  expect(colorOf(lines, "overlaps")).toBe(codePalette.function);
  expect(colorOf(lines, "string")).toBe(codePalette.type);
  expect(colorOf(lines, "1")).toBe(codePalette.constant);
  expect(colorOf(lines, "true")).toBe(codePalette.constant);
  expect(colorOf(lines, '"none"')).toBe(codePalette.string);
  expect(colorOf(lines, "// done")).toBe(codePalette.comment);
  expect(colorOf(lines, ";")).toBe(codePalette.punctuation);
  // Every character of the source survives tokenizing.
  expect(lines?.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(sample);
});

test("resolves common fence names and leaves unknown languages plain", () => {
  expect(codeLanguage("ts")).toBe("ts");
  expect(codeLanguage("TSX title=example")).toBe("tsx");
  expect(codeLanguage("rs")).toBe("rust");
  expect(codeLanguage("sh")).toBeUndefined();
  expect(codeLanguage(undefined)).toBeUndefined();
  expect(highlightCode("echo hi", "sh")).toBeUndefined();
  expect(highlightCode("x".repeat(maxHighlightedCodeLength + 1), "ts")).toBeUndefined();
});

test("highlighted code stays one selectable text with the original content", () => {
  render(<HighlightedCode code={sample} info="ts" style={{ color: "#ffffff" }} />);
  expect(screen.getByText(sample, { exact: true })).toHaveProp("selectable", true);
});
