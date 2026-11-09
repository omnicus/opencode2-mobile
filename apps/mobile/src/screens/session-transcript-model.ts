import type {
  SessionMessageInfo,
  SessionMessagesResponse,
} from "@opencode2-mobile/opencode-adapter";

type AssistantMessage = Extract<SessionMessageInfo, { type: "assistant" }>;
type AssistantTool = Extract<AssistantMessage["content"][number], { type: "tool" }>;

// "streaming" is a task call still being written (Preparing); "waiting" is a child blocked on
// a permission or form; "interrupted" is a stop, not a failure; "finished" means the child
// stopped running but reported no outcome, so it is not shown as a success.
export type SubagentPresentation = {
  agent?: string;
  background: boolean;
  childSessionID?: string;
  // Foreground tasks finish with their tool call; background ones outlive it.
  finishedAt?: number;
  result?: string;
  startedAt?: number;
  state: "completed" | "error" | "finished" | "interrupted" | "running" | "streaming" | "waiting";
  title: string;
  waitingFor?: SubagentAttention;
};

export type SubagentAttention = "input" | "permission";
// Pending permissions and forms keyed by the session that asked.
export type SubagentAttentionMap = ReadonlyMap<string, SubagentAttention>;

const interruptedPattern = /\b(abort(?:ed)?|interrupt(?:ed)?|cancel(?:led|ed)?|stopped)\b/i;

export function isSubagentInFlight(state: SubagentPresentation["state"]) {
  return state === "running" || state === "streaming" || state === "waiting";
}

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

// Backgrounding detaches blocking tools, not model generation or arbitrary work.
// Messages arrive newest-first. Never offer an action for an older turn's tool.
export function hasForegroundBackgroundableTool(messages: SessionMessageInfo[]) {
  for (const message of messages) {
    if (message.type === "idle" || message.type === "user") return false;
    if (message.type !== "assistant") continue;
    if (message.time.completed !== undefined) return false;
    return message.content.some(
      (part) =>
        part.type === "tool" &&
        (part.name === "shell" || part.name === "subagent") &&
        part.state.status === "running" &&
        part.state.metadata.background !== true &&
        part.state.input.background !== true,
    );
  }
  return false;
}

type SubagentState = {
  agent?: string;
  background: boolean;
  childSessionID?: string;
  finishedAt?: number;
  startedAt?: number;
  state: SubagentPresentation["state"];
  title?: string;
  waitingFor?: SubagentAttention;
};

export type SubagentStates = ReadonlyMap<string, SubagentState>;

export function getSubagentPresentation(
  tool: AssistantTool,
  states?: SubagentStates,
): SubagentPresentation | undefined {
  if (!isSubagentTool(tool)) return undefined;

  const input = toolInput(tool) ?? {};
  const metadata = toolMetadata(tool) ?? {};
  const protocol = toolProtocolText(tool);
  const result = toolResultText(tool);
  const agent = firstString(input.subagent_type, input.agent, metadata.agent);
  const childSessionID = subagentChildSessionID(metadata, protocol);
  const background = isBackgroundSubagent(tool, input, metadata, protocol?.state);
  const known = childSessionID ? states?.get(childSessionID) : undefined;
  // A foreground task's own tool status is authoritative; only a pending request overrides it.
  const launched = subagentLaunchState(tool, background, protocol?.state);
  const base = background && known ? known.state : launched;
  const waiting = known?.waitingFor && isSubagentInFlight(base) ? known.waitingFor : undefined;
  const finishedAt = !background && !isSubagentInFlight(base) ? tool.time.completed : undefined;
  // A background launch's own text only acknowledges the start; it never becomes the result.
  const acknowledgement = background && launched === "running";
  return {
    ...(agent ? { agent } : {}),
    background,
    ...(childSessionID ? { childSessionID } : {}),
    ...(finishedAt !== undefined ? { finishedAt } : {}),
    ...(result && !acknowledgement ? { result } : {}),
    startedAt: tool.time.ran ?? tool.time.created,
    state: waiting ? "waiting" : base,
    title: subagentTitle(input, metadata, protocol),
    ...(waiting ? { waitingFor: waiting } : {}),
  };
}

function isSubagentTool(tool: AssistantTool) {
  const toolName = tool.name.trim().toLocaleLowerCase();
  return toolName === "subagent" || toolName === "task";
}

function subagentChildSessionID(
  metadata: Record<string, unknown>,
  protocol: SubagentProtocolText | undefined,
) {
  return firstSessionID(
    metadata.sessionId,
    metadata.sessionID,
    metadata.session_id,
    metadata.taskId,
    metadata.task_id,
    protocol?.childSessionID,
  );
}

function isBackgroundSubagent(
  tool: AssistantTool,
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  protocolState: SubagentProtocolText["state"],
) {
  return (
    input.background === true ||
    metadata.background === true ||
    (tool.state.status === "completed" && protocolState === "running")
  );
}

// A background launch completes as soon as the child starts; that is not the child finishing.
function subagentLaunchState(
  tool: AssistantTool,
  background: boolean,
  protocolState: SubagentProtocolText["state"],
): SubagentPresentation["state"] {
  if (protocolState) return protocolState;
  if (tool.state.status === "error" && interruptedPattern.test(tool.state.error.message)) {
    return "interrupted";
  }
  return background && tool.state.status === "completed" ? "running" : tool.state.status;
}

function subagentTitle(
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  protocol: SubagentProtocolText | undefined,
) {
  return firstString(input.description, metadata.title, protocol?.summary) ?? "Delegated task";
}

// Messages arrive newest-first, so the first signal seen for a child is its latest.
// Live activity is the same active-session store the Sessions list counts children from.
export function subagentStates(
  messages: SessionMessageInfo[],
  activeSessions?: Readonly<Record<string, unknown>>,
  sessionID?: string,
  attention?: SubagentAttentionMap,
): SubagentStates {
  type Signal = SubagentState & { notified: boolean };
  const states = new Map<string, Signal>();
  const record = (key: string, signal: Signal) => {
    const current = states.get(key);
    if (current) {
      current.background ||= signal.background;
      if (!current.title && signal.title) current.title = signal.title;
      if (!current.agent && signal.agent) current.agent = signal.agent;
      // Messages arrive newest-first, so the launch is the last signal seen.
      if (signal.startedAt !== undefined) current.startedAt = signal.startedAt;
    } else states.set(key, signal);
  };

  for (const message of messages) {
    if (message.type === "synthetic") {
      const notice = subagentNotice(message);
      if (notice) record(notice.childSessionID, { background: true, ...notice, notified: true });
      continue;
    }
    if (message.type !== "assistant") continue;
    for (const [ordinal, part] of message.content.entries()) {
      if (part.type === "text") {
        const protocol = parseSubagentProtocolText(part.text);
        if (!protocol.matched || !protocol.childSessionID || !protocol.state) continue;
        record(protocol.childSessionID, {
          background: true,
          childSessionID: protocol.childSessionID,
          notified: true,
          state: protocol.state,
        });
        continue;
      }
      if (part.type !== "tool") continue;
      const presentation = getSubagentPresentation(part);
      if (!presentation) continue;
      record(presentation.childSessionID ?? `${message.id}:${part.id}:${ordinal}`, {
        ...(presentation.agent ? { agent: presentation.agent } : {}),
        background: presentation.background,
        ...(presentation.childSessionID ? { childSessionID: presentation.childSessionID } : {}),
        ...(presentation.finishedAt !== undefined ? { finishedAt: presentation.finishedAt } : {}),
        notified: false,
        ...(presentation.startedAt !== undefined ? { startedAt: presentation.startedAt } : {}),
        state: presentation.state,
        title: presentation.title,
      });
    }
  }

  if (activeSessions) {
    for (const entry of states.values()) {
      if (entry.notified || !entry.childSessionID) continue;
      if (activeSessions[entry.childSessionID]) entry.state = "running";
      // While the parent is still running, the child may not have reported busy yet.
      // Gone from the active list while the parent is idle: it stopped, but nothing says how.
      else if (entry.state === "running" && !(sessionID && activeSessions[sessionID])) {
        entry.state = "finished";
      }
    }
  }
  // A child blocked on a permission or form may drop out of the active list, so a pending
  // request wins over any running or inferred-complete state, but not over a reported finish.
  if (attention) {
    for (const entry of states.values()) {
      const waitingFor = entry.childSessionID ? attention.get(entry.childSessionID) : undefined;
      if (!waitingFor) continue;
      if (entry.notified && !isSubagentInFlight(entry.state)) continue;
      entry.state = "waiting";
      entry.waitingFor = waitingFor;
    }
  }
  return states;
}

export type SessionSubagent = {
  agent?: string;
  background: boolean;
  childSessionID?: string;
  finishedAt?: number;
  key: string;
  startedAt?: number;
  state: SubagentPresentation["state"];
  title: string;
  waitingFor?: SubagentAttention;
};

// Every subagent this session launched, for the monitor: waiting first, then working, then
// finished, each in launch order.
export function sessionSubagents(
  messages: SessionMessageInfo[],
  activeSessions?: Readonly<Record<string, unknown>>,
  sessionID?: string,
  attention?: SubagentAttentionMap,
): SessionSubagent[] {
  const rank = (state: SubagentPresentation["state"]) =>
    state === "waiting" ? 0 : isSubagentInFlight(state) ? 1 : 2;
  return [...subagentStates(messages, activeSessions, sessionID, attention).entries()]
    .map(([key, subagent]) => ({
      ...(subagent.agent ? { agent: subagent.agent } : {}),
      background: subagent.background,
      ...(subagent.childSessionID ? { childSessionID: subagent.childSessionID } : {}),
      ...(subagent.finishedAt !== undefined ? { finishedAt: subagent.finishedAt } : {}),
      key,
      ...(subagent.startedAt !== undefined ? { startedAt: subagent.startedAt } : {}),
      state: subagent.state,
      title: subagent.title ?? "Delegated task",
      ...(subagent.waitingFor ? { waitingFor: subagent.waitingFor } : {}),
    }))
    .reverse()
    .sort((first, second) => rank(first.state) - rank(second.state));
}

export function runningBackgroundSubagents(
  messages: SessionMessageInfo[],
  activeSessions?: Readonly<Record<string, unknown>>,
  sessionID?: string,
) {
  return [...subagentStates(messages, activeSessions, sessionID).entries()]
    .filter(([, subagent]) => subagent.background && subagent.state === "running")
    .map(([key, subagent]) => ({
      key,
      childSessionID: subagent.childSessionID,
      title: subagent.title,
    }));
}

export function countRunningBackgroundSubagents(
  messages: SessionMessageInfo[],
  activeSessions?: Readonly<Record<string, unknown>>,
  sessionID?: string,
) {
  return runningBackgroundSubagents(messages, activeSessions, sessionID).length;
}

function subagentNotice(message: Extract<SessionMessageInfo, { type: "synthetic" }>) {
  const metadata = isRecord(message.metadata) ? message.metadata : undefined;
  const header =
    /^<subagent sessionID="(ses[A-Za-z0-9_-]+)" state="([a-z_-]+)"/.exec(
      message.text.trimStart(),
    ) ?? undefined;
  const childSessionID =
    metadata?.source === "subagent" ? firstSessionID(metadata.childID) : header?.[1];
  const state = metadata?.source === "subagent" ? firstString(metadata.state) : header?.[2];
  if (!childSessionID || !state) return undefined;
  const presented: SubagentPresentation["state"] =
    state === "completed" || state === "running"
      ? state
      : /^(abort|aborted|cancel|cancelled|canceled|interrupted|stopped)$/.test(state)
        ? "interrupted"
        : "error";
  return { childSessionID, state: presented };
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
    const sequenceEnd = controlSequenceEnd(text, index, inputLength);
    if (sequenceEnd !== undefined) {
      index = sequenceEnd;
      continue;
    }
    if (code === 13) {
      if (text.charCodeAt(index + 1) !== 10) output += "\n";
      continue;
    }
    if (isUnsafeCharacter(code)) continue;
    output += text[index];
  }
  return output;
}

// Returns the index of the last character a control sequence at `index` consumes.
function controlSequenceEnd(text: string, index: number, inputLength: number) {
  const code = text.charCodeAt(index);
  if (code === 27) {
    const next = text.charCodeAt(index + 1);
    if (next === 91) return escapeCsiEnd(text, index + 2, inputLength);
    if (next === 93) return escapeOscEnd(text, index + 2, inputLength);
    return index;
  }
  if (code === 155) return c1SequenceEnd(text, index, inputLength, isCsiFinalByte);
  if (code === 157) return c1SequenceEnd(text, index, inputLength, isC1OscTerminator);
  return undefined;
}

function escapeCsiEnd(text: string, start: number, inputLength: number) {
  let index = start;
  while (index < inputLength) {
    if (isCsiFinalByte(text.charCodeAt(index))) break;
    index += 1;
  }
  return index;
}

function escapeOscEnd(text: string, start: number, inputLength: number) {
  let index = start;
  while (index < inputLength) {
    if (text.charCodeAt(index) === 7) break;
    if (text.charCodeAt(index) === 27 && text.charCodeAt(index + 1) === 92) return index + 1;
    index += 1;
  }
  return index;
}

function c1SequenceEnd(
  text: string,
  start: number,
  inputLength: number,
  isEnd: (code: number) => boolean,
) {
  let index = start;
  while (index + 1 < inputLength) {
    index += 1;
    if (isEnd(text.charCodeAt(index))) break;
  }
  return index;
}

function isCsiFinalByte(code: number) {
  return code >= 64 && code <= 126;
}

function isC1OscTerminator(code: number) {
  return code === 7 || code === 156;
}

function isUnsafeCharacter(code: number) {
  return (
    (code < 32 && code !== 9 && code !== 10) ||
    (code >= 127 && code <= 159) ||
    code === 8206 ||
    code === 8207 ||
    (code >= 8234 && code <= 8238) ||
    (code >= 8294 && code <= 8297)
  );
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
