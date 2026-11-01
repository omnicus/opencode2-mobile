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
    { key: "ses_child", childSessionID: "ses_child" },
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
  state: "completed" | "cancelled",
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
    { key: "ses_child", childSessionID: "ses_child" },
  ]);

  const completed = subagentStates([subagentNotification("ses_child", "completed"), launch]);
  expect(completed.get("ses_child")?.state).toBe("completed");
  expect(getSubagentPresentation(tool, completed)?.state).toBe("completed");
  expect(
    countRunningBackgroundSubagents([subagentNotification("ses_child", "completed"), launch]),
  ).toBe(0);

  const cancelled = subagentStates([subagentNotification("ses_child", "cancelled"), launch]);
  expect(getSubagentPresentation(tool, cancelled)?.state).toBe("error");
});

test("live session activity decides background subagents without a result", () => {
  const messages = [backgroundLaunch("ses_b", 2), backgroundLaunch("ses_a", 1)];

  expect(runningBackgroundSubagents(messages, { ses_a: {}, ses_b: {} }, "ses_parent")).toHaveLength(
    2,
  );
  // The parent turn is still running, so a child that has not reported busy yet stays running.
  expect(runningBackgroundSubagents(messages, { ses_parent: {} }, "ses_parent")).toHaveLength(2);
  expect(runningBackgroundSubagents(messages, { ses_a: {} }, "ses_parent")).toEqual([
    { key: "ses_a", childSessionID: "ses_a" },
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
