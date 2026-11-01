import { expect, test } from "@jest/globals";
import type { OpenCodeEvent } from "@opencode2-mobile/opencode-adapter";

import {
  isTranscriptReductionEventType,
  isValidTranscriptReductionEvent,
  transcriptEventSessionID,
} from "./transcript-event-validation";

const error = { message: "failed", type: "provider" };
const tokens = { cache: { read: 1, write: 2 }, input: 3, output: 4, reasoning: 5 };
const model = { id: "model-1", providerID: "provider-1" };
const textContent = { text: "done", type: "text" };
const fileContent = { mime: "text/plain", type: "file", uri: "file:///a" };

const validData: Record<string, Record<string, unknown>> = {
  "session.retry.scheduled": { at: 2, attempt: 0, error },
  "session.reasoning.delta": { delta: "thinking", ordinal: 0 },
  "session.reasoning.ended": { ordinal: 0, text: "thought" },
  "session.reasoning.started": { ordinal: 0 },
  "session.step.ended": { cost: 0, finish: "stop", tokens },
  "session.step.failed": { error },
  "session.step.started": { agent: "build", model },
  "session.text.delta": { delta: "hi", ordinal: 0 },
  "session.text.ended": { ordinal: 0, text: "hi" },
  "session.text.started": { ordinal: 0 },
  "session.tool.called": { executed: false, id: "tool-1", input: { path: "a.ts" } },
  "session.tool.failed": { error, executed: false, id: "tool-1" },
  "session.tool.input.delta": { delta: "{", id: "tool-1" },
  "session.tool.input.ended": { id: "tool-1", text: "{}" },
  "session.tool.input.started": { id: "tool-1", name: "read" },
  "session.tool.progress": { id: "tool-1", metadata: { progress: 0.5 } },
  "session.tool.success": { content: [textContent], executed: true, id: "tool-1" },
};

const eventTypes = Object.keys(validData);

const validVariants: Array<[string, Record<string, unknown>]> = [
  ["session.step.started", { model: { ...model, variant: "high" }, snapshot: "snap" }],
  ...["length", "tool-calls", "content-filter", "error", "unknown"].map(
    (finish): [string, Record<string, unknown>] => ["session.step.ended", { finish }],
  ),
  ["session.step.ended", { files: ["a.ts"], rawFinish: "end_turn", snapshot: "snap" }],
  [
    "session.step.failed",
    {
      cost: 1,
      error: { ...error, status: 500 },
      files: [],
      finish: "content-filter",
      rawFinish: "blocked",
      snapshot: "snap",
      tokens,
    },
  ],
  [
    "session.tool.called",
    { input: { list: [1, "two", true, null, { nested: [] }], value: { deep: { x: 1 } } } },
  ],
  ["session.tool.success", { content: [fileContent, { ...fileContent, name: "a.txt" }] }],
  ["session.tool.success", { content: [{ ...fileContent, name: null }], metadata: {} }],
  ["session.tool.failed", { content: [textContent], metadata: { reason: "x" } }],
  ["session.text.started", { ordinal: 10_000 }],
];

const invalidVariants: Array<[string, Record<string, unknown>]> = [
  ...eventTypes.map((type): [string, Record<string, unknown>] => [
    type,
    { assistantMessageID: "assistant" },
  ]),
  ["session.step.started", { assistantMessageID: `msg_${"x".repeat(253)}` }],
  ["session.step.started", { agent: 1 }],
  ["session.step.started", { model: "model-1" }],
  ["session.step.started", { model: { ...model, id: "" } }],
  ["session.step.started", { model: { ...model, providerID: "" } }],
  ["session.step.started", { model: { ...model, providerID: 1 } }],
  ["session.step.started", { model: { ...model, variant: 1 } }],
  ["session.step.started", { snapshot: "x".repeat(4097) }],
  ["session.step.ended", { finish: "done" }],
  ["session.step.ended", { cost: Number.NaN }],
  ["session.step.ended", { tokens: undefined }],
  ["session.step.ended", { tokens: { ...tokens, input: "3" } }],
  ["session.step.ended", { tokens: { ...tokens, output: undefined } }],
  ["session.step.ended", { tokens: { ...tokens, reasoning: Infinity } }],
  ["session.step.ended", { tokens: { ...tokens, cache: [] } }],
  ["session.step.ended", { tokens: { ...tokens, cache: { read: "1", write: 2 } } }],
  ["session.step.ended", { tokens: { ...tokens, cache: { read: 1 } } }],
  ["session.step.ended", { rawFinish: 1 }],
  ["session.step.ended", { snapshot: 1 }],
  ["session.step.ended", { files: "a.ts" }],
  ["session.step.ended", { files: ["x".repeat(4097)] }],
  ["session.step.ended", { files: Array.from({ length: 10_001 }, () => "a") }],
  ["session.step.failed", { error: undefined }],
  ["session.step.failed", { error: { ...error, type: "x".repeat(257) } }],
  ["session.step.failed", { error: { ...error, message: 1 } }],
  ["session.step.failed", { error: { ...error, status: "500" } }],
  ["session.step.failed", { finish: "stop" }],
  ["session.step.failed", { rawFinish: false }],
  ["session.step.failed", { cost: "1" }],
  ["session.step.failed", { tokens: {} }],
  ["session.step.failed", { snapshot: 1 }],
  ["session.step.failed", { files: [1] }],
  ["session.text.started", { ordinal: -1 }],
  ["session.text.started", { ordinal: 0.5 }],
  ["session.text.started", { ordinal: 10_001 }],
  ["session.text.started", { ordinal: "0" }],
  ["session.text.delta", { delta: undefined }],
  ["session.text.delta", { ordinal: undefined }],
  ["session.text.ended", { text: 1 }],
  ["session.text.ended", { ordinal: undefined }],
  ["session.reasoning.delta", { delta: "x".repeat(128_001) }],
  ["session.reasoning.ended", { text: undefined }],
  ["session.tool.input.started", { id: "" }],
  ["session.tool.input.started", { id: "x".repeat(257) }],
  ["session.tool.input.started", { name: undefined }],
  ["session.tool.input.delta", { id: 1 }],
  ["session.tool.input.delta", { delta: 1 }],
  ["session.tool.input.ended", { text: undefined }],
  ["session.tool.called", { input: [] }],
  ["session.tool.called", { input: { value: Number.NaN } }],
  ["session.tool.called", { input: { value: undefined } }],
  ["session.tool.called", { input: { value: [undefined] } }],
  ["session.tool.called", { input: { list: Array.from({ length: 10_001 }, () => 1) } }],
  [
    "session.tool.called",
    { input: Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => [`k${i}`, 1])) },
  ],
  ["session.tool.called", { input: nestedRecord(33) }],
  ["session.tool.called", { input: nestedArray(33) }],
  ["session.tool.called", { executed: "yes" }],
  ["session.tool.progress", { metadata: undefined }],
  ["session.tool.success", { executed: undefined }],
  ["session.tool.success", { content: textContent }],
  ["session.tool.success", { content: [] }],
  ["session.tool.success", { content: Array.from({ length: 257 }, () => textContent) }],
  ["session.tool.success", { content: [null] }],
  ["session.tool.success", { content: [{ text: 1, type: "text" }] }],
  ["session.tool.success", { content: [{ ...fileContent, type: "image" }] }],
  ["session.tool.success", { content: [{ ...fileContent, uri: "x".repeat(4097) }] }],
  ["session.tool.success", { content: [{ ...fileContent, mime: undefined }] }],
  ["session.tool.success", { content: [{ ...fileContent, name: "x".repeat(1025) }] }],
  ["session.tool.success", { metadata: null }],
  ["session.tool.failed", { executed: 0 }],
  ["session.tool.failed", { error: "failed" }],
  ["session.tool.failed", { content: [] }],
  ["session.tool.failed", { metadata: [] }],
  ["session.retry.scheduled", { attempt: "1" }],
  ["session.retry.scheduled", { attempt: 1.5 }],
  ["session.retry.scheduled", { attempt: -1 }],
  ["session.retry.scheduled", { at: -1 }],
  ["session.retry.scheduled", { at: Infinity }],
  ["session.retry.scheduled", { error: { message: "failed" } }],
];

test.each(eventTypes)("accepts a minimal %s event", (type) => {
  expect(isTranscriptReductionEventType(type)).toBe(true);
  expect(isValidTranscriptReductionEvent(transcriptEvent(type))).toBe(true);
});

test.each(validVariants)("accepts %s with %j", (type, overrides) => {
  expect(isValidTranscriptReductionEvent(transcriptEvent(type, overrides))).toBe(true);
});

test.each(invalidVariants)("rejects %s with %j", (type, overrides) => {
  expect(isValidTranscriptReductionEvent(transcriptEvent(type, overrides))).toBe(false);
});

test.each(eventTypes)("rejects %s without a valid session or creation time", (type) => {
  const event = transcriptEvent(type);
  expect(isValidTranscriptReductionEvent({ ...event, data: undefined } as never)).toBe(false);
  expect(isValidTranscriptReductionEvent(transcriptEvent(type, { sessionID: "" }))).toBe(false);
  expect(
    isValidTranscriptReductionEvent(transcriptEvent(type, { sessionID: "s".repeat(257) })),
  ).toBe(false);
  expect(isValidTranscriptReductionEvent({ ...event, created: -1 } as OpenCodeEvent)).toBe(false);
  expect(isValidTranscriptReductionEvent({ ...event, created: Number.NaN } as OpenCodeEvent)).toBe(
    false,
  );
});

test("ignores events outside the transcript projection", () => {
  const event = { ...transcriptEvent("session.text.started"), type: "session.updated" };

  expect(isTranscriptReductionEventType("session.updated")).toBe(false);
  expect(isTranscriptReductionEventType("constructor")).toBe(false);
  expect(isValidTranscriptReductionEvent(event as OpenCodeEvent)).toBe(false);
  expect(
    isValidTranscriptReductionEvent({ ...event, type: "toString" } as unknown as OpenCodeEvent),
  ).toBe(false);
});

test("reads the session ID only from well-formed event data", () => {
  expect(transcriptEventSessionID(transcriptEvent("session.text.started"))).toBe("session-1");
  expect(
    transcriptEventSessionID({
      data: [],
      type: "session.text.started",
    } as unknown as OpenCodeEvent),
  ).toBeUndefined();
});

function transcriptEvent(type: string, overrides: Record<string, unknown> = {}) {
  return {
    created: 1,
    data: {
      assistantMessageID: "msg_assistant",
      sessionID: "session-1",
      ...validData[type],
      ...overrides,
    },
    id: "event-1",
    type,
  } as unknown as OpenCodeEvent;
}

function nestedRecord(depth: number): Record<string, unknown> {
  return depth === 0 ? {} : { child: nestedRecord(depth - 1) };
}

function nestedArray(depth: number): Record<string, unknown> {
  let value: unknown = 1;
  for (let index = 0; index < depth; index += 1) value = [value];
  return { value };
}
