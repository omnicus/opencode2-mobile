import { expect, test } from "@jest/globals";
import type {
  SessionMessageInfo,
  SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";

import {
  countRunningBackgroundSubagents,
  flattenTranscriptPages,
  parseSubagentProtocolText,
  sanitizeTranscriptText,
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
  expect(countRunningBackgroundSubagents([completionMessage, toolMessage])).toBe(0);
});
