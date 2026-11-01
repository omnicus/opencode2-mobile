import type {
  OpenCodeEvent,
  SessionMessageInfo,
  SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";
import type { InfiniteData } from "@tanstack/react-query";

import {
  isValidTranscriptReductionEvent,
  maxStreamingInputCharacters,
} from "./transcript-event-validation";

export {
  isTranscriptReductionEventType,
  isValidTranscriptReductionEvent,
  transcriptEventSessionID,
} from "./transcript-event-validation";

type AssistantMessage = Extract<SessionMessageInfo, { type: "assistant" }>;
type AssistantPart = AssistantMessage["content"][number];
type AssistantTool = Extract<AssistantPart, { type: "tool" }>;
type ToolContent = Extract<AssistantTool["state"], { status: "completed" }>["content"][number];
type RunningToolState = Extract<AssistantTool["state"], { status: "running" }>;
type ToolInput = RunningToolState["input"];

export function reduceTranscriptEvents(
  current: InfiniteData<SessionMessagesResponse, string | undefined> | undefined,
  events: OpenCodeEvent[],
  allowMessageCreation = true,
) {
  if (!current) return { data: current, needsReconciliation: false };
  if (!Array.isArray(current.pages) || current.pages.length === 0) {
    return { data: current, needsReconciliation: true };
  }
  let next = current;
  let needsReconciliation = false;
  for (const event of events) {
    if (
      !isValidTranscriptReductionEvent(event) ||
      !canReduceTranscriptEvent(next, event, allowMessageCreation)
    ) {
      needsReconciliation = true;
      continue;
    }
    next = reduceTranscriptEvent(next, event, allowMessageCreation);
  }
  return { data: next, needsReconciliation };
}

// Text deltas carry no offset. While a transcript refetch is in flight, the bridge holds
// deltas instead of appending them to text the refetch will replace. The refetched text
// already ends with whichever held deltas the server had applied, so drop those and keep
// the rest. Only whole-delta boundaries count, so a coincidental shared character at the
// end of the text cannot hide a delta.
export function textPartKey(event: OpenCodeEvent) {
  if (
    event.type !== "session.text.started" &&
    event.type !== "session.text.delta" &&
    event.type !== "session.text.ended" &&
    event.type !== "session.reasoning.started" &&
    event.type !== "session.reasoning.delta" &&
    event.type !== "session.reasoning.ended"
  ) {
    return undefined;
  }
  const type = event.type.startsWith("session.text.") ? "text" : "reasoning";
  return `${event.data.assistantMessageID}\u0000${type}\u0000${event.data.ordinal}`;
}

export function trimSnapshotTextDeltas(
  snapshot: InfiniteData<SessionMessagesResponse, string | undefined>,
  events: OpenCodeEvent[],
  continued?: Set<string>,
) {
  const dropped = new Set<number>();
  for (const [key, indexes] of heldTextDeltas(events)) {
    const text = snapshotPartText(snapshot, key);
    if (!text) continue;
    const included = includedDeltaCount(text, events, indexes);
    for (const index of indexes.slice(0, included)) dropped.add(index);
    // The refetched text ends exactly where these deltas pick up, so the part is continuous.
    if (included > 0) continued?.add(key);
  }
  return dropped.size === 0 ? events : events.filter((_, index) => !dropped.has(index));
}

function heldTextDeltas(events: OpenCodeEvent[]) {
  const deltas = new Map<string, number[]>();
  events.forEach((event, index) => {
    if (event.type !== "session.text.delta" && event.type !== "session.reasoning.delta") return;
    const key = textPartKey(event);
    if (key) deltas.set(key, [...(deltas.get(key) ?? []), index]);
  });
  return deltas;
}

function snapshotPartText(
  snapshot: InfiniteData<SessionMessagesResponse, string | undefined>,
  key: string,
) {
  const [messageID = "", type, ordinal] = key.split("\u0000");
  const message = findAssistantMessage(snapshot, messageID);
  const part =
    message && (type === "text" || type === "reasoning")
      ? findTextPart(message, Number(ordinal), type)?.part
      : undefined;
  return part?.text;
}

function includedDeltaCount(text: string, events: OpenCodeEvent[], indexes: number[]) {
  let prefix = "";
  let included = 0;
  for (const [count, index] of indexes.entries()) {
    const event = events[index];
    if (event?.type !== "session.text.delta" && event?.type !== "session.reasoning.delta") break;
    prefix += event.data.delta;
    if (prefix.length > text.length) break;
    if (text.endsWith(prefix)) included = count + 1;
  }
  return included;
}

function reduceTranscriptEvent(
  current: InfiniteData<SessionMessagesResponse, string | undefined>,
  event: OpenCodeEvent,
  allowMessageCreation: boolean,
) {
  switch (event.type) {
    case "session.step.started":
      return startAssistantMessage(current, event, allowMessageCreation);
    case "session.step.ended":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        endAssistantStep(message, event),
      );
    case "session.step.failed":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        failAssistantStep(message, event),
      );
    case "session.text.started":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        startTextPart(message, event.data.ordinal, "text", event.created),
      );
    case "session.text.delta":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        appendPartDelta(message, event.data.ordinal, "text", event.data.delta),
      );
    case "session.text.ended":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        finishTextPart(message, event.data.ordinal, "text", event.created, event.data.text),
      );
    case "session.reasoning.started":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        startTextPart(message, event.data.ordinal, "reasoning", event.created),
      );
    case "session.reasoning.delta":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        appendPartDelta(message, event.data.ordinal, "reasoning", event.data.delta),
      );
    case "session.reasoning.ended":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        finishTextPart(message, event.data.ordinal, "reasoning", event.created, event.data.text),
      );
    case "session.tool.input.started":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        addStreamingTool(message, event.data.id, event.data.name, event.created),
      );
    case "session.tool.input.delta":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        appendToolInput(message, event.data.id, event.data.delta),
      );
    case "session.tool.input.ended":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        setToolInput(message, event.data.id, event.data.text),
      );
    case "session.tool.called":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        setToolRunning(
          message,
          event.data.id,
          event.data.input,
          event.data.executed,
          event.created,
        ),
      );
    case "session.tool.progress":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        setToolProgress(message, event.data.id, event.data.metadata),
      );
    case "session.tool.success":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        setToolCompleted(
          message,
          event.data.id,
          normalizeToolContent(event.data.content),
          event.data.metadata,
          event.data.executed,
          event.created,
        ),
      );
    case "session.tool.failed":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) =>
        setToolFailed(
          message,
          event.data.id,
          event.data.error,
          event.data.content ? normalizeToolContent(event.data.content) : undefined,
          event.data.metadata,
          event.data.executed,
          event.created,
        ),
      );
    case "session.retry.scheduled":
      return updateAssistantMessage(current, event.data.assistantMessageID, (message) => ({
        ...message,
        retry: {
          at: event.data.at,
          attempt: event.data.attempt,
          error: event.data.error,
        },
      }));
    default:
      return current;
  }
}

function startAssistantMessage(
  current: InfiniteData<SessionMessagesResponse, string | undefined>,
  event: Extract<OpenCodeEvent, { type: "session.step.started" }>,
  allowMessageCreation: boolean,
) {
  if (findMessage(current, event.data.assistantMessageID)) {
    return updateAssistantMessage(current, event.data.assistantMessageID, (message) => {
      const { error: _error, finish: _finish, retry: _retry, ...openMessage } = message;
      return {
        ...openMessage,
        agent: event.data.agent,
        model: event.data.model,
        ...(event.data.snapshot === undefined
          ? {}
          : { snapshot: { ...message.snapshot, start: event.data.snapshot } }),
        time: { created: event.created },
      };
    });
  }
  if (!allowMessageCreation) return current;
  const firstPage = current.pages[0];
  if (!firstPage) return current;
  const message: AssistantMessage = {
    agent: event.data.agent,
    content: [],
    id: event.data.assistantMessageID,
    model: event.data.model,
    ...(event.data.snapshot === undefined ? {} : { snapshot: { start: event.data.snapshot } }),
    time: { created: event.created },
    type: "assistant",
  };
  return {
    ...current,
    pages: [{ ...firstPage, data: [message, ...firstPage.data] }, ...current.pages.slice(1)],
  };
}

function endAssistantStep(
  message: AssistantMessage,
  event: Extract<OpenCodeEvent, { type: "session.step.ended" }>,
): AssistantMessage {
  const snapshot = finishSnapshot(message.snapshot, event.data.snapshot, event.data.files);
  return {
    ...message,
    cost: event.data.cost,
    finish: event.data.finish,
    ...(event.data.rawFinish === undefined ? {} : { rawFinish: event.data.rawFinish }),
    ...(snapshot === undefined ? {} : { snapshot }),
    time: { ...message.time, completed: event.created },
    tokens: event.data.tokens,
  };
}

function failAssistantStep(
  message: AssistantMessage,
  event: Extract<OpenCodeEvent, { type: "session.step.failed" }>,
): AssistantMessage {
  const { retry: _retry, ...settledMessage } = message;
  const snapshot = finishSnapshot(message.snapshot, event.data.snapshot, event.data.files);
  return {
    ...settledMessage,
    error: event.data.error,
    finish: event.data.finish ?? "error",
    ...(event.data.cost === undefined ? {} : { cost: event.data.cost }),
    ...(event.data.rawFinish === undefined ? {} : { rawFinish: event.data.rawFinish }),
    ...(snapshot === undefined ? {} : { snapshot }),
    time: { ...message.time, completed: event.created },
    ...(event.data.tokens === undefined ? {} : { tokens: event.data.tokens }),
  };
}

function updateAssistantMessage(
  current: InfiniteData<SessionMessagesResponse, string | undefined>,
  messageID: string,
  update: (message: AssistantMessage) => AssistantMessage,
) {
  let changed = false;
  const pages = current.pages.map((page) => {
    let pageChanged = false;
    const data = page.data.map((message) => {
      if (message.id !== messageID || message.type !== "assistant") return message;
      const next = update(message);
      if (next === message) return message;
      changed = true;
      pageChanged = true;
      return next;
    });
    return pageChanged ? { ...page, data } : page;
  });
  return changed ? { ...current, pages } : current;
}

function canReduceTranscriptEvent(
  current: InfiniteData<SessionMessagesResponse, string | undefined>,
  event: OpenCodeEvent,
  allowMessageCreation: boolean,
) {
  if (event.type === "session.step.started") {
    const existing = findMessage(current, event.data.assistantMessageID);
    return (
      Boolean(findAssistantMessage(current, event.data.assistantMessageID)) ||
      (!existing && allowMessageCreation)
    );
  }
  if (!("assistantMessageID" in event.data)) return false;
  const message = findAssistantMessage(current, event.data.assistantMessageID);
  return message !== undefined && canReduceMessageEvent(message, event);
}

function canReduceMessageEvent(message: AssistantMessage, event: OpenCodeEvent) {
  switch (event.type) {
    case "session.text.started":
      return canStartTextPart(message, event.data.ordinal, "text");
    case "session.reasoning.started":
      return canStartTextPart(message, event.data.ordinal, "reasoning");
    case "session.text.delta":
    case "session.text.ended":
      return Boolean(findTextPart(message, event.data.ordinal, "text"));
    case "session.reasoning.delta":
    case "session.reasoning.ended":
      return Boolean(findTextPart(message, event.data.ordinal, "reasoning"));
    case "session.tool.input.started":
      return (
        !findTool(message, event.data.id) ||
        findTool(message, event.data.id)?.name === event.data.name
      );
    case "session.tool.input.delta":
    case "session.tool.input.ended":
    case "session.tool.called":
      return findTool(message, event.data.id)?.state.status === "streaming";
    case "session.tool.progress":
    case "session.tool.success":
      return findTool(message, event.data.id)?.state.status === "running";
    case "session.tool.failed": {
      const status = findTool(message, event.data.id)?.state.status;
      return status === "streaming" || status === "running";
    }
    case "session.step.ended":
    case "session.step.failed":
    case "session.retry.scheduled":
      return true;
    default:
      return false;
  }
}

function canStartTextPart(message: AssistantMessage, ordinal: number, type: "reasoning" | "text") {
  const count = message.content.filter((part) => part.type === type).length;
  return ordinal <= count;
}

function findAssistantMessage(
  current: InfiniteData<SessionMessagesResponse, string | undefined>,
  messageID: string,
) {
  for (const page of current.pages) {
    const message = page.data.find(
      (candidate): candidate is AssistantMessage =>
        candidate.id === messageID && candidate.type === "assistant",
    );
    if (message) return message;
  }
  return undefined;
}

function findTextPart(message: AssistantMessage, ordinal: number, type: "reasoning" | "text") {
  let seen = 0;
  for (let index = 0; index < message.content.length; index += 1) {
    const part = message.content[index];
    if (part?.type !== type) continue;
    if (seen === ordinal) return { index, part };
    seen += 1;
  }
  return undefined;
}

function updateTextPart(
  message: AssistantMessage,
  ordinal: number,
  type: "reasoning" | "text",
  update: (
    part: Extract<AssistantPart, { type: "reasoning" | "text" }>,
  ) => Extract<AssistantPart, { type: "reasoning" | "text" }>,
) {
  const match = findTextPart(message, ordinal, type);
  if (!match) return message;
  const next = update(match.part);
  if (next === match.part) return message;
  const content = [...message.content];
  content[match.index] = next;
  return { ...message, content };
}

function startTextPart(
  message: AssistantMessage,
  ordinal: number,
  type: "reasoning" | "text",
  at: number,
) {
  const existing = findTextPart(message, ordinal, type);
  if (existing) return message;
  let part: Extract<AssistantPart, { type: "reasoning" | "text" }>;
  if (type === "text") {
    part = { text: "", type: "text" };
  } else {
    part = {
      text: "",
      time: { created: at },
      type: "reasoning",
    };
  }
  return { ...message, content: [...message.content, part] };
}

function finishTextPart(
  message: AssistantMessage,
  ordinal: number,
  type: "reasoning" | "text",
  at: number,
  text: string,
) {
  return updateTextPart(message, ordinal, type, (part) => {
    if (part.type === "text") {
      return {
        ...part,
        text,
      };
    }
    return {
      ...part,
      text,
      time: { created: part.time?.created ?? at, completed: at },
    };
  });
}

function appendPartDelta(
  message: AssistantMessage,
  ordinal: number,
  type: "reasoning" | "text",
  delta: string,
) {
  if (!delta) return message;
  return updateTextPart(message, ordinal, type, (part) => {
    const text = appendBounded(part.text, delta);
    return text === part.text ? part : { ...part, text };
  });
}

function addStreamingTool(message: AssistantMessage, id: string, name: string, at: number) {
  if (findTool(message, id)) return message;
  const tool: AssistantTool = {
    id,
    name,
    state: { input: "", status: "streaming" },
    time: { created: at },
    type: "tool",
  };
  return {
    ...message,
    content: [...message.content, tool],
  };
}

function appendToolInput(message: AssistantMessage, id: string, delta: string) {
  return updateTool(message, id, (tool) => {
    if (tool.state.status !== "streaming" || !delta) return tool;
    const input = appendBounded(tool.state.input, delta);
    return input === tool.state.input ? tool : { ...tool, state: { ...tool.state, input } };
  });
}

function setToolInput(message: AssistantMessage, id: string, input: string) {
  return updateTool(message, id, (tool) =>
    tool.state.status === "streaming"
      ? { ...tool, state: { ...tool.state, input: input.slice(0, maxStreamingInputCharacters) } }
      : tool,
  );
}

function setToolRunning(
  message: AssistantMessage,
  id: string,
  input: ToolInput,
  executed: boolean,
  at: number,
) {
  return updateTool(message, id, (tool) => ({
    ...tool,
    executed,
    state: { input, metadata: {}, status: "running" },
    time: { ...tool.time, ran: at },
  }));
}

function setToolProgress(message: AssistantMessage, id: string, metadata: ToolInput) {
  return updateTool(message, id, (tool) =>
    tool.state.status === "running" ? { ...tool, state: { ...tool.state, metadata } } : tool,
  );
}

function setToolCompleted(
  message: AssistantMessage,
  id: string,
  content: ToolContent[],
  metadata: ToolInput | undefined,
  executed: boolean,
  at: number,
) {
  return updateTool(message, id, (tool) => ({
    ...tool,
    executed: executed || tool.executed === true,
    state: {
      content: content as [ToolContent, ...ToolContent[]],
      input: toolInput(tool),
      ...(metadata ? { metadata } : {}),
      status: "completed",
    },
    time: { ...tool.time, completed: at },
  }));
}

function setToolFailed(
  message: AssistantMessage,
  id: string,
  error: { message: string; status?: number; type: string },
  content: ToolContent[] | undefined,
  metadata: ToolInput | undefined,
  executed: boolean,
  at: number,
) {
  return updateTool(message, id, (tool) => {
    const previousMetadata = tool.state.status === "running" ? tool.state.metadata : undefined;
    return {
      ...tool,
      executed: executed || tool.executed === true,
      state: {
        ...(content ? { content: content as [ToolContent, ...ToolContent[]] } : {}),
        error,
        input: toolInput(tool),
        ...(metadata === undefined
          ? previousMetadata === undefined
            ? {}
            : { metadata: previousMetadata }
          : { metadata }),
        status: "error",
      },
      time: { ...tool.time, completed: at },
    };
  });
}

function updateTool(
  message: AssistantMessage,
  id: string,
  update: (tool: AssistantTool) => AssistantTool,
) {
  const index = message.content.findIndex((part) => part.type === "tool" && part.id === id);
  if (index < 0) return message;
  const current = message.content[index];
  if (current?.type !== "tool") return message;
  const next = update(current);
  if (next === current) return message;
  const content = [...message.content];
  content[index] = next;
  return { ...message, content };
}

function findTool(message: AssistantMessage, id: string) {
  return message.content.find(
    (part): part is AssistantTool => part.type === "tool" && part.id === id,
  );
}

function toolInput(tool: AssistantTool) {
  return tool.state.status === "streaming" ? {} : tool.state.input;
}

function findMessage(
  current: InfiniteData<SessionMessagesResponse, string | undefined>,
  messageID: string,
) {
  return current.pages.some((page) => page.data.some((message) => message.id === messageID));
}

function finishSnapshot(
  current: AssistantMessage["snapshot"],
  end: string | undefined,
  files: string[] | undefined,
) {
  if (current === undefined && end === undefined && files === undefined) return undefined;
  return {
    ...current,
    ...(end === undefined ? {} : { end }),
    ...(files === undefined ? {} : { files }),
  };
}

function appendBounded(current: string, delta: string) {
  if (current.length >= maxStreamingInputCharacters) return current;
  return `${current}${delta}`.slice(0, maxStreamingInputCharacters);
}

function normalizeToolContent(
  content: Array<
    | { text: string; type: "text" }
    | { mime: string; name?: string | undefined; type: "file"; uri: string }
  >,
) {
  return content.map((item): ToolContent => {
    if (item.type === "text") return item;
    return {
      mime: item.mime,
      ...(item.name === undefined ? {} : { name: item.name }),
      type: "file",
      uri: item.uri,
    };
  });
}
