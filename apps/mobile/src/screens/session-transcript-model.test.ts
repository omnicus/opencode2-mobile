import { expect, test } from "@jest/globals";
import type {
  SessionMessageInfo,
  SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";

import {
  countRunningBackgroundSubagents,
  flattenTranscriptPages,
  getSubagentPresentation,
  parseSubagentProtocolText,
  runningBackgroundSubagents,
  sessionSubagents,
  sanitizeTranscriptText,
  subagentStates,
} from "./session-transcript-model";

test("flattens descending cursor pages without reversing server order", () => {
  const message = (id: string, created: number) => ({
    id,
    text: id,
    time: { created },
    type: "user" as const,
  });
  const pages: SessionMessagesResponse[] = [
    { cursor: { next: "older" }, data: [message("msg_4", 4), message("msg_3", 3)] },
    { cursor: {}, data: [message("msg_3", 3), message("msg_2", 2), message("msg_1", 1)] },
  ];

  expect(flattenTranscriptPages(pages).map(({ id }) => id)).toEqual([
    "msg_4",
    "msg_3",
    "msg_2",
    "msg_1",
  ]);
});

test("removes ANSI sequences and unsafe control characters without changing plain text", () => {
  expect(sanitizeTranscriptText("before\u001b[31mred\u001b[0m\u0000\nafter")).toBe(
    "beforered\nafter",
  );
  expect(sanitizeTranscriptText("plain\ttext")).toBe("plain\ttext");
  expect(sanitizeTranscriptText("first\rsecond\r\nthird")).toBe("first\nsecond\nthird");
  expect(sanitizeTranscriptText("left\u202eright\u009b31mplain")).toBe("leftrightplain");
  expect(sanitizeTranscriptText("abcdef", 3)).toBe("abc");
});

test.each([
  ["an OSC title ended by BEL", "a\u001b]0;title\u0007b", "ab"],
  ["an OSC hyperlink ended by ST", "a\u001b]8;;https://x.test\u001b\\link", "alink"],
  ["an unterminated OSC", "a\u001b]0;title", "a"],
  ["an unterminated CSI", "a\u001b[31", "a"],
  ["a lone escape", "a\u001bcb", "acb"],
  ["a trailing escape", "a\u001b", "a"],
  ["a C1 CSI", "a\u009b1;2Hb", "ab"],
  ["an unterminated C1 CSI", "a\u009b31", "a"],
  ["a C1 OSC ended by ST", "a\u009dtitle\u009cb", "ab"],
  ["a C1 OSC ended by BEL", "a\u009dtitle\u0007b", "ab"],
  ["an unterminated C1 OSC", "a\u009dtitle", "a"],
  ["a trailing carriage return", "a\r", "a\n"],
  ["DEL and C1 controls", "a\u007fb\u0085c", "abc"],
  ["C0 controls other than tab and newline", "a\u0000\u0008\u000b\u001fb", "ab"],
  ["bidi marks, embeddings, and isolates", "‎A‏B‪C‮D⁦E⁩F", "ABCDEF"],
  ["neighbours of the bidi ranges", "‍‐ ⁥⁪", "‍‐ ⁥⁪"],
  ["non-ASCII text", "é 😀 日本", "é 😀 日本"],
  ["an empty string", "", ""],
])("sanitizes %s", (_name, text, expected) => {
  expect(sanitizeTranscriptText(text)).toBe(expected);
});

test("bounds the scanned input by the output limit", () => {
  const hidden = `${"\u0000".repeat(4_096)}visible`;
  expect(sanitizeTranscriptText(hidden)).toBe("visible");
  expect(sanitizeTranscriptText(hidden, 10)).toBe("");
  expect(sanitizeTranscriptText(hidden, 300)).toBe("visible");
  expect(sanitizeTranscriptText("a\u001b[31mb", 0)).toBe("");
  expect(sanitizeTranscriptText("a\u001b[31mbc", 2)).toBe("ab");
});

test("projects task wrappers without exposing protocol markup", () => {
  expect(
    parseSubagentProtocolText(
      '<task id="ses_child" state="completed">\n<summary>Inspect code</summary>\n<task_result>\nUseful result\n</task_result>\n</task>',
    ),
  ).toEqual({
    childSessionID: "ses_child",
    matched: true,
    state: "completed",
    summary: "Inspect code",
    text: "Useful result",
  });
  expect(
    parseSubagentProtocolText(
      "Useful result\n<task_metadata>\nsession_id: ses_child\n</task_metadata>",
    ),
  ).toEqual({ childSessionID: "ses_child", matched: true, text: "Useful result" });
  expect(parseSubagentProtocolText("Explain <task> as plain text")).toEqual({
    matched: false,
    text: "Explain <task> as plain text",
  });
});

test("counts only background subagents whose latest protocol state is running", () => {
  const toolMessage: SessionMessageInfo = {
    agent: "build",
    content: [
      {
        id: "tool-subagent",
        name: "subagent",
        state: {
          content: [
            {
              text: '<task id="ses_child" state="running">\n<task_result>\nWorking\n</task_result>\n</task>',
              type: "text",
            },
          ],
          input: { background: true, description: "Inspect code", subagent_type: "explore" },
          metadata: { background: true, sessionId: "ses_child" },
          status: "completed",
        },
        time: { created: 1 },
        type: "tool",
      },
    ],
    id: "msg_tool",
    model: { id: "model-1", providerID: "provider" },
    time: { created: 1 },
    type: "assistant",
  };
  const completionMessage: SessionMessageInfo = {
    agent: "build",
    content: [
      {
        text: '<task id="ses_child" state="completed">\n<task_result>\nFinished\n</task_result>\n</task>',
        type: "text",
      },
    ],
    id: "msg_completion",
    model: { id: "model-1", providerID: "provider" },
    time: { created: 2 },
    type: "assistant",
  };

  expect(countRunningBackgroundSubagents([toolMessage])).toBe(1);
  expect(runningBackgroundSubagents([toolMessage, toolMessage])).toEqual([
    { key: "ses_child", childSessionID: "ses_child", title: "Inspect code" },
  ]);
  expect(countRunningBackgroundSubagents([completionMessage, toolMessage])).toBe(0);
  expect(runningBackgroundSubagents([completionMessage, toolMessage])).toEqual([]);
});

// Shapes match OpenCode 2.2 storage: the launch tool completes at once with an acknowledgement,
// and the result arrives later as a synthetic message.
function backgroundLaunch(childSessionID: string, created = 1): SessionMessageInfo {
  return {
    agent: "build",
    content: [
      {
        id: `tool-${childSessionID}`,
        name: "subagent",
        state: {
          content: [
            {
              text: `The subagent is working in the background (sessionID: ${childSessionID}). You will be notified automatically when it finishes.`,
              type: "text",
            },
          ],
          input: { agent: "general", background: true, description: "Restyle", prompt: "Go" },
          metadata: { sessionID: childSessionID, status: "running", truncated: false },
          status: "completed",
        },
        time: { created, completed: created },
        type: "tool",
      },
    ],
    id: `msg_launch_${childSessionID}`,
    model: { id: "model-1", providerID: "provider" },
    time: { created, completed: created },
    type: "assistant",
  };
}

function subagentNotification(
  childSessionID: string,
  state: "completed" | "cancelled" | "failed",
  created = 2,
): SessionMessageInfo {
  return {
    id: `msg_notice_${childSessionID}`,
    metadata: { agent: "General", childID: childSessionID, source: "subagent", state },
    text: `<subagent sessionID="${childSessionID}" state="${state}" description="Restyle">\nDone\n</subagent>`,
    time: { created },
    type: "synthetic",
  };
}

test("a background launch stays running until its child reports a result", () => {
  const launch = backgroundLaunch("ses_child");
  const tool = launch.type === "assistant" ? launch.content[0] : undefined;
  if (tool?.type !== "tool") throw new Error("expected tool");

  expect(getSubagentPresentation(tool)).toMatchObject({
    background: true,
    childSessionID: "ses_child",
    state: "running",
  });
  expect(runningBackgroundSubagents([launch])).toEqual([
    { key: "ses_child", childSessionID: "ses_child", title: "Restyle" },
  ]);

  const completed = subagentStates([subagentNotification("ses_child", "completed"), launch]);
  expect(completed.get("ses_child")?.state).toBe("completed");
  expect(getSubagentPresentation(tool, completed)?.state).toBe("completed");
  expect(
    countRunningBackgroundSubagents([subagentNotification("ses_child", "completed"), launch]),
  ).toBe(0);

  // The result notice arrives first in newest-first order; the launch still supplies the title.
  expect(
    subagentStates([subagentNotification("ses_child", "completed"), launch]).get("ses_child")
      ?.title,
  ).toBe("Restyle");

  // A stop is not a failure.
  const cancelled = subagentStates([subagentNotification("ses_child", "cancelled"), launch]);
  expect(getSubagentPresentation(tool, cancelled)?.state).toBe("interrupted");
  const failed = subagentStates([subagentNotification("ses_child", "failed"), launch]);
  expect(getSubagentPresentation(tool, failed)?.state).toBe("error");
});

test("a child blocked on a request reads as waiting, even after leaving the active list", () => {
  const launch = backgroundLaunch("ses_child");
  const tool = launch.type === "assistant" ? launch.content[0] : undefined;
  if (tool?.type !== "tool") throw new Error("expected tool");
  const attention = new Map([["ses_child", "permission" as const]]);

  // Absent from active sessions while the parent is idle would read as completed.
  const states = subagentStates([launch], {}, "ses_parent", attention);
  expect(states.get("ses_child")).toMatchObject({ state: "waiting", waitingFor: "permission" });
  expect(getSubagentPresentation(tool, states)).toMatchObject({
    state: "waiting",
    waitingFor: "permission",
  });

  // A reported finish wins over a stale pending request.
  const finished = subagentStates(
    [subagentNotification("ses_child", "completed"), launch],
    {},
    "ses_parent",
    attention,
  );
  expect(finished.get("ses_child")?.state).toBe("completed");
});

test("the monitor lists waiting, then working, then finished subagents", () => {
  const messages = [
    subagentNotification("ses_done", "completed"),
    backgroundLaunch("ses_done"),
    backgroundLaunch("ses_busy"),
    backgroundLaunch("ses_blocked"),
  ];
  const list = sessionSubagents(
    messages,
    { ses_busy: {}, ses_blocked: {} },
    "ses_parent",
    new Map([["ses_blocked", "input" as const]]),
  );
  expect(list.map(({ key, state }) => [key, state])).toEqual([
    ["ses_blocked", "waiting"],
    ["ses_busy", "running"],
    ["ses_done", "completed"],
  ]);
});

test("live session activity decides background subagents without a result", () => {
  const messages = [backgroundLaunch("ses_b", 2), backgroundLaunch("ses_a", 1)];

  expect(runningBackgroundSubagents(messages, { ses_a: {}, ses_b: {} }, "ses_parent")).toHaveLength(
    2,
  );
  // The parent turn is still running, so a child that has not reported busy yet stays running.
  expect(runningBackgroundSubagents(messages, { ses_parent: {} }, "ses_parent")).toHaveLength(2);
  expect(runningBackgroundSubagents(messages, { ses_a: {} }, "ses_parent")).toEqual([
    { key: "ses_a", childSessionID: "ses_a", title: "Restyle" },
  ]);
  expect(subagentStates(messages, { ses_a: {} }, "ses_parent").get("ses_b")?.state).toBe(
    "completed",
  );
  // A result beats stale activity, and a relaunch after a result is running again.
  expect(
    subagentStates([subagentNotification("ses_a", "completed", 3), ...messages], { ses_a: {} }).get(
      "ses_a",
    )?.state,
  ).toBe("completed");
  expect(
    subagentStates([
      backgroundLaunch("ses_a", 4),
      subagentNotification("ses_a", "completed", 3),
      ...messages,
    ]).get("ses_a")?.state,
  ).toBe("running");
});

test("foreground subagents keep the tool status", () => {
  const launch = backgroundLaunch("ses_child");
  if (launch.type !== "assistant" || launch.content[0]?.type !== "tool") throw new Error();
  const tool = launch.content[0];
  if (tool.state.status !== "completed") throw new Error();
  const foreground = {
    ...tool,
    state: {
      ...tool.state,
      input: { description: "Restyle" },
      metadata: { sessionID: "ses_child" },
    },
  };

  expect(getSubagentPresentation(foreground)).toMatchObject({
    background: false,
    state: "completed",
  });
  expect(
    getSubagentPresentation(foreground, subagentStates([launch], { ses_child: {} }))?.state,
  ).toBe("completed");
});

type AssistantTool = Extract<
  Extract<SessionMessageInfo, { type: "assistant" }>["content"][number],
  { type: "tool" }
>;

function subagentTool(state: AssistantTool["state"], name = "subagent"): AssistantTool {
  return { id: "tool-1", name, state, time: { created: 1 }, type: "tool" };
}

test("ignores tools that do not delegate", () => {
  expect(
    getSubagentPresentation(subagentTool({ input: {}, metadata: {}, status: "running" }, "shell")),
  ).toBeUndefined();
  expect(
    getSubagentPresentation(subagentTool({ input: {}, metadata: {}, status: "running" }, " Task ")),
  ).toMatchObject({ background: false, state: "running", title: "Delegated task" });
});

test.each([
  [
    "a parsed input",
    JSON.stringify({ background: true, description: " Explore ", subagent_type: "explore" }),
    { agent: "explore", background: true, state: "streaming", title: "Explore" },
  ],
  [
    "invalid JSON",
    '{"description":',
    { background: false, state: "streaming", title: "Delegated task" },
  ],
  [
    "a non-object input",
    '"text"',
    { background: false, state: "streaming", title: "Delegated task" },
  ],
  [
    "an oversized input",
    JSON.stringify({ description: "x".repeat(16_384) }),
    { background: false, state: "streaming", title: "Delegated task" },
  ],
])("reads streaming subagent input from %s", (_name, input, expected) => {
  expect(getSubagentPresentation(subagentTool({ input, status: "streaming" }))).toMatchObject(expected);
});

test("falls back across metadata session keys, titles, and agents", () => {
  const running = (metadata: Record<string, string | boolean>) =>
    getSubagentPresentation(subagentTool({ input: {}, metadata, status: "running" }));

  expect(
    running({ agent: " general ", sessionID: "bad id", task_id: "ses_task", title: "Meta" }),
  ).toMatchObject({
    agent: "general",
    background: false,
    childSessionID: "ses_task",
    state: "running",
    title: "Meta",
  });
  expect(running({ session_id: "ses_snake", taskId: "ses_camel" })?.childSessionID).toBe(
    "ses_snake",
  );
  expect(running({ background: true, taskId: "ses_camel" })).toMatchObject({
    background: true,
    childSessionID: "ses_camel",
  });
});

test("presents protocol results, summaries, and errors from finished tools", () => {
  expect(
    getSubagentPresentation(
      subagentTool({
        content: [
          { mime: "text/plain", type: "file", uri: "file:///log" },
          {
            text: '<task id="ses_child" state="completed">\n<summary>Inspect</summary>\n<task_result>\nDone\n</task_result>\n</task>',
            type: "text",
          },
          { text: "  ", type: "text" },
          { text: " Extra ", type: "text" },
        ],
        input: {},
        status: "completed",
      }),
    ),
  ).toMatchObject({
    background: false,
    childSessionID: "ses_child",
    result: "Done\n\nExtra",
    state: "completed",
    title: "Inspect",
  });

  const failed = subagentTool({
    content: [
      {
        text: '<task id="ses_child" state="error">\n<task_error>\nBroke\n</task_error>\n</task>',
        type: "text",
      },
    ],
    error: { message: "failed", type: "tool" },
    input: { background: true },
    status: "error",
  });
  expect(getSubagentPresentation(failed)).toMatchObject({
    background: true,
    childSessionID: "ses_child",
    result: "Broke",
    state: "error",
    title: "Delegated task",
  });
  expect(
    getSubagentPresentation(
      failed,
      new Map([["ses_child", { background: true, state: "completed" as const }]]),
    )?.state,
  ).toBe("completed");
  expect(
    getSubagentPresentation(
      subagentTool({ error: { message: "failed", type: "tool" }, input: {}, status: "error" }),
    ),
  ).toMatchObject({ background: false, state: "error", title: "Delegated task" });
});
