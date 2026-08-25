import type {
  SessionMessageInfo,
  SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";

type AssistantMessage = Extract<SessionMessageInfo, { type: "assistant" }>;
type AssistantTool = Extract<AssistantMessage["content"][number], { type: "tool" }>;

export type SubagentPresentation = {
  agent?: string;
  background: boolean;
  childSessionID?: string;
  result?: string;
  state: "completed" | "error" | "running" | "streaming";
  title: string;
};

export type SubagentProtocolText = {
  childSessionID?: string;
  matched: boolean;
  state?: "completed" | "error" | "running";
  summary?: string;
  text: string;
};

const maxProtocolCharacters = 128_000;
const sessionIDPattern = /^ses[A-Za-z0-9_-]+$/;

export function flattenTranscriptPages(pages: SessionMessagesResponse[] | undefined) {
  const seen = new Set<string>();
  const newestFirst: SessionMessageInfo[] = [];
  for (const page of pages ?? []) {
    for (const message of page.data) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      newestFirst.push(message);
    }
  }
  return newestFirst;
}

export function getSubagentPresentation(tool: AssistantTool): SubagentPresentation | undefined {
  const toolName = tool.name.trim().toLocaleLowerCase();
  if (toolName !== "subagent" && toolName !== "task") return undefined;

  const input = toolInput(tool);
  const metadata = toolMetadata(tool);
  const protocol = toolProtocolText(tool);
  const result = toolResultText(tool);
  const agent = firstString(input?.subagent_type, input?.agent, metadata?.agent);
  const childSessionID = firstSessionID(
    metadata?.sessionId,
    metadata?.sessionID,
    metadata?.session_id,
    metadata?.taskId,
    metadata?.task_id,
    protocol?.childSessionID,
  );
  const protocolState = protocol?.state;
  const state = protocolState ?? tool.state.status;
  return {
    ...(agent ? { agent } : {}),
    background:
      input?.background === true ||
      metadata?.background === true ||
      (tool.state.status === "completed" && protocolState === "running"),
    ...(childSessionID ? { childSessionID } : {}),
    ...(result ? { result } : {}),
    state,
    title: firstString(input?.description, metadata?.title, protocol?.summary) ?? "Delegated task",
  };
}

export function countRunningBackgroundSubagents(messages: SessionMessageInfo[]) {
  const subagents = new Map<
    string,
    { background: boolean; state?: SubagentPresentation["state"] }
  >();

  for (const message of messages) {
    if (message.type !== "assistant") continue;
    for (const [ordinal, part] of message.content.entries()) {
      if (part.type === "text") {
        const protocol = parseSubagentProtocolText(part.text);
        if (!protocol.matched || !protocol.childSessionID || !protocol.state) continue;
        const current = subagents.get(protocol.childSessionID);
        subagents.set(protocol.childSessionID, {
          background: true,
          state: current?.state ?? protocol.state,
        });
        continue;
      }
      if (part.type !== "tool") continue;
      const presentation = getSubagentPresentation(part);
      if (!presentation) continue;
      const key = presentation.childSessionID ?? `${message.id}:${part.id}:${ordinal}`;
      const current = subagents.get(key);
      subagents.set(key, {
        background: Boolean(current?.background || presentation.background),
        state: current?.state ?? presentation.state,
      });
    }
  }

  let count = 0;
  for (const subagent of subagents.values()) {
    if (subagent.background && subagent.state === "running") count += 1;
  }
  return count;
}

export function parseSubagentProtocolText(text: string): SubagentProtocolText {
  const bounded = text.slice(0, maxProtocolCharacters);
  const task = parseTaskWrapper(bounded);
  if (task) return task;

  const metadataStart = bounded.lastIndexOf("<task_metadata>");
  if (metadataStart < 0) return { matched: false, text };
  const metadataEnd = bounded.indexOf("</task_metadata>", metadataStart);
  if (metadataEnd < 0) return { matched: false, text };
  const metadata = bounded.slice(metadataStart + 15, metadataEnd);
  const sessionLine = metadata
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("session_id:"));
  const childSessionID = sessionLine?.slice("session_id:".length).trim();
  if (!childSessionID || !sessionIDPattern.test(childSessionID)) {
    return { matched: false, text };
  }
  const before = bounded.slice(0, metadataStart).trimEnd();
  const after = bounded.slice(metadataEnd + 16).trimStart();
  return {
    childSessionID,
    matched: true,
    text: [before, after].filter(Boolean).join("\n"),
  };
}

export function sanitizeTranscriptText(
  text: string,
  maxOutputCharacters = Number.POSITIVE_INFINITY,
) {
  let output = "";
  const maxInputCharacters = Number.isFinite(maxOutputCharacters)
    ? Math.max(4_096, maxOutputCharacters * 16)
    : Number.POSITIVE_INFINITY;
  const inputLength = Math.min(text.length, maxInputCharacters);
  for (let index = 0; index < inputLength; index += 1) {
    if (output.length >= maxOutputCharacters) break;
    const code = text.charCodeAt(index);
    if (code === 27) {
      const next = text.charCodeAt(index + 1);
      if (next === 91) {
        index += 2;
        while (index < inputLength) {
          const current = text.charCodeAt(index);
          if (current >= 64 && current <= 126) break;
          index += 1;
        }
      } else if (next === 93) {
        index += 2;
        while (index < inputLength) {
          if (text.charCodeAt(index) === 7) break;
          if (text.charCodeAt(index) === 27 && text.charCodeAt(index + 1) === 92) {
            index += 1;
            break;
          }
          index += 1;
        }
      }
      continue;
    }
    if (code === 155) {
      while (index + 1 < inputLength) {
        index += 1;
        const current = text.charCodeAt(index);
        if (current >= 64 && current <= 126) break;
      }
      continue;
    }
    if (code === 157) {
      while (index + 1 < inputLength) {
        index += 1;
        const current = text.charCodeAt(index);
        if (current === 7 || current === 156) break;
      }
      continue;
    }
    if (code === 13) {
      if (text.charCodeAt(index + 1) !== 10) output += "\n";
      continue;
    }
    if (
      (code < 32 && code !== 9 && code !== 10) ||
      (code >= 127 && code <= 159) ||
      code === 8206 ||
      code === 8207 ||
      (code >= 8234 && code <= 8238) ||
      (code >= 8294 && code <= 8297)
    ) {
      continue;
    }
    output += text[index];
  }
  return output;
}

function parseTaskWrapper(text: string): SubagentProtocolText | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<task id="')) return undefined;
  const firstLineEnd = trimmed.indexOf("\n");
  if (firstLineEnd < 0) return undefined;
  const firstLine = trimmed.slice(0, firstLineEnd);
  const header = /^<task id="(ses[A-Za-z0-9_-]+)" state="(running|completed|error)">$/.exec(
    firstLine,
  );
  if (!header) return undefined;

  let bodyStart = firstLineEnd + 1;
  let summary: string | undefined;
  if (trimmed.startsWith("<summary>", bodyStart)) {
    const summaryEnd = trimmed.indexOf("</summary>", bodyStart + 9);
    if (summaryEnd < 0) return undefined;
    summary = trimmed.slice(bodyStart + 9, summaryEnd).trim();
    bodyStart = summaryEnd + 10;
    if (trimmed[bodyStart] === "\n") bodyStart += 1;
  }

  const resultTag = header[2] === "error" ? "task_error" : "task_result";
  const openTag = `<${resultTag}>`;
  const closeTag = `</${resultTag}>`;
  if (!trimmed.startsWith(openTag, bodyStart)) return undefined;
  const resultStart = bodyStart + openTag.length;
  const resultEnd = trimmed.indexOf(closeTag, resultStart);
  if (resultEnd < 0) return undefined;
  const tail = trimmed.slice(resultEnd + closeTag.length).trim();
  if (tail !== "</task>") return undefined;

  const childSessionID = header[1];
  const state = header[2];
  if (
    !childSessionID ||
    !sessionIDPattern.test(childSessionID) ||
    (state !== "running" && state !== "completed" && state !== "error")
  ) {
    return undefined;
  }
  return {
    childSessionID,
    matched: true,
    state,
    ...(summary ? { summary } : {}),
    text: trimmed.slice(resultStart, resultEnd).trim(),
  };
}

function toolInput(tool: AssistantTool) {
  if (tool.state.status !== "streaming") return tool.state.input;
  if (tool.state.input.length > 16_384) return undefined;
  try {
    const input: unknown = JSON.parse(tool.state.input);
    return isRecord(input) ? input : undefined;
  } catch {
    return undefined;
  }
}

function toolMetadata(tool: AssistantTool) {
  if (tool.state.status === "streaming") return undefined;
  return isRecord(tool.state.metadata) ? tool.state.metadata : undefined;
}

function toolProtocolText(tool: AssistantTool) {
  if (tool.state.status !== "completed" && tool.state.status !== "error") return undefined;
  for (const item of tool.state.content ?? []) {
    if (item.type !== "text") continue;
    const protocol = parseSubagentProtocolText(item.text);
    if (protocol.matched) return protocol;
  }
  return undefined;
}

function toolResultText(tool: AssistantTool) {
  if (tool.state.status !== "completed" && tool.state.status !== "error") return undefined;
  const entries: string[] = [];
  for (const item of tool.state.content ?? []) {
    if (item.type !== "text") continue;
    const protocol = parseSubagentProtocolText(item.text);
    const text = protocol.matched ? protocol.text : item.text;
    if (text.trim()) entries.push(text.trim());
  }
  return entries.join("\n\n") || undefined;
}

function firstSessionID(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && sessionIDPattern.test(value)) return value;
  }
  return undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
