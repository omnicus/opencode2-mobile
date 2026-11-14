import { expect, test } from "@jest/globals";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";

import {
  backgroundWorkSummary,
  shellCandidates,
  shellEndLabel,
  shellOutputTail,
  shellPageStatus,
  shortShellCommand,
} from "./session-background-shells-model";

function shellCall(id: string, state: Record<string, unknown>, name = "shell"): SessionMessageInfo {
  return {
    id: `msg_${id}`,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 1, completed: 2 },
    content: [{ id: `tool_${id}`, name, type: "tool", time: { created: 5, ran: 7 }, state }],
  } as SessionMessageInfo;
}

const info = {
  command: "pnpm dev",
  cwd: "/workspace",
  file: "/output",
  id: "sh_dev",
  metadata: {},
  shell: "sh",
  status: "running" as const,
  time: { started: 1 },
};

test("candidates are background shell calls with a shellID, in launch order, once each", () => {
  const messages = [
    // Newest first, as the transcript pages arrive.
    shellCall("c", {
      status: "completed",
      input: { cmd: "pnpm test --watch" },
      metadata: { background: true, shellID: "sh_watch" },
    }),
    shellCall("b", {
      status: "completed",
      input: { command: "pnpm dev", background: true },
      metadata: { shellID: "sh_dev", status: "running" },
    }),
    shellCall("a", {
      status: "completed",
      input: { command: "pnpm dev (older call)", background: true },
      metadata: { shellID: "sh_dev" },
    }),
  ];
  expect(shellCandidates(messages)).toEqual([
    { command: "pnpm dev", key: "sh_dev", shellID: "sh_dev", startedAt: 7 },
    { command: "pnpm test --watch", key: "sh_watch", shellID: "sh_watch", startedAt: 7 },
  ]);
});

test("a call moved to the background counts once it no longer blocks its turn", () => {
  const moved = { input: { command: "build" }, metadata: { shellID: "sh_build" } };
  expect(shellCandidates([shellCall("a", { status: "running", ...moved })])).toEqual([]);
  expect(shellCandidates([shellCall("a", { status: "completed", ...moved })])).toEqual([
    { command: "build", key: "sh_build", shellID: "sh_build", startedAt: 7 },
  ]);
});

test.each([
  [
    "a final result",
    {
      status: "completed",
      input: { command: "x", background: true },
      metadata: { shellID: "sh", status: "exited" },
    },
  ],
  ["no shellID", { status: "completed", input: { command: "x", background: true }, metadata: {} }],
  ["a streaming call", { status: "streaming", input: '{"command":"x"}' }],
])("skips %s", (_name, state) => {
  expect(shellCandidates([shellCall("a", state)])).toEqual([]);
});

test("other tools are not shells, and commands are sanitized", () => {
  const state = {
    status: "completed",
    input: { command: "\u001b[31mrm\u001b[0m -rf build", background: true },
    metadata: { shellID: "sh_a" },
  };
  expect(shellCandidates([shellCall("a", state, "read")])).toEqual([]);
  expect(shellCandidates([shellCall("a", state, "bash")])[0]?.command).toBe("rm -rf build");
});

test("the summary follows desktop wording", () => {
  expect(backgroundWorkSummary(0, 1)).toBe("1 shell");
  expect(backgroundWorkSummary(0, 2)).toBe("2 shells");
  expect(backgroundWorkSummary(1, 1)).toBe("1 subagent · 1 shell");
  expect(backgroundWorkSummary(2, 0)).toBe("2 subagents");
});

test("end labels say how a shell ended, and nothing while it runs", () => {
  expect(shellEndLabel(undefined, false)).toBeUndefined();
  expect(shellEndLabel(info, false)).toBeUndefined();
  expect(shellEndLabel({ ...info, status: "exited" }, false)).toBe("Exited");
  expect(shellEndLabel({ ...info, exit: 0, status: "exited" }, false)).toBe("Exited");
  expect(shellEndLabel({ ...info, exit: 1, status: "exited" }, false)).toBe("Exited with code 1");
  expect(shellEndLabel({ ...info, status: "timeout" }, false)).toBe("Timed out");
  expect(shellEndLabel({ ...info, status: "killed" }, false)).toBe("Stopped");
  expect(shellEndLabel(undefined, true)).toBe("Stopped");
});

test("the tail keeps the last lines without escape codes and says when it clipped", () => {
  const output = Array.from({ length: 50 }, (_, index) => `\u001b[2mline ${index}\u001b[0m`).join(
    "\r\n",
  );
  const tail = shellOutputTail(`${output}\r\n`);
  expect(tail.clipped).toBe(true);
  expect(tail.text.split("\n")).toHaveLength(40);
  expect(tail.text.startsWith("line 10\n")).toBe(true);
  expect(tail.text.endsWith("line 49")).toBe(true);
  expect(shellOutputTail("50%\r75%\r")).toEqual({ clipped: false, text: "50%\n75%" });
  expect(shellOutputTail("")).toEqual({ clipped: false, text: "" });
});

test("short commands read aloud as one bounded line", () => {
  expect(shortShellCommand("  pnpm   dev  ")).toBe("pnpm dev");
  expect(shortShellCommand("\ncd app &&\n  pnpm build")).toBe("cd app &&");
  const long = shortShellCommand(`echo ${"x".repeat(300)}`);
  expect(long).toHaveLength(120);
  expect(long.endsWith("…")).toBe(true);
});

test("the page status says how a shell ended, or that it runs, last known when degraded", () => {
  expect(shellPageStatus(undefined, false)).toEqual({ label: "Running", tone: "running" });
  expect(shellPageStatus({ info, missing: false }, true)).toEqual({
    label: "Last known: Running",
    tone: "dim",
  });
  expect(
    shellPageStatus({ info: { ...info, exit: 2, status: "exited" }, missing: false }, false),
  ).toEqual({ ended: "Exited with code 2", label: "Exited with code 2", tone: "failed" });
  expect(
    shellPageStatus({ info: { ...info, status: "timeout" }, missing: false }, false).tone,
  ).toBe("failed");
  expect(
    shellPageStatus({ info: { ...info, exit: 0, status: "exited" }, missing: false }, false),
  ).toEqual({ ended: "Exited", label: "Exited", tone: "dim" });
  // A removed shell keeps its last running info but reads as stopped, never as failed.
  expect(shellPageStatus({ info, missing: true }, true)).toEqual({
    ended: "Stopped",
    label: "Stopped",
    tone: "stopped",
  });
});
