import { expect, jest, test } from "@jest/globals";
import type { ShellGetOutput } from "@opencode2-mobile/opencode-adapter";

import {
  boundShellOutput,
  missingShellSnapshot,
  type ShellSnapshot,
  shellObservationStatus,
  shellRefetchInterval,
} from "./session-shell-output-model";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({ maxShellOutputBytes: 8 }));

const info: ShellGetOutput["data"] = {
  id: "sh_test",
  status: "running",
  command: "build",
  cwd: "/workspace",
  shell: "sh",
  file: "/output",
  metadata: {},
  time: { started: 1 },
};

function snapshot(overrides: Partial<ShellSnapshot> = {}): ShellSnapshot {
  return { cursor: 3, output: "one", truncated: false, missing: false, info, ...overrides };
}

const withoutInfo: ShellSnapshot = { cursor: 0, output: "", truncated: false, missing: false };

test("polls only while a reachable shell is running", () => {
  expect(shellRefetchInterval("pending", undefined)).toBe(1_000);
  expect(shellRefetchInterval("success", withoutInfo)).toBe(1_000);
  expect(shellRefetchInterval("success", snapshot())).toBe(1_000);
  expect(shellRefetchInterval("error", snapshot())).toBe(false);
  expect(shellRefetchInterval("success", snapshot({ missing: true }))).toBe(false);
  expect(
    shellRefetchInterval("success", snapshot({ info: { ...info, status: "exited", exit: 0 } })),
  ).toBe(false);
});

test("keeps output within the byte limit without splitting a character", () => {
  expect(boundShellOutput("12345678", false)).toEqual({ output: "12345678", truncated: false });
  expect(boundShellOutput("short", true)).toEqual({ output: "short", truncated: true });
  expect(boundShellOutput("0123456789", false)).toEqual({ output: "23456789", truncated: true });
  expect(boundShellOutput("øøøøø", false)).toEqual({ output: "øøøø", truncated: true });
  // Nine bytes: the last eight start inside the first "ø", so the whole character goes.
  expect(boundShellOutput("øøøøa", false)).toEqual({ output: "øøøa", truncated: true });
});

test("a removed shell keeps observed output, or starts empty", () => {
  expect(missingShellSnapshot(snapshot({ truncated: true }))).toEqual({
    cursor: 3,
    output: "one",
    truncated: true,
    missing: true,
  });
  expect(missingShellSnapshot(undefined)).toEqual({
    cursor: 0,
    output: "",
    truncated: false,
    missing: true,
  });
});

test.each<[ShellSnapshot | undefined, boolean, string]>([
  [undefined, true, "Shell output could not be refreshed."],
  [snapshot({ missing: true }), false, "Shell output is no longer available on the server."],
  [undefined, false, "Loading shell output…"],
  [withoutInfo, false, "Loading shell output…"],
  [snapshot(), false, "Running"],
  [snapshot({ info: { ...info, status: "timeout" } }), false, "Timed out"],
  [snapshot({ info: { ...info, status: "killed" } }), false, "Stopped"],
  [snapshot({ info: { ...info, status: "exited" } }), false, "Exited"],
  [snapshot({ info: { ...info, status: "exited", exit: 2 } }), false, "Exited · 2"],
])("status label %#", (value, error, label) => {
  expect(shellObservationStatus(value, error)).toBe(label);
});
