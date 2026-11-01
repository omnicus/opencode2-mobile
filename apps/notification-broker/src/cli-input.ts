import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

export async function ask(prompt: string, input = stdin, output = stdout) {
  const reader = createInterface({ input, output });
  try {
    const value = (await reader.question(prompt)).trim();
    if (!value) throw new Error("VALUE_REQUIRED");
    return value;
  } finally {
    reader.close();
  }
}

export async function askSecret(prompt: string, input = stdin, output = stdout) {
  if (!input.isTTY) throw new Error("SECRET_REQUIRES_TTY");
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  const bytes: number[] = [];
  try {
    for await (const chunk of input) {
      for (const byte of Buffer.from(chunk)) {
        if (byte === 3) throw new Error("CANCELLED");
        if (byte === 13 || byte === 10) {
          output.write("\n");
          const value = Buffer.from(bytes).toString("utf8").trim();
          if (!value) throw new Error("VALUE_REQUIRED");
          return value;
        }
        if (byte === 127 || byte === 8) bytes.pop();
        else bytes.push(byte);
      }
    }
    throw new Error("SECRET_INPUT_ENDED");
  } finally {
    input.setRawMode(false);
    input.pause();
  }
}

export function option(arguments_: string[], name: string) {
  const index = arguments_.indexOf(name);
  return index < 0 ? undefined : arguments_[index + 1];
}

export function requiredOption(arguments_: string[], name: string) {
  const value = option(arguments_, name);
  if (!value) throw new Error(`${name.slice(2).toUpperCase().replaceAll("-", "_")}_REQUIRED`);
  return value;
}

export function numberOption(arguments_: string[], name: string, fallback: number) {
  const value = option(arguments_, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error("INVALID_PORT");
  return parsed;
}

export function hasFlag(arguments_: string[], name: string) {
  return arguments_.includes(name);
}

export function parseOriginRoot(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("INVALID_ORIGIN");
  }
  return url;
}
