import type { OpenCodeEvent, SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";

type AssistantMessage = Extract<SessionMessageInfo, { type: "assistant" }>;
type AssistantTool = Extract<AssistantMessage["content"][number], { type: "tool" }>;
type ToolContent = Extract<AssistantTool["state"], { status: "completed" }>["content"][number];
type ToolInput = Extract<AssistantTool["state"], { status: "running" }>["input"];
type EventData = Record<string, unknown>;

export const maxStreamingInputCharacters = 128_000;

const stepFinishes = new Set<unknown>([
  "stop",
  "length",
  "tool-calls",
  "content-filter",
  "error",
  "unknown",
]);

const transcriptEventValidators: Record<string, (data: EventData) => boolean> = {
  "session.step.started": isStepStartedData,
  "session.step.ended": isStepEndedData,
  "session.step.failed": isStepFailedData,
  "session.text.started": isPartStartedData,
  "session.text.delta": isPartDeltaData,
  "session.text.ended": isPartEndedData,
  "session.reasoning.started": isPartStartedData,
  "session.reasoning.delta": isPartDeltaData,
  "session.reasoning.ended": isPartEndedData,
  "session.tool.input.started": isToolInputStartedData,
  "session.tool.input.delta": isToolInputDeltaData,
  "session.tool.input.ended": isToolInputEndedData,
  "session.tool.called": isToolCalledData,
  "session.tool.progress": isToolProgressData,
  "session.tool.success": isToolSuccessData,
  "session.tool.failed": isToolFailedData,
  "session.retry.scheduled": isRetryScheduledData,
};

const transcriptReductionEventTypes = new Set<string>(Object.keys(transcriptEventValidators));

export function isTranscriptReductionEventType(type: string) {
  return transcriptReductionEventTypes.has(type);
}

export function isValidTranscriptReductionEvent(event: OpenCodeEvent) {
  if (!isTranscriptReductionEventType(event.type) || !isCommonEventData(event.data)) return false;
  if (!isEventTime((event as unknown as Record<string, unknown>).created)) return false;
  return transcriptEventValidators[event.type]?.(event.data) === true;
}

export function transcriptEventSessionID(event: OpenCodeEvent) {
  const data: unknown = event.data;
  return isCommonEventData(data) ? data.sessionID : undefined;
}

function isStepStartedData(data: EventData) {
  return (
    isMessageID(data.assistantMessageID) &&
    isBoundedString(data.agent) &&
    isModelRef(data.model) &&
    isOptionalSnapshot(data.snapshot)
  );
}

function isStepEndedData(data: EventData) {
  return (
    isMessageID(data.assistantMessageID) &&
    stepFinishes.has(data.finish) &&
    isFiniteNumber(data.cost) &&
    isTokenUsage(data.tokens) &&
    isOptionalBoundedString(data.rawFinish) &&
    isOptionalSnapshot(data.snapshot) &&
    isOptionalStringArray(data.files)
  );
}

function isStepFailedData(data: EventData) {
  return (
    isMessageID(data.assistantMessageID) &&
    isStructuredError(data.error) &&
    (data.finish === undefined || data.finish === "content-filter") &&
    isOptionalBoundedString(data.rawFinish) &&
    (data.cost === undefined || isFiniteNumber(data.cost)) &&
    (data.tokens === undefined || isTokenUsage(data.tokens)) &&
    isOptionalSnapshot(data.snapshot) &&
    isOptionalStringArray(data.files)
  );
}

function isPartStartedData(data: EventData) {
  return isMessageID(data.assistantMessageID) && isOrdinal(data.ordinal);
}

function isPartDeltaData(data: EventData) {
  return isPartStartedData(data) && isBoundedString(data.delta);
}

function isPartEndedData(data: EventData) {
  return isPartStartedData(data) && isBoundedString(data.text);
}

function isToolEventData(data: EventData) {
  return isMessageID(data.assistantMessageID) && isToolID(data.id);
}

function isToolInputStartedData(data: EventData) {
  return isToolEventData(data) && isBoundedString(data.name);
}

function isToolInputDeltaData(data: EventData) {
  return isToolEventData(data) && isBoundedString(data.delta);
}

function isToolInputEndedData(data: EventData) {
  return isToolEventData(data) && isBoundedString(data.text);
}

function isToolCalledData(data: EventData) {
  return isToolEventData(data) && isJsonRecord(data.input) && typeof data.executed === "boolean";
}

function isToolProgressData(data: EventData) {
  return isToolEventData(data) && isJsonRecord(data.metadata);
}

function isToolSuccessData(data: EventData) {
  return (
    isToolEventData(data) &&
    typeof data.executed === "boolean" &&
    isToolContentList(data.content) &&
    isOptionalJsonRecord(data.metadata)
  );
}

function isToolFailedData(data: EventData) {
  return (
    isToolEventData(data) &&
    typeof data.executed === "boolean" &&
    isStructuredError(data.error) &&
    (data.content === undefined || isToolContentList(data.content)) &&
    isOptionalJsonRecord(data.metadata)
  );
}

function isRetryScheduledData(data: EventData) {
  return (
    isMessageID(data.assistantMessageID) &&
    typeof data.attempt === "number" &&
    Number.isInteger(data.attempt) &&
    data.attempt >= 0 &&
    isEventTime(data.at) &&
    isStructuredError(data.error)
  );
}

function isCommonEventData(value: unknown): value is EventData & { sessionID: string } {
  return (
    isRecord(value) &&
    typeof value.sessionID === "string" &&
    value.sessionID.length > 0 &&
    value.sessionID.length <= 256
  );
}

function isMessageID(value: unknown) {
  return typeof value === "string" && /^msg_/.test(value) && value.length <= 256;
}

function isToolID(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function isOrdinal(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000;
}

function isEventTime(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoundedString(value: unknown, limit = maxStreamingInputCharacters) {
  return typeof value === "string" && value.length <= limit;
}

function isOptionalBoundedString(value: unknown) {
  return value === undefined || isBoundedString(value);
}

function isOptionalSnapshot(value: unknown) {
  return value === undefined || isBoundedString(value, 4096);
}

function isOptionalStringArray(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 10_000 &&
      value.every((item) => isBoundedString(item, 4096)))
  );
}

function isTokenUsage(value: unknown) {
  return (
    isRecord(value) &&
    isFiniteNumber(value.input) &&
    isFiniteNumber(value.output) &&
    isFiniteNumber(value.reasoning) &&
    isRecord(value.cache) &&
    isFiniteNumber(value.cache.read) &&
    isFiniteNumber(value.cache.write)
  );
}

function isModelRef(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Boolean(value.id) &&
    typeof value.providerID === "string" &&
    Boolean(value.providerID) &&
    (value.variant === undefined || typeof value.variant === "string")
  );
}

function isStructuredError(value: unknown) {
  return (
    isRecord(value) &&
    isBoundedString(value.type, 256) &&
    isBoundedString(value.message) &&
    (value.status === undefined || isFiniteNumber(value.status))
  );
}

function isToolContentList(value: unknown) {
  return (
    Array.isArray(value) && value.length > 0 && value.length <= 256 && value.every(isToolContent)
  );
}

function isToolContent(value: unknown): value is ToolContent {
  return (
    isRecord(value) &&
    ((value.type === "text" && isBoundedString(value.text)) ||
      (value.type === "file" &&
        isBoundedString(value.uri, 4096) &&
        isBoundedString(value.mime, 256) &&
        (value.name === undefined || value.name === null || isBoundedString(value.name, 1024))))
  );
}

function isOptionalJsonRecord(value: unknown) {
  return value === undefined || isJsonRecord(value);
}

function isJsonRecord(value: unknown, depth = 0): value is ToolInput {
  if (depth > 32 || !isRecord(value)) return false;
  const values = Object.values(value);
  return values.length <= 10_000 && values.every((item) => isJsonValue(item, depth + 1));
}

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > 32) return false;
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) &&
      value.length <= 10_000 &&
      value.every((item) => isJsonValue(item, depth + 1))) ||
    isJsonRecord(value, depth)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
