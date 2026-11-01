import type { stdin } from "node:process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  ask,
  askSecret,
  hasFlag,
  numberOption,
  option,
  parseOriginRoot,
  requiredOption,
} from "./cli-input.js";

describe("ask", () => {
  it("prompts and returns the trimmed answer", async () => {
    const { input, output, written } = terminal();
    input.write("  Ada  \n");

    await expect(ask("OpenCode username: ", input, output)).resolves.toBe("Ada");
    expect(written()).toBe("OpenCode username: ");
  });

  it("requires a value", async () => {
    const { input, output } = terminal();
    input.write("   \n");

    await expect(ask("OpenCode username: ", input, output)).rejects.toThrow("VALUE_REQUIRED");
  });
});

describe("askSecret", () => {
  it("requires a TTY", async () => {
    const { input, output, written } = terminal(false);

    await expect(askSecret("Password: ", input, output)).rejects.toThrow("SECRET_REQUIRES_TTY");
    expect(written()).toBe("");
    expect(input.setRawMode).not.toHaveBeenCalled();
  });

  it("reads raw input without echoing it", async () => {
    const { input, output, written } = terminal();
    const pause = vi.spyOn(input, "pause");
    input.write(Buffer.from(" sec"));
    input.write(Buffer.from([0x78, 127, 0x72, 0x65, 0x74, 0x79, 8, 0x20, 13, 0x7a]));

    await expect(askSecret("Password: ", input, output)).resolves.toBe("secret");
    expect(written()).toBe("Password: \n");
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(pause).toHaveBeenCalled();
  });

  it("accepts a line feed and multi-byte characters", async () => {
    const { input, output } = terminal();
    input.write("påss\n");

    await expect(askSecret("Password: ", input, output)).resolves.toBe("påss");
  });

  it("ignores backspace on empty input", async () => {
    const { input, output } = terminal();
    input.write(Buffer.from([127, 8, 0x61, 13]));

    await expect(askSecret("Password: ", input, output)).resolves.toBe("a");
  });

  it("cancels on Ctrl-C and restores the terminal", async () => {
    const { input, output, written } = terminal();
    input.write(Buffer.from([0x61, 3, 13]));

    await expect(askSecret("Password: ", input, output)).rejects.toThrow("CANCELLED");
    expect(written()).toBe("Password: ");
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("requires a value", async () => {
    const { input, output } = terminal();
    input.write(" \t\r");

    await expect(askSecret("Password: ", input, output)).rejects.toThrow("VALUE_REQUIRED");
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("fails when input ends before a newline", async () => {
    const { input, output } = terminal();
    input.end("secret");

    await expect(askSecret("Password: ", input, output)).rejects.toThrow("SECRET_INPUT_ENDED");
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});

describe("options", () => {
  const arguments_ = ["--name", "Laptop", "--empty", "", "--allow-http", "--port", "8080"];

  it("reads option values", () => {
    expect(option(arguments_, "--name")).toBe("Laptop");
    expect(option(arguments_, "--missing")).toBeUndefined();
    expect(option(["--name"], "--name")).toBeUndefined();
  });

  it("requires non-empty option values", () => {
    expect(requiredOption(arguments_, "--name")).toBe("Laptop");
    expect(() => requiredOption(arguments_, "--empty")).toThrow("EMPTY_REQUIRED");
    expect(() => requiredOption(arguments_, "--opencode-origin")).toThrow(
      "OPENCODE_ORIGIN_REQUIRED",
    );
  });

  it("parses ports with a fallback", () => {
    expect(numberOption(arguments_, "--port", 1)).toBe(8_080);
    expect(numberOption(arguments_, "--missing", 4_096)).toBe(4_096);
    expect(numberOption(["--port", "1"], "--port", 2)).toBe(1);
    expect(numberOption(["--port", "65535"], "--port", 2)).toBe(65_535);
  });

  it.each(["0", "65536", "1.5", "port", "-1"])("rejects port %s", (value) => {
    expect(() => numberOption(["--port", value], "--port", 1)).toThrow("INVALID_PORT");
  });

  it("detects flags", () => {
    expect(hasFlag(arguments_, "--allow-http")).toBe(true);
    expect(hasFlag(arguments_, "--verbose")).toBe(false);
  });
});

describe("parseOriginRoot", () => {
  it.each([
    ["http://server.test:4096", "http://server.test:4096"],
    ["https://Server.Test/", "https://server.test"],
  ])("accepts %s", (value, origin) => {
    expect(parseOriginRoot(value).origin).toBe(origin);
  });

  it.each([
    "ftp://server.test",
    "https://user@server.test",
    "https://:secret@server.test",
    "https://server.test/path",
    "https://server.test/?query",
    "https://server.test/#hash",
  ])("rejects %s", (value) => {
    expect(() => parseOriginRoot(value)).toThrow("INVALID_ORIGIN");
  });

  it("rejects an unparseable URL", () => {
    expect(() => parseOriginRoot("server.test")).toThrow(TypeError);
  });
});

function terminal(isTTY = true) {
  const input = Object.assign(new PassThrough(), {
    isTTY,
    setRawMode: vi.fn(function (this: PassThrough) {
      return this;
    }),
  });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  return {
    input: input as unknown as typeof stdin & { setRawMode: typeof input.setRawMode },
    output: output as unknown as typeof process.stdout,
    written: () => Buffer.concat(chunks).toString("utf8"),
  };
}
