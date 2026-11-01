import { expect, test } from "@jest/globals";
import type {
  OpenCodeEvent,
  SessionMessageInfo,
  SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";
import type { InfiniteData } from "@tanstack/react-query";

import { reduceTranscriptEvents, trimSnapshotTextDeltas } from "./transcript-event-reducer";

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
      native: { phase: "thinking" },
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
      native: { response: true },
      text: "authoritative text",
    }),
    transcriptEvent("session.reasoning.ended", {
      assistantMessageID: "msg_assistant",
      ordinal: 0,
      sessionID: "session-1",
      native: { phase: "done" },
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
      native: { request: "accepted" },
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
      native: { complete: true },
      sessionID: "session-1",
    }),
    transcriptEvent("session.step.ended", {
      assistantMessageID: "msg_assistant",
      cost: 0.25,
      files: ["changed.ts"],
      finish: "stop",
      native: { settled: true },
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
    { text: "authoritative text", type: "text" },
    {
      text: "authoritative reasoning",
      time: { completed: 1, created: 1 },
      type: "reasoning",
    },
    {
      executed: true,
      id: "tool-1",
      name: "read",
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

function textDeltas(...deltas: string[]) {
  return deltas.map((delta) =>
    transcriptEvent("session.text.delta", {
      assistantMessageID: "msg_assistant",
      delta,
      ordinal: 0,
      sessionID: "session-1",
    }),
  );
}

function appliedText(snapshot: string, deltas: string[]) {
  const data = transcriptData([assistantMessage(snapshot)]);
  const result = reduceTranscriptEvents(data, trimSnapshotTextDeltas(data, textDeltas(...deltas)));
  const message = result.data?.pages[0]?.data[0];
  return message?.type === "assistant" && message.content[0]?.type === "text"
    ? message.content[0].text
    : undefined;
}

test("refetched text keeps only the held deltas it does not already include", () => {
  expect(appliedText("Hello", [" wor", "ld", "!"])).toBe("Hello world!");
  expect(appliedText("Hello wor", [" wor", "ld", "!"])).toBe("Hello world!");
  expect(appliedText("Hello world!", [" wor", "ld", "!"])).toBe("Hello world!");
});

test("only whole held deltas count as already included", () => {
  // The snapshot ends with a space, but the held delta " there" was not part of it.
  expect(appliedText("Hello ", [" there"])).toBe("Hello  there");
  // A closing code fence missed by the snapshot is kept, so the block still closes.
  expect(appliedText("```ts\nconst a = 1;\n", ["``", "`\n\nAfter"])).toBe(
    "```ts\nconst a = 1;\n```\n\nAfter",
  );
});

test("held deltas match reasoning parts and skip parts the snapshot lacks", () => {
  const data = transcriptData([
    {
      ...assistantMessage(""),
      content: [
        { text: "", type: "text" },
        { text: "Thinking hard", time: { created: 1 }, type: "reasoning" },
      ],
    },
  ]);
  const reasoning = assistantEvent("session.reasoning.delta", { delta: " hard", ordinal: 0 });
  const emptyText = assistantEvent("session.text.delta", { delta: "a", ordinal: 0 });
  const otherMessage = assistantEvent("session.text.delta", {
    assistantMessageID: "msg_other",
    delta: "b",
    ordinal: 0,
  });
  const tooLong = assistantEvent("session.reasoning.delta", {
    delta: "and longer than the snapshot",
    ordinal: 0,
  });
  const step = stepStarted();
  const continued = new Set<string>();

  expect(trimSnapshotTextDeltas(data, [emptyText, otherMessage], continued)).toEqual([
    emptyText,
    otherMessage,
  ]);
  expect(continued.size).toBe(0);
  expect(trimSnapshotTextDeltas(data, [step, reasoning, tooLong], continued)).toEqual([
    step,
    tooLong,
  ]);
  expect(continued).toEqual(new Set(["msg_assistant\u0000reasoning\u00000"]));
});

test("returns the same events when no held delta is already in the snapshot", () => {
  const data = transcriptData([assistantMessage("Hello")]);
  const events = textDeltas(" there");

  expect(trimSnapshotTextDeltas(data, events)).toBe(events);
});

test("leaves missing or empty caches alone", () => {
  const empty = { pageParams: [], pages: [] };

  expect(reduceTranscriptEvents(undefined, [stepStarted()])).toEqual({
    data: undefined,
    needsReconciliation: false,
  });
  expect(reduceTranscriptEvents(empty, [stepStarted()])).toEqual({
    data: empty,
    needsReconciliation: true,
  });
});

test("reconciles invalid events and events that do not fit the cached message", () => {
  const user: SessionMessageInfo = {
    content: [],
    id: "msg_user",
    time: { created: 1 },
    type: "user",
  } as unknown as SessionMessageInfo;
  const current = transcriptData([user, assistantMessage("text")]);
  const rejected = [
    transcriptEvent("session.text.started", { assistantMessageID: "msg_assistant" }),
    assistantEvent("session.step.started", {
      agent: "build",
      assistantMessageID: "msg_user",
      model: { id: "model-1", providerID: "provider-1" },
    }),
    assistantEvent("session.text.ended", {
      assistantMessageID: "msg_missing",
      ordinal: 0,
      text: "",
    }),
    assistantEvent("session.text.delta", { delta: "x", ordinal: 1 }),
    assistantEvent("session.reasoning.delta", { delta: "x", ordinal: 0 }),
    assistantEvent("session.reasoning.ended", { ordinal: 0, text: "x" }),
    assistantEvent("session.tool.input.delta", { delta: "x", id: "tool-1" }),
    assistantEvent("session.tool.progress", { id: "tool-1", metadata: {} }),
    assistantEvent("session.tool.failed", { error: toolError, executed: false, id: "tool-1" }),
  ];

  for (const event of rejected) {
    const result = reduceTranscriptEvents(current, [event]);
    expect(result).toEqual({ data: current, needsReconciliation: true });
    expect(result.data).toBe(current);
  }
});

test("keeps the cache when an event changes nothing", () => {
  const current = transcriptData([assistantMessage("text")]);
  const result = reduceTranscriptEvents(current, [
    textStarted(0),
    assistantEvent("session.text.delta", { delta: "", ordinal: 0 }),
  ]);

  expect(result).toEqual({ data: current, needsReconciliation: false });
  expect(result.data).toBe(current);
});

test("reopens an existing assistant when a new step starts", () => {
  const current = transcriptData([
    {
      ...assistantMessage("text"),
      error: toolError,
      finish: "error",
      retry: { at: 2, attempt: 1, error: toolError },
      snapshot: { end: "old-end", start: "old-start" },
      time: { completed: 2, created: 1 },
    },
  ]);
  const withSnapshot = reduceTranscriptEvents(current, [
    assistantEvent("session.step.started", {
      agent: "plan",
      model: { id: "model-2", providerID: "provider-2" },
      snapshot: "new-start",
    }),
  ]);
  const withoutSnapshot = reduceTranscriptEvents(current, [stepStarted()]);

  expect(withSnapshot.data?.pages[0]?.data[0]).toEqual({
    agent: "plan",
    content: [{ text: "text", type: "text" }],
    id: "msg_assistant",
    model: { id: "model-2", providerID: "provider-2" },
    snapshot: { end: "old-end", start: "new-start" },
    time: { created: 1 },
    type: "assistant",
  });
  expect(withoutSnapshot.data?.pages[0]?.data[0]).toMatchObject({
    snapshot: { end: "old-end", start: "old-start" },
  });
  expect(withoutSnapshot.data?.pages[0]?.data[0]).not.toHaveProperty("error");
});

test("settles a failed step with whatever usage the provider reported", () => {
  const started = reduceTranscriptEvents(transcriptData([]), [
    stepStarted(),
    assistantEvent("session.retry.scheduled", { at: 5, attempt: 2, error: toolError }),
  ]).data;
  const retrying = started?.pages[0]?.data[0];
  const minimal = reduceTranscriptEvents(started, [
    assistantEvent("session.step.failed", { error: toolError }),
  ]);
  const detailed = reduceTranscriptEvents(started, [
    assistantEvent("session.step.failed", {
      cost: 0.5,
      error: { ...toolError, status: 429 },
      files: ["a.ts"],
      finish: "content-filter",
      rawFinish: "blocked",
      snapshot: "end-snapshot",
      tokens: { cache: { read: 0, write: 0 }, input: 1, output: 2, reasoning: 3 },
    }),
  ]);

  expect(retrying).toMatchObject({ retry: { at: 5, attempt: 2, error: toolError } });
  expect(minimal.data?.pages[0]?.data[0]).toEqual({
    agent: "build",
    content: [],
    error: toolError,
    finish: "error",
    id: "msg_assistant",
    model: { id: "model-1", providerID: "provider-1" },
    time: { completed: 1, created: 1 },
    type: "assistant",
  });
  expect(detailed.data?.pages[0]?.data[0]).toEqual({
    agent: "build",
    content: [],
    cost: 0.5,
    error: { ...toolError, status: 429 },
    finish: "content-filter",
    id: "msg_assistant",
    model: { id: "model-1", providerID: "provider-1" },
    rawFinish: "blocked",
    snapshot: { end: "end-snapshot", files: ["a.ts"] },
    time: { completed: 1, created: 1 },
    tokens: { cache: { read: 0, write: 0 }, input: 1, output: 2, reasoning: 3 },
    type: "assistant",
  });
});

test("ends a step without optional fields", () => {
  const result = reduceTranscriptEvents(transcriptData([]), [
    stepStarted(),
    assistantEvent("session.step.ended", {
      cost: 0,
      finish: "tool-calls",
      tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
    }),
  ]);
  const assistant = result.data?.pages[0]?.data[0];

  expect(assistant).toMatchObject({ finish: "tool-calls", time: { completed: 1, created: 1 } });
  expect(assistant).not.toHaveProperty("snapshot");
  expect(assistant).not.toHaveProperty("rawFinish");
});

test("fails a streaming tool without metadata", () => {
  const result = reduceTranscriptEvents(transcriptData([]), [
    stepStarted(),
    toolInputStarted(),
    assistantEvent("session.tool.failed", { error: toolError, executed: false, id: "tool-1" }),
  ]);

  expect(result.needsReconciliation).toBe(false);
  expect(toolPart(result.data)).toEqual({
    executed: false,
    id: "tool-1",
    name: "read",
    state: { error: toolError, input: {}, status: "error" },
    time: { completed: 1, created: 1 },
    type: "tool",
  });
});

test("fails a running tool and keeps its progress unless the failure reports metadata", () => {
  const running = reduceTranscriptEvents(transcriptData([]), [
    stepStarted(),
    toolInputStarted(),
    assistantEvent("session.tool.called", { executed: true, id: "tool-1", input: { path: "a" } }),
    assistantEvent("session.tool.progress", { id: "tool-1", metadata: { progress: 0.5 } }),
  ]).data;
  const kept = reduceTranscriptEvents(running, [
    assistantEvent("session.tool.failed", { error: toolError, executed: false, id: "tool-1" }),
  ]);
  const replaced = reduceTranscriptEvents(running, [
    assistantEvent("session.tool.failed", {
      content: [{ text: "partial", type: "text" }],
      error: toolError,
      executed: false,
      id: "tool-1",
      metadata: { progress: 0.9 },
    }),
  ]);

  expect(toolPart(kept.data)).toEqual({
    executed: true,
    id: "tool-1",
    name: "read",
    state: { error: toolError, input: { path: "a" }, metadata: { progress: 0.5 }, status: "error" },
    time: { completed: 1, created: 1, ran: 1 },
    type: "tool",
  });
  expect(toolPart(replaced.data)).toMatchObject({
    state: {
      content: [{ text: "partial", type: "text" }],
      error: toolError,
      input: { path: "a" },
      metadata: { progress: 0.9 },
      status: "error",
    },
  });
});

test("completes a tool with text and named file content", () => {
  const result = reduceTranscriptEvents(transcriptData([]), [
    stepStarted(),
    toolInputStarted(),
    assistantEvent("session.tool.called", { executed: false, id: "tool-1", input: {} }),
    assistantEvent("session.tool.success", {
      content: [
        { text: "ok", type: "text" },
        { mime: "text/plain", name: "a.txt", type: "file", uri: "file:///a" },
      ],
      executed: false,
      id: "tool-1",
    }),
  ]);

  expect(toolPart(result.data)).toEqual({
    executed: false,
    id: "tool-1",
    name: "read",
    state: {
      content: [
        { text: "ok", type: "text" },
        { mime: "text/plain", name: "a.txt", type: "file", uri: "file:///a" },
      ],
      input: {},
      status: "completed",
    },
    time: { completed: 1, created: 1, ran: 1 },
    type: "tool",
  });
});

test("accepts a repeated tool start only for the same tool name", () => {
  const started = reduceTranscriptEvents(transcriptData([]), [stepStarted(), toolInputStarted()]);
  const repeated = reduceTranscriptEvents(started.data, [toolInputStarted()]);
  const renamed = reduceTranscriptEvents(started.data, [
    assistantEvent("session.tool.input.started", { id: "tool-1", name: "write" }),
  ]);

  expect(repeated).toEqual({ data: started.data, needsReconciliation: false });
  expect(repeated.data).toBe(started.data);
  expect(renamed.needsReconciliation).toBe(true);
});

test("caps streamed text and tool input at the streaming limit", () => {
  const limit = 128_000;
  const result = reduceTranscriptEvents(transcriptData([]), [
    stepStarted(),
    textStarted(0),
    assistantEvent("session.text.delta", { delta: "a".repeat(limit - 1), ordinal: 0 }),
    assistantEvent("session.text.delta", { delta: "bc", ordinal: 0 }),
    assistantEvent("session.text.delta", { delta: "d", ordinal: 0 }),
    toolInputStarted(),
    assistantEvent("session.tool.input.delta", { delta: "", id: "tool-1" }),
    assistantEvent("session.tool.input.delta", { delta: "x".repeat(limit), id: "tool-1" }),
    assistantEvent("session.tool.input.delta", { delta: "y", id: "tool-1" }),
  ]);
  const assistant = result.data?.pages[0]?.data[0];
  const content = assistant?.type === "assistant" ? assistant.content : [];

  expect(result.needsReconciliation).toBe(false);
  expect(content[0]).toEqual({ text: `${"a".repeat(limit - 1)}b`, type: "text" });
  expect(content[1]).toMatchObject({ state: { input: "x".repeat(limit), status: "streaming" } });
});

const toolError = { message: "failed", type: "tool" };

function assistantEvent(type: string, data: Record<string, unknown>) {
  return transcriptEvent(type, {
    assistantMessageID: "msg_assistant",
    sessionID: "session-1",
    ...data,
  });
}

function toolInputStarted() {
  return assistantEvent("session.tool.input.started", { id: "tool-1", name: "read" });
}

function toolPart(data: InfiniteData<SessionMessagesResponse, string | undefined> | undefined) {
  const assistant = data?.pages[0]?.data[0];
  return assistant?.type === "assistant"
    ? assistant.content.find((part) => part.type === "tool")
    : undefined;
}

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

function assistantMessage(text: string): Extract<SessionMessageInfo, { type: "assistant" }> {
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
