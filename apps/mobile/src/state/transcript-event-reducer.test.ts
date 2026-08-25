import { expect, test } from "@jest/globals";
import type {
  OpenCodeEvent,
  SessionMessageInfo,
  SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";
import type { InfiniteData } from "@tanstack/react-query";

import { reduceTranscriptEvents } from "./transcript-event-reducer";

test("projects a complete assistant step and repairs volatile deltas with terminal values", () => {
  const current = transcriptData([]);
  const events = [
    transcriptEvent("session.step.started", {
      agent: "build",
      assistantMessageID: "msg_assistant",
      model: { id: "model-1", providerID: "provider-1" },
      sessionID: "session-1",
      snapshot: "start-snapshot",
    }),
    transcriptEvent("session.text.started", {
      assistantMessageID: "msg_assistant",
      ordinal: 0,
      sessionID: "session-1",
    }),
    transcriptEvent("session.text.delta", {
      assistantMessageID: "msg_assistant",
      delta: "same",
      ordinal: 0,
      sessionID: "session-1",
    }),
    transcriptEvent("session.text.delta", {
      assistantMessageID: "msg_assistant",
      delta: "same",
      ordinal: 0,
      sessionID: "session-1",
    }),
    transcriptEvent("session.reasoning.started", {
      assistantMessageID: "msg_assistant",
      ordinal: 0,
      sessionID: "session-1",
      state: { phase: "thinking" },
    }),
    transcriptEvent("session.reasoning.delta", {
      assistantMessageID: "msg_assistant",
      delta: "partial",
      ordinal: 0,
      sessionID: "session-1",
    }),
    transcriptEvent("session.text.ended", {
      assistantMessageID: "msg_assistant",
      ordinal: 0,
      sessionID: "session-1",
      state: { response: true },
      text: "authoritative text",
    }),
    transcriptEvent("session.reasoning.ended", {
      assistantMessageID: "msg_assistant",
      ordinal: 0,
      sessionID: "session-1",
      state: { phase: "done" },
      text: "authoritative reasoning",
    }),
    transcriptEvent("session.tool.input.started", {
      assistantMessageID: "msg_assistant",
      id: "tool-1",
      name: "read",
      sessionID: "session-1",
    }),
    transcriptEvent("session.tool.input.delta", {
      assistantMessageID: "msg_assistant",
      delta: "missed input",
      id: "tool-1",
      sessionID: "session-1",
    }),
    transcriptEvent("session.tool.input.ended", {
      assistantMessageID: "msg_assistant",
      id: "tool-1",
      sessionID: "session-1",
      text: '{"path":"file.ts"}',
    }),
    transcriptEvent("session.tool.called", {
      assistantMessageID: "msg_assistant",
      executed: false,
      id: "tool-1",
      input: { path: "file.ts" },
      sessionID: "session-1",
      state: { request: "accepted" },
    }),
    transcriptEvent("session.tool.progress", {
      assistantMessageID: "msg_assistant",
      id: "tool-1",
      metadata: { progress: 0.5 },
      sessionID: "session-1",
    }),
    transcriptEvent("session.tool.success", {
      assistantMessageID: "msg_assistant",
      content: [{ mime: "text/plain", type: "file", uri: "file:///redacted" }],
      executed: true,
      id: "tool-1",
      metadata: { progress: 1 },
      resultState: { complete: true },
      sessionID: "session-1",
    }),
    transcriptEvent("session.step.ended", {
      assistantMessageID: "msg_assistant",
      cost: 0.25,
      files: ["changed.ts"],
      finish: "stop",
      providerState: { settled: true },
      rawFinish: "done",
      sessionID: "session-1",
      snapshot: "end-snapshot",
      tokens: { cache: { read: 2, write: 3 }, input: 4, output: 5, reasoning: 6 },
    }),
  ];

  const result = reduceTranscriptEvents(current, events);
  const assistant = result.data?.pages[0]?.data[0];

  expect(result.needsReconciliation).toBe(false);
  expect(assistant).toMatchObject({
    agent: "build",
    cost: 0.25,
    finish: "stop",
    id: "msg_assistant",
    rawFinish: "done",
    snapshot: { end: "end-snapshot", files: ["changed.ts"], start: "start-snapshot" },
    type: "assistant",
  });
  expect(assistant?.type === "assistant" && assistant.content).toEqual([
    { state: { response: true }, text: "authoritative text", type: "text" },
    {
      state: { phase: "done" },
      text: "authoritative reasoning",
      time: { completed: 1, created: 1 },
      type: "reasoning",
    },
    {
      executed: true,
      id: "tool-1",
      name: "read",
      providerResultState: { complete: true },
      providerState: { request: "accepted" },
      state: {
        content: [{ mime: "text/plain", type: "file", uri: "file:///redacted" }],
        input: { path: "file.ts" },
        metadata: { progress: 1 },
        status: "completed",
      },
      time: { completed: 1, created: 1, ran: 1 },
      type: "tool",
    },
  ]);
});

test("resolves text and reasoning ordinals within their own part types", () => {
  const result = reduceTranscriptEvents(transcriptData([]), [
    stepStarted(),
    textStarted(0),
    reasoningStarted(0),
    textStarted(1),
    transcriptEvent("session.text.delta", {
      assistantMessageID: "msg_assistant",
      delta: "second",
      ordinal: 1,
      sessionID: "session-1",
    }),
  ]);
  const assistant = result.data?.pages[0]?.data[0];

  expect(assistant?.type === "assistant" && assistant.content).toEqual([
    { text: "", type: "text" },
    { text: "", time: { created: 1 }, type: "reasoning" },
    { text: "second", type: "text" },
  ]);
});

test("requests reconciliation for an ordinal gap or missing prerequisite", () => {
  const gap = reduceTranscriptEvents(transcriptData([]), [stepStarted(), textStarted(1)]);
  const missing = reduceTranscriptEvents(transcriptData([]), [textStarted(0)]);

  expect(gap.needsReconciliation).toBe(true);
  expect(missing.needsReconciliation).toBe(true);
  expect(gap.data?.pages[0]?.data[0]).toMatchObject({ content: [], id: "msg_assistant" });
  expect(missing.data).toBeDefined();
});

test("updates overlapping page copies while preserving cursors and page parameters", () => {
  const assistant = assistantMessage("old");
  const current = transcriptData([assistant], [assistant]);
  const pageParams = current.pageParams;
  const cursors = current.pages.map((page) => page.cursor);
  const result = reduceTranscriptEvents(current, [
    transcriptEvent("session.text.ended", {
      assistantMessageID: "msg_assistant",
      ordinal: 0,
      sessionID: "session-1",
      text: "new",
    }),
  ]);

  expect(result.data?.pages[0]?.data[0]).toMatchObject({
    content: [{ text: "new", type: "text" }],
  });
  expect(result.data?.pages[1]?.data[0]).toMatchObject({
    content: [{ text: "new", type: "text" }],
  });
  expect(result.data?.pageParams).toBe(pageParams);
  expect(result.data?.pages.map((page) => page.cursor)).toEqual(cursors);
});

test("does not create an assistant in a cache whose order is not known to be descending", () => {
  const current = transcriptData([]);
  const result = reduceTranscriptEvents(current, [stepStarted()], false);

  expect(result.data).toBe(current);
  expect(result.needsReconciliation).toBe(true);
});

function transcriptData(
  newest: SessionMessageInfo[],
  older?: SessionMessageInfo[],
): InfiniteData<SessionMessagesResponse, string | undefined> {
  return {
    pageParams: older ? [undefined, "older"] : [undefined],
    pages: [
      { cursor: older ? { next: "older" } : {}, data: newest },
      ...(older ? [{ cursor: {}, data: older }] : []),
    ],
  };
}

function assistantMessage(text: string): SessionMessageInfo {
  return {
    agent: "build",
    content: [{ text, type: "text" }],
    id: "msg_assistant",
    model: { id: "model-1", providerID: "provider-1" },
    time: { created: 1 },
    type: "assistant",
  };
}

function stepStarted() {
  return transcriptEvent("session.step.started", {
    agent: "build",
    assistantMessageID: "msg_assistant",
    model: { id: "model-1", providerID: "provider-1" },
    sessionID: "session-1",
  });
}

function textStarted(ordinal: number) {
  return transcriptEvent("session.text.started", {
    assistantMessageID: "msg_assistant",
    ordinal,
    sessionID: "session-1",
  });
}

function reasoningStarted(ordinal: number) {
  return transcriptEvent("session.reasoning.started", {
    assistantMessageID: "msg_assistant",
    ordinal,
    sessionID: "session-1",
  });
}

let eventId = 0;

function transcriptEvent(type: string, data: Record<string, unknown>) {
  eventId += 1;
  return {
    created: 1,
    data,
    id: `event-${eventId}`,
    type,
  } as unknown as OpenCodeEvent;
}
