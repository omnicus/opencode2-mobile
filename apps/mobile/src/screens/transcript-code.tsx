import { normalizeTokens, Prism } from "prism-react-renderer";
import { useMemo } from "react";
import { type StyleProp, Text, type TextStyle } from "react-native";

import { codePalette, typeRamp } from "../theme";

// Highlighting re-tokenizes on every streamed change, so very large blocks stay plain.
export const maxHighlightedCodeLength = 20_000;

const languageAliases: Record<string, string> = {
  cjs: "javascript",
  htm: "html",
  mjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  objective_c: "objectivec",
  "objective-c": "objectivec",
  "c++": "cpp",
  h: "c",
  hpp: "cpp",
  jsonc: "json",
  json5: "json",
  rs: "rust",
  golang: "go",
};

const tokenColors: Record<string, string> = {
  keyword: codePalette.keyword,
  tag: codePalette.keyword,
  selector: codePalette.keyword,
  important: codePalette.keyword,
  atrule: codePalette.keyword,
  function: codePalette.function,
  "function-variable": codePalette.function,
  method: codePalette.function,
  macro: codePalette.function,
  "class-name": codePalette.type,
  "maybe-class-name": codePalette.type,
  builtin: codePalette.type,
  namespace: codePalette.type,
  "attr-name": codePalette.type,
  number: codePalette.constant,
  boolean: codePalette.constant,
  constant: codePalette.constant,
  symbol: codePalette.constant,
  string: codePalette.string,
  char: codePalette.string,
  "template-string": codePalette.string,
  "attr-value": codePalette.string,
  regex: codePalette.string,
  url: codePalette.string,
  comment: codePalette.comment,
  prolog: codePalette.comment,
  doctype: codePalette.comment,
  cdata: codePalette.comment,
  punctuation: codePalette.punctuation,
  operator: codePalette.punctuation,
};

export function codeLanguage(info: string | undefined) {
  const name = info?.trim().split(/\s+/)[0]?.toLocaleLowerCase();
  if (!name) return undefined;
  const language = languageAliases[name] ?? name;
  return Prism.languages[language] ? language : undefined;
}

export function highlightCode(code: string, info: string | undefined) {
  const language = codeLanguage(info);
  const grammar = language ? Prism.languages[language] : undefined;
  if (!grammar || code.length > maxHighlightedCodeLength) return undefined;
  return normalizeTokens(Prism.tokenize(code, grammar)).map((line) =>
    line.map((token) => {
      // The most specific type comes last; nested tokens keep their outer types first.
      const type = [...token.types].reverse().find((candidate) => tokenColors[candidate]);
      return {
        color: type ? tokenColors[type] : undefined,
        // An empty line arrives as one token holding its newline; lines are joined below.
        content: token.empty ? "" : token.content,
        italic: type ? tokenColors[type] === codePalette.comment : false,
      };
    }),
  );
}

export function HighlightedCode({
  code,
  info,
  style,
}: {
  code: string;
  info: string | undefined;
  style: StyleProp<TextStyle>;
}) {
  const lines = useMemo(() => highlightCode(code, info), [code, info]);
  return (
    <Text selectable dynamicTypeRamp={typeRamp.body} style={style}>
      {lines
        ? lines.map((line, lineIndex) => (
            // Lines and tokens never reorder within one render of a code block.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional code tokens
            <Text key={lineIndex}>
              {lineIndex > 0 ? "\n" : null}
              {line.map((token, tokenIndex) =>
                token.color ? (
                  <Text
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional code tokens
                    key={tokenIndex}
                    style={{
                      color: token.color,
                      ...(token.italic ? { fontStyle: "italic" as const } : {}),
                    }}
                  >
                    {token.content}
                  </Text>
                ) : (
                  token.content
                ),
              )}
            </Text>
          ))
        : code}
    </Text>
  );
}
