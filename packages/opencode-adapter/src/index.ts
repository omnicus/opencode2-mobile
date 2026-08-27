import {
  type FileDiffInfo,
  type FormAnswer,
  type FormState,
  type LocationGetOutput,
  type LocationRef,
  type MessageListInput,
  type ModelRef,
  OpenCode,
  type OpenCodeEvent,
  type PermissionReply,
  type SessionInboxDelivery,
  type SessionInboxInfo,
  type SessionListInput,
  type SessionMessageInfo,
  type SessionMessagesResponse,
  type SessionsResponse,
} from "@opencode-ai/client";

export const openCodeClientContractVersion = "0.0.0-beta-18050";

export type OpenCodeClientOptions = {
  authorization?: string;
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
};

export const maxOpenCodeJsonBytes = 16 * 1024 * 1024;

export class OpenCodeResponseTooLargeError extends Error {
  override readonly name = "OpenCodeResponseTooLargeError";
  readonly reason = "ResponseTooLarge";
}

export class OpenCodeUnsafeRedirectError extends Error {
  override readonly name = "OpenCodeUnsafeRedirectError";
  readonly reason = "UnsafeRedirect";
}

export function createRedirectSafeOpenCodeFetch(
  delegate: typeof globalThis.fetch,
  maxRedirects = 5,
): typeof globalThis.fetch {
  return async (input, init) => {
    const initialUrl = requestUrl(input);
    let currentUrl = initialUrl;
    let currentInit: RequestInit = { ...init, redirect: "manual" };
    let currentInput: RequestInfo | URL = input;

    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await delegate(currentInput, currentInit);
      if (response.redirected) {
        await response.body?.cancel().catch(() => undefined);
        throw new OpenCodeUnsafeRedirectError();
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;

      const location = response.headers.get("location");
      if (!location) return response;
      if (redirectCount >= maxRedirects) {
        await response.body?.cancel().catch(() => undefined);
        throw new OpenCodeUnsafeRedirectError();
      }

      const nextUrl = new URL(location, currentUrl);
      if (nextUrl.origin !== initialUrl.origin) {
        await response.body?.cancel().catch(() => undefined);
        throw new OpenCodeUnsafeRedirectError();
      }

      await response.body?.cancel().catch(() => undefined);
      if (
        response.status === 303 &&
        currentInit.method !== undefined &&
        currentInit.method.toUpperCase() !== "HEAD"
      ) {
        const headers = new Headers(currentInit.headers);
        headers.delete("content-length");
        headers.delete("content-type");
        const nextInit: RequestInit = { ...currentInit, headers, method: "GET" };
        delete nextInit.body;
        currentInit = nextInit;
      }
      currentUrl = nextUrl;
      currentInput = nextUrl;
    }
  };
}

export function createBoundedOpenCodeFetch(
  delegate: typeof globalThis.fetch,
  maxJsonBytes = maxOpenCodeJsonBytes,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await delegate(input, init);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (contentType !== "application/json" && !contentType?.endsWith("+json")) return response;

    const declaredLength = response.headers.get("content-length");
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxJsonBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new OpenCodeResponseTooLargeError();
    }

    const readText = response.text.bind(response);
    return new Proxy(response, {
      get(target, property) {
        if (property === "text") {
          return async () => {
            const text = await readText();
            if (exceedsUtf8Bytes(text, maxJsonBytes)) throw new OpenCodeResponseTooLargeError();
            return text;
          };
        }

        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
}

export function createOpenCodeClient(options: OpenCodeClientOptions) {
  return OpenCode.make({
    baseUrl: normalizeOpenCodeBaseUrl(options.baseUrl),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.authorization ? { headers: { authorization: options.authorization } } : {}),
  });
}

type OpenCodeRequestOptions = { signal?: AbortSignal };
type LocationSessionListInput = Omit<
  SessionListInput,
  "directory" | "project" | "subpath" | "workspace"
>;
type ProjectSessionListInput = Omit<
  SessionListInput,
  "directory" | "project" | "subpath" | "workspace"
>;
type OpenCodeMessageListInput = Omit<MessageListInput, "sessionID">;
export type OpenCodeSessionCreateOptions = Omit<
  NonNullable<Parameters<OpenCodeClient["session"]["create"]>[0]>,
  "location"
>;
type GeneratedSessionPromptInput = Parameters<OpenCodeClient["session"]["prompt"]>[0];
export type OpenCodeSessionPromptOptions = Omit<
  GeneratedSessionPromptInput,
  "delivery" | "id" | "sessionID"
> & {
  delivery: SessionInboxDelivery;
  id: string;
};

export async function getDefaultOpenCodeLocation(
  client: OpenCodeClient,
  options?: OpenCodeRequestOptions,
) {
  return validateResolvedLocation(await client.location.get(undefined, options));
}

export async function getOpenCodeLocation(
  client: OpenCodeClient,
  location: LocationRef,
  options?: OpenCodeRequestOptions,
) {
  return validateResolvedLocation(
    await client.location.get({ location: locationInput(location) }, options),
  );
}

export async function getOpenCodeVcs(
  client: OpenCodeClient,
  location: LocationRef,
  options?: OpenCodeRequestOptions,
) {
  const response = await client.vcs.get({ location: locationInput(location) }, options);
  validateResolvedLocation(response.location);
  if (
    !isRecord(response.data) ||
    !isRecord(response.data.branch) ||
    !isOptionalString(response.data.branch.current) ||
    !isOptionalString(response.data.branch.default)
  ) {
    throw new Error("MALFORMED_VCS_INFO");
  }
  return response;
}

export async function getOpenCodeVcsDiff(
  client: OpenCodeClient,
  location: LocationRef,
  mode: "branch" | "working",
  options?: OpenCodeRequestOptions & { context?: number },
) {
  const response = await client.vcs.diff(
    {
      location: locationInput(location),
      mode,
      ...(options?.context === undefined ? {} : { context: options.context }),
    },
    options?.signal ? { signal: options.signal } : undefined,
  );
  validateResolvedLocation(response.location);
  if (!Array.isArray(response.data) || !response.data.every(isValidFileDiff)) {
    throw new Error("MALFORMED_VCS_DIFF");
  }
  return response;
}

export async function listOpenCodeProjects(
  client: OpenCodeClient,
  options?: OpenCodeRequestOptions,
) {
  const projects = await client.project.list(options);
  if (!Array.isArray(projects) || !projects.every(isValidProject)) {
    throw new Error("MALFORMED_PROJECT_LIST");
  }
  return projects;
}

export async function listOpenCodeAgents(
  client: OpenCodeClient,
  location: LocationRef,
  options?: OpenCodeRequestOptions,
) {
  const output = await client.agent.list({ location: locationInput(location) }, options);
  validateResolvedLocation(output.location);
  if (!Array.isArray(output.data) || !output.data.every(isValidAgent)) {
    throw new Error("MALFORMED_AGENT_LIST");
  }
  return output;
}

export async function getDefaultOpenCodeAgent(
  client: OpenCodeClient,
  location: LocationRef,
  options?: OpenCodeRequestOptions,
) {
  const entries = await client.config.get({ location: locationInput(location) }, options);
  if (!Array.isArray(entries)) throw new Error("MALFORMED_CONFIG_LIST");
  let defaultAgent: string | undefined;
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      !["agents", "claude", "directory", "document"].includes(String(entry.type))
    ) {
      throw new Error("MALFORMED_CONFIG_LIST");
    }
    if (entry.type !== "document") continue;
    if (!isRecord(entry.info)) throw new Error("MALFORMED_CONFIG_LIST");
    const candidate = entry.info.default_agent;
    if (candidate === undefined) continue;
    if (typeof candidate !== "string" || !candidate.trim()) {
      throw new Error("MALFORMED_CONFIG_LIST");
    }
    defaultAgent = candidate;
  }
  return defaultAgent ?? null;
}

export async function listOpenCodeModels(
  client: OpenCodeClient,
  location: LocationRef,
  options?: OpenCodeRequestOptions,
) {
  const output = await client.model.list({ location: locationInput(location) }, options);
  validateResolvedLocation(output.location);
  if (!Array.isArray(output.data) || !output.data.every(isValidModel)) {
    throw new Error("MALFORMED_MODEL_LIST");
  }
  return output;
}

export async function getDefaultOpenCodeModel(
  client: OpenCodeClient,
  location: LocationRef,
  options?: OpenCodeRequestOptions,
) {
  const output = await client.model.default({ location: locationInput(location) }, options);
  validateResolvedLocation(output.location);
  if (output.data !== null && !isValidModel(output.data)) {
    throw new Error("MALFORMED_DEFAULT_MODEL");
  }
  return output;
}

export function getCurrentOpenCodeProject(
  client: OpenCodeClient,
  location: LocationRef,
  options?: OpenCodeRequestOptions,
) {
  return client.project.current({ location: locationInput(location) }, options);
}

export async function listOpenCodeSessions(
  client: OpenCodeClient,
  location: LocationRef,
  input: LocationSessionListInput = {},
  options?: OpenCodeRequestOptions,
) {
  assertLocation(location);
  const response = await client.session.list(
    {
      ...input,
      directory: location.directory,
      ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
    },
    options,
  );
  validateSessionsResponse(response);
  return response;
}

export async function listOpenCodeProjectSessions(
  client: OpenCodeClient,
  projectID: string,
  input: ProjectSessionListInput = {},
  options?: OpenCodeRequestOptions,
) {
  if (!projectID.trim()) throw new Error("PROJECT_REQUIRED");
  const response = await client.session.list({ ...input, project: projectID }, options);
  validateSessionsResponse(response);
  if (!response.data.every((session) => session.projectID === projectID)) {
    throw new Error("MALFORMED_PROJECT_SESSION_LIST");
  }
  if (
    input.parentID !== undefined &&
    !response.data.every((session) =>
      input.parentID === null
        ? session.parentID === undefined
        : session.parentID === input.parentID,
    )
  ) {
    throw new Error("MALFORMED_SESSION_PARENT_FILTER");
  }
  return response;
}

export async function listActiveOpenCodeSessions(
  client: OpenCodeClient,
  options?: OpenCodeRequestOptions,
) {
  const sessions = await client.session.active(options);
  if (
    !isRecord(sessions) ||
    !Object.entries(sessions).every(
      ([sessionID, status]) =>
        /^ses/.test(sessionID) && isRecord(status) && status.type === "running",
    )
  ) {
    throw new Error("MALFORMED_ACTIVE_SESSIONS");
  }
  return sessions;
}

export async function getOpenCodeSession(
  client: OpenCodeClient,
  sessionID: string,
  options?: OpenCodeRequestOptions,
) {
  const session = await client.session.get({ sessionID }, options);
  if (!isValidSession(session) || session.id !== sessionID) throw new Error("MALFORMED_SESSION");
  return session;
}

export async function listOpenCodeMessages(
  client: OpenCodeClient,
  sessionID: string,
  input: OpenCodeMessageListInput = {},
  options?: OpenCodeRequestOptions,
) {
  if (!/^ses/.test(sessionID)) throw new Error("INVALID_SESSION_ID");
  if (input.cursor !== undefined && input.order !== undefined) {
    throw new Error("MESSAGE_CURSOR_WITH_ORDER");
  }
  const response = await client.message.list({ ...input, sessionID }, options);
  validateSessionMessagesResponse(response);
  return response;
}

export async function createOpenCodeSession(
  client: OpenCodeClient,
  location: LocationRef,
  input: OpenCodeSessionCreateOptions = {},
  options?: OpenCodeRequestOptions,
) {
  const session = await client.session.create(
    {
      ...input,
      location: locationBodyInput(location),
    },
    options,
  );
  if (!isValidSession(session)) throw new Error("MALFORMED_SESSION");
  return session;
}

export function renameOpenCodeSession(
  client: OpenCodeClient,
  sessionID: string,
  title: string,
  options?: OpenCodeRequestOptions,
) {
  return client.session.rename({ sessionID, title }, options);
}

export function removeOpenCodeSession(
  client: OpenCodeClient,
  sessionID: string,
  options?: OpenCodeRequestOptions,
) {
  return client.session.remove({ sessionID }, options);
}

export function switchOpenCodeSessionAgent(
  client: OpenCodeClient,
  sessionID: string,
  agent: string,
  options?: OpenCodeRequestOptions,
) {
  return client.session.switchAgent({ agent, sessionID }, options);
}

export function switchOpenCodeSessionModel(
  client: OpenCodeClient,
  sessionID: string,
  model: ModelRef,
  options?: OpenCodeRequestOptions,
) {
  return client.session.switchModel({ model, sessionID }, options);
}

export async function promptOpenCodeSession(
  client: OpenCodeClient,
  sessionID: string,
  input: OpenCodeSessionPromptOptions,
  options?: OpenCodeRequestOptions,
) {
  if (!/^msg_/.test(input.id)) throw new Error("INVALID_MESSAGE_ID");
  const inbox = await client.session.prompt({ ...input, sessionID }, options);
  if (!isValidSessionInboxInfo(inbox) || inbox.id !== input.id || inbox.sessionID !== sessionID) {
    throw new Error("MALFORMED_INBOX_ITEM");
  }
  return inbox;
}

export async function listOpenCodeSessionInbox(
  client: OpenCodeClient,
  sessionID: string,
  options?: OpenCodeRequestOptions,
) {
  const inbox = await client.session.inbox.list({ sessionID }, options);
  if (
    !Array.isArray(inbox) ||
    !inbox.every((item) => isValidSessionInboxInfo(item) && item.sessionID === sessionID)
  ) {
    throw new Error("MALFORMED_INBOX_LIST");
  }
  return inbox;
}

export async function getOpenCodeSessionMessage(
  client: OpenCodeClient,
  sessionID: string,
  messageID: string,
  options?: OpenCodeRequestOptions,
) {
  if (!/^ses/.test(sessionID)) throw new Error("INVALID_SESSION_ID");
  if (!/^msg_/.test(messageID)) throw new Error("INVALID_MESSAGE_ID");
  const message = await client.session.message({ messageID, sessionID }, options);
  if (!isValidMessage(message) || message.id !== messageID) {
    throw new Error("MALFORMED_SESSION_MESSAGE");
  }
  return message;
}

export function cancelOpenCodeSessionInboxItem(
  client: OpenCodeClient,
  sessionID: string,
  inboxID: string,
  options?: OpenCodeRequestOptions,
) {
  return client.session.inbox.cancel({ inboxID, sessionID }, options);
}

export function steerOpenCodeSessionInboxItem(
  client: OpenCodeClient,
  sessionID: string,
  inboxID: string,
  options?: OpenCodeRequestOptions,
) {
  return client.session.inbox.steer({ inboxID, sessionID }, options);
}

export function queueOpenCodeSessionInboxItem(
  client: OpenCodeClient,
  sessionID: string,
  inboxID: string,
  options?: OpenCodeRequestOptions,
) {
  return client.session.inbox.queue({ inboxID, sessionID }, options);
}

export function interruptOpenCodeSession(
  client: OpenCodeClient,
  sessionID: string,
  continueExecution?: boolean,
  options?: OpenCodeRequestOptions,
) {
  return client.session.interrupt(
    { sessionID, ...(continueExecution === undefined ? {} : { continue: continueExecution }) },
    options,
  );
}

export function backgroundOpenCodeSession(
  client: OpenCodeClient,
  sessionID: string,
  options?: OpenCodeRequestOptions,
) {
  return client.session.background({ sessionID }, options);
}

export function waitForOpenCodeSession(
  client: OpenCodeClient,
  sessionID: string,
  options?: OpenCodeRequestOptions,
) {
  return client.session.wait({ sessionID }, options);
}

export async function listOpenCodePermissionRequests(
  client: OpenCodeClient,
  location: LocationRef,
  options?: OpenCodeRequestOptions,
) {
  const output = await client.permission.request.list(
    { location: locationInput(location) },
    options,
  );
  validateResolvedLocation(output.location);
  if (!Array.isArray(output.data) || !output.data.every(isValidPermissionRequest)) {
    throw new Error("MALFORMED_PERMISSION_LIST");
  }
  return output;
}

export function replyOpenCodePermissionRequest(
  client: OpenCodeClient,
  sessionID: string,
  requestID: string,
  reply: PermissionReply,
  options?: OpenCodeRequestOptions,
) {
  return client.permission.reply({ reply, requestID, sessionID }, options);
}

export async function listOpenCodeFormRequests(
  client: OpenCodeClient,
  location: LocationRef,
  options?: OpenCodeRequestOptions,
) {
  const output = await client.form.request.list({ location: locationInput(location) }, options);
  validateResolvedLocation(output.location);
  if (!Array.isArray(output.data) || !output.data.every(isValidForm)) {
    throw new Error("MALFORMED_FORM_LIST");
  }
  return output;
}

export async function getOpenCodeFormState(
  client: OpenCodeClient,
  sessionID: string,
  formID: string,
  options?: OpenCodeRequestOptions,
) {
  assertSessionAndFormIds(sessionID, formID);
  const state = await client.form.state({ formID, sessionID }, options);
  if (!isValidFormState(state)) throw new Error("MALFORMED_FORM_STATE");
  return state;
}

export function replyOpenCodeForm(
  client: OpenCodeClient,
  sessionID: string,
  formID: string,
  answer: FormAnswer,
  options?: OpenCodeRequestOptions,
) {
  assertSessionAndFormIds(sessionID, formID);
  return client.form.reply({ answer, formID, sessionID }, options);
}

export function cancelOpenCodeForm(
  client: OpenCodeClient,
  sessionID: string,
  formID: string,
  options?: OpenCodeRequestOptions,
) {
  assertSessionAndFormIds(sessionID, formID);
  return client.form.cancel({ formID, sessionID }, options);
}

function locationInput(location: LocationRef) {
  assertLocation(location);
  return {
    directory: location.directory,
    ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
  };
}

function locationBodyInput(location: LocationRef) {
  assertLocation(location);
  return {
    directory: location.directory,
    ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
  };
}

function assertLocation(location: LocationRef) {
  if (!location.directory.trim()) throw new Error("LOCATION_REQUIRED");
  if (location.workspaceID !== undefined && !location.workspaceID.trim()) {
    throw new Error("INVALID_WORKSPACE_ID");
  }
}

function validateResolvedLocation(location: LocationGetOutput) {
  if (
    typeof location.directory !== "string" ||
    !location.directory.trim() ||
    (location.workspaceID !== undefined &&
      (typeof location.workspaceID !== "string" || !/^wrk/.test(location.workspaceID))) ||
    !isRecord(location.project) ||
    typeof location.project.id !== "string" ||
    !location.project.id ||
    typeof location.project.directory !== "string" ||
    !location.project.directory.trim() ||
    typeof location.project.canonical !== "string" ||
    !location.project.canonical.trim()
  ) {
    throw new Error("MALFORMED_LOCATION");
  }
  return location;
}

function validateSessionsResponse(response: SessionsResponse) {
  if (
    !isRecord(response) ||
    !Array.isArray(response.data) ||
    !response.data.every(isValidSession) ||
    !isRecord(response.cursor) ||
    !isOptionalNullableString(response.cursor.previous) ||
    !isOptionalNullableString(response.cursor.next)
  ) {
    throw new Error("MALFORMED_SESSION_LIST");
  }
}

function validateSessionMessagesResponse(response: SessionMessagesResponse) {
  if (
    !isRecord(response) ||
    !Array.isArray(response.data) ||
    !response.data.every(isValidMessage) ||
    !isRecord(response.cursor) ||
    !isOptionalNullableString(response.cursor.previous) ||
    !isOptionalNullableString(response.cursor.next)
  ) {
    throw new Error("MALFORMED_MESSAGE_LIST");
  }
}

function isValidMessage(value: unknown): value is SessionMessageInfo {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^msg_/.test(value.id) ||
    !isValidCreatedTime(value.time) ||
    typeof value.type !== "string"
  ) {
    return false;
  }

  switch (value.type) {
    case "agent-switched":
      return (
        typeof value.agent === "string" &&
        (value.previous === undefined || typeof value.previous === "string")
      );
    case "model-switched":
      return (
        isModelRef(value.model) && (value.previous === undefined || isModelRef(value.previous))
      );
    case "location-switched":
      return isLocationRef(value.location);
    case "user":
      return (
        typeof value.text === "string" &&
        isOptionalArrayOf(value.files, isPromptFileAttachment) &&
        isOptionalArrayOf(value.agents, isPromptAgentAttachment) &&
        isOptionalArrayOf(value.skills, isPromptSkillAttachment)
      );
    case "synthetic":
    case "system":
      return (
        typeof value.text === "string" &&
        (value.description === undefined || typeof value.description === "string")
      );
    case "skill":
      return (
        typeof value.skill === "string" &&
        typeof value.name === "string" &&
        typeof value.text === "string"
      );
    case "shell":
      return (
        typeof value.shellID === "string" &&
        typeof value.command === "string" &&
        (value.status === "running" ||
          value.status === "exited" ||
          value.status === "timeout" ||
          value.status === "killed") &&
        (value.exit === undefined ||
          typeof value.exit === "number" ||
          value.exit === "Infinity" ||
          value.exit === "-Infinity" ||
          value.exit === "NaN") &&
        isOptionalShellOutput(value.output)
      );
    case "assistant":
      return (
        typeof value.agent === "string" &&
        isModelRef(value.model) &&
        Array.isArray(value.content) &&
        value.content.every(isValidAssistantPart) &&
        (value.error === undefined || isStructuredError(value.error)) &&
        (value.retry === undefined || isValidAssistantRetry(value.retry))
      );
    case "compaction":
      if (value.reason !== "auto" && value.reason !== "manual") return false;
      if (value.status === "failed") return isStructuredError(value.error);
      return (
        (value.status === "running" || value.status === "completed") &&
        typeof value.summary === "string" &&
        typeof value.recent === "string"
      );
    default:
      return false;
  }
}

function isValidAssistantPart(value: unknown) {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "text" || value.type === "reasoning") return typeof value.text === "string";
  if (value.type !== "tool") return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isValidCreatedTime(value.time) &&
    isValidToolState(value.state)
  );
}

function isValidToolState(value: unknown) {
  if (!isRecord(value)) return false;
  if (value.status === "streaming") return typeof value.input === "string";
  if (value.status === "running") return isRecord(value.input) && isRecord(value.metadata);
  if (value.status === "completed") {
    return (
      isRecord(value.input) &&
      Array.isArray(value.content) &&
      value.content.length > 0 &&
      value.content.every(isToolContent)
    );
  }
  if (value.status === "error") {
    return (
      isRecord(value.input) &&
      isStructuredError(value.error) &&
      (value.content === undefined ||
        (Array.isArray(value.content) &&
          value.content.length > 0 &&
          value.content.every(isToolContent)))
    );
  }
  return false;
}

function isToolContent(value: unknown) {
  return (
    isRecord(value) &&
    ((value.type === "text" && typeof value.text === "string") ||
      (value.type === "file" &&
        typeof value.uri === "string" &&
        typeof value.mime === "string" &&
        (value.name === undefined || value.name === null || typeof value.name === "string")))
  );
}

function isOptionalShellOutput(value: unknown) {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.output === "string" &&
      Number.isInteger(value.cursor) &&
      Number.isInteger(value.size) &&
      typeof value.truncated === "boolean")
  );
}

function isStructuredError(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.message === "string" &&
    (value.status === undefined || typeof value.status === "number")
  );
}

function isValidAssistantRetry(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.attempt === "number" &&
    Number.isInteger(value.attempt) &&
    value.attempt >= 0 &&
    typeof value.at === "number" &&
    Number.isFinite(value.at) &&
    isStructuredError(value.error)
  );
}

function isValidCreatedTime(value: unknown) {
  return isRecord(value) && typeof value.created === "number" && Number.isFinite(value.created);
}

function isLocationRef(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.directory === "string" &&
    Boolean(value.directory.trim()) &&
    (value.workspaceID === undefined ||
      (typeof value.workspaceID === "string" && /^wrk/.test(value.workspaceID)))
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

function isPromptFileAttachment(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.data === "string" &&
    typeof value.mime === "string" &&
    isRecord(value.source) &&
    (value.source.type === "inline" ||
      (value.source.type === "uri" && typeof value.source.uri === "string")) &&
    (value.name === undefined || typeof value.name === "string") &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.mention === undefined || isPromptMention(value.mention))
  );
}

function isPromptAgentAttachment(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.mention === undefined || isPromptMention(value.mention))
  );
}

function isPromptSkillAttachment(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.mention === undefined || isPromptMention(value.mention))
  );
}

function isPromptMention(value: unknown) {
  return (
    isRecord(value) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    typeof value.text === "string"
  );
}

function isOptionalArrayOf(value: unknown, predicate: (item: unknown) => boolean) {
  return value === undefined || (Array.isArray(value) && value.every(predicate));
}

function isValidProject(project: unknown) {
  return (
    isRecord(project) &&
    typeof project.id === "string" &&
    Boolean(project.id) &&
    typeof project.canonical === "string" &&
    Boolean(project.canonical.trim()) &&
    Array.isArray(project.sandboxes) &&
    project.sandboxes.every((directory) => typeof directory === "string" && directory.length > 0) &&
    isRecord(project.time) &&
    typeof project.time.created === "number" &&
    Number.isFinite(project.time.created) &&
    typeof project.time.updated === "number" &&
    Number.isFinite(project.time.updated)
  );
}

function isValidAgent(agent: unknown) {
  return (
    isRecord(agent) &&
    typeof agent.id === "string" &&
    Boolean(agent.id) &&
    typeof agent.name === "string" &&
    typeof agent.hidden === "boolean" &&
    (agent.mode === "primary" || agent.mode === "subagent" || agent.mode === "all")
  );
}

function isValidModel(model: unknown) {
  return (
    isRecord(model) &&
    typeof model.id === "string" &&
    Boolean(model.id) &&
    typeof model.providerID === "string" &&
    Boolean(model.providerID) &&
    typeof model.name === "string" &&
    typeof model.enabled === "boolean" &&
    Array.isArray(model.variants) &&
    model.variants.every(
      (variant) => isRecord(variant) && typeof variant.id === "string" && Boolean(variant.id),
    ) &&
    (model.status === "active" ||
      model.status === "alpha" ||
      model.status === "beta" ||
      model.status === "deprecated")
  );
}

function isValidSessionInboxInfo(value: unknown): value is SessionInboxInfo {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.sessionID !== "string" ||
    !/^ses/.test(value.sessionID) ||
    typeof value.timeCreated !== "number" ||
    !Number.isFinite(value.timeCreated) ||
    (value.delivery !== "steer" && value.delivery !== "queue") ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  if (value.type === "user") {
    return (
      typeof value.payload.text === "string" &&
      isOptionalArrayOf(value.payload.files, isPromptFileAttachment) &&
      isOptionalArrayOf(value.payload.agents, isPromptAgentAttachment) &&
      isOptionalArrayOf(value.payload.skills, isPromptSkillAttachment)
    );
  }
  if (value.type === "synthetic") {
    return (
      typeof value.payload.text === "string" &&
      (value.payload.description === undefined || typeof value.payload.description === "string")
    );
  }
  if (value.type === "compaction") return true;
  if (value.type === "move") {
    return isLocationRef(value.payload.location) && typeof value.payload.projectID === "string";
  }
  return false;
}

function isValidSession(session: unknown) {
  return (
    isRecord(session) &&
    typeof session.id === "string" &&
    /^ses/.test(session.id) &&
    typeof session.projectID === "string" &&
    Boolean(session.projectID) &&
    (session.parentID === undefined ||
      (typeof session.parentID === "string" && /^ses/.test(session.parentID))) &&
    isRecord(session.location) &&
    typeof session.location.directory === "string" &&
    Boolean(session.location.directory.trim()) &&
    (session.location.workspaceID === undefined ||
      (typeof session.location.workspaceID === "string" &&
        /^wrk/.test(session.location.workspaceID))) &&
    isRecord(session.time) &&
    typeof session.time.created === "number" &&
    Number.isFinite(session.time.created) &&
    typeof session.time.updated === "number" &&
    Number.isFinite(session.time.updated) &&
    (session.title === undefined || typeof session.title === "string")
  );
}

function isValidPermissionRequest(request: unknown) {
  return (
    isRecord(request) &&
    typeof request.id === "string" &&
    typeof request.sessionID === "string" &&
    typeof request.action === "string" &&
    Array.isArray(request.resources) &&
    request.resources.every((resource) => typeof resource === "string")
  );
}

function isValidForm(form: unknown) {
  return (
    isRecord(form) &&
    typeof form.id === "string" &&
    /^frm_/.test(form.id) &&
    typeof form.sessionID === "string" &&
    isValidFormOwner(form.sessionID) &&
    typeof form.title === "string" &&
    (form.metadata === undefined || isRecord(form.metadata)) &&
    Array.isArray(form.fields) &&
    form.fields.length > 0 &&
    isValidFormFields(form.fields)
  );
}

function isValidFormFields(fields: unknown[]) {
  const keys = new Set<string>();
  for (const field of fields) {
    if (
      !isRecord(field) ||
      !isValidFormField(field) ||
      typeof field.key !== "string" ||
      keys.has(field.key)
    ) {
      return false;
    }
    keys.add(field.key);
  }
  return true;
}

function isValidFormField(field: unknown) {
  if (
    !isRecord(field) ||
    typeof field.key !== "string" ||
    !field.key ||
    (field.title !== undefined && typeof field.title !== "string") ||
    (field.description !== undefined && typeof field.description !== "string")
  ) {
    return false;
  }
  if (field.type === "external") return typeof field.url === "string" && Boolean(field.url);
  if (
    (field.required !== undefined && typeof field.required !== "boolean") ||
    (field.when !== undefined &&
      (!Array.isArray(field.when) || !field.when.every(isValidFormCondition)))
  ) {
    return false;
  }
  if (field.type === "boolean") {
    return field.default === undefined || typeof field.default === "boolean";
  }
  if (field.type === "number" || field.type === "integer") {
    return (
      (field.minimum === undefined || isFormNumber(field.minimum)) &&
      (field.maximum === undefined || isFormNumber(field.maximum)) &&
      (field.default === undefined || isFormNumber(field.default))
    );
  }
  if (field.type === "multiselect") {
    return (
      Array.isArray(field.options) &&
      field.options.every(isValidFormOption) &&
      isOptionalNonNegativeInteger(field.minItems) &&
      isOptionalNonNegativeInteger(field.maxItems) &&
      (field.custom === undefined || typeof field.custom === "boolean") &&
      (field.default === undefined ||
        (Array.isArray(field.default) && field.default.every((value) => typeof value === "string")))
    );
  }
  if (field.type === "string") {
    return (
      (field.format === undefined ||
        field.format === "email" ||
        field.format === "uri" ||
        field.format === "date" ||
        field.format === "date-time") &&
      isOptionalNonNegativeInteger(field.minLength) &&
      isOptionalNonNegativeInteger(field.maxLength) &&
      (field.pattern === undefined || typeof field.pattern === "string") &&
      (field.placeholder === undefined || typeof field.placeholder === "string") &&
      (field.default === undefined || typeof field.default === "string") &&
      (field.options === undefined ||
        (Array.isArray(field.options) && field.options.every(isValidFormOption))) &&
      (field.custom === undefined || typeof field.custom === "boolean")
    );
  }
  return false;
}

function isValidFormCondition(condition: unknown) {
  return (
    isRecord(condition) &&
    typeof condition.key === "string" &&
    (condition.op === "eq" || condition.op === "neq") &&
    (typeof condition.value === "string" ||
      typeof condition.value === "number" ||
      typeof condition.value === "boolean")
  );
}

function isValidFormOption(option: unknown) {
  return (
    isRecord(option) &&
    typeof option.value === "string" &&
    typeof option.label === "string" &&
    (option.description === undefined || typeof option.description === "string")
  );
}

function isFormNumber(value: unknown) {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    value === "Infinity" ||
    value === "-Infinity" ||
    value === "NaN"
  );
}

function isOptionalNonNegativeInteger(value: unknown) {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0);
}

function isValidFormState(state: unknown): state is FormState {
  if (!isRecord(state)) return false;
  if (state.status === "pending" || state.status === "cancelled") return true;
  return (
    state.status === "answered" &&
    isRecord(state.answer) &&
    Object.values(state.answer).every(isValidFormValue)
  );
}

function isValidFormValue(value: unknown) {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function assertSessionAndFormIds(sessionID: string, formID: string) {
  if (!isValidFormOwner(sessionID)) throw new Error("INVALID_SESSION_ID");
  if (!/^frm_/.test(formID)) throw new Error("INVALID_FORM_ID");
}

function isValidFormOwner(value: unknown) {
  // Beta 18050 temporarily uses "global" for MCP elicitations without a session owner.
  return typeof value === "string" && (value === "global" || /^ses/.test(value));
}

function isOptionalNullableString(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isValidFileDiff(value: unknown): value is FileDiffInfo {
  return (
    isRecord(value) &&
    typeof value.file === "string" &&
    typeof value.patch === "string" &&
    typeof value.additions === "number" &&
    Number.isInteger(value.additions) &&
    value.additions >= 0 &&
    typeof value.deletions === "number" &&
    Number.isInteger(value.deletions) &&
    value.deletions >= 0 &&
    (value.status === "added" || value.status === "deleted" || value.status === "modified")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeOpenCodeBaseUrl(input: string) {
  const value = input.trim();
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("UNSUPPORTED_PROTOCOL");
  }
  if (url.username || url.password) {
    throw new Error("EMBEDDED_CREDENTIALS");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BASE_URL_MUST_BE_ORIGIN");
  }

  return url.origin;
}

export function classifyOpenCodeError(error: unknown) {
  if (hasTagInCause(error, "UnauthorizedError")) return "UNAUTHORIZED" as const;
  if (
    hasTagInCause(error, "ConflictError") ||
    hasTagInCause(error, "SessionBusyError") ||
    hasTagInCause(error, "FormAlreadySettledError")
  ) {
    return "CONFLICT" as const;
  }
  if (
    hasTagInCause(error, "InvalidRequestError") ||
    hasTagInCause(error, "FormInvalidAnswerError")
  ) {
    return "INVALID_REQUEST" as const;
  }
  if (hasTagInCause(error, "SessionNotFoundError") || hasTagInCause(error, "FormNotFoundError")) {
    return "NOT_FOUND" as const;
  }
  if (hasTagInCause(error, "MessageNotFoundError")) return "MESSAGE_NOT_FOUND" as const;
  if (hasAbortCause(error)) return "TIMEOUT" as const;
  if (hasTlsFailure(error)) return "TLS" as const;
  if (
    hasReasonInCause(error, "UnexpectedStatus") &&
    causeChainSome(error, (current) =>
      "status" in current ? current.status === 404 || current.status === 405 : false,
    )
  ) {
    return "INCOMPATIBLE" as const;
  }
  if (hasReasonInCause(error, "SseEventTooLarge")) return "SSE_TOO_LARGE" as const;
  if (hasReasonInCause(error, "ResponseTooLarge")) return "RESPONSE_TOO_LARGE" as const;
  if (hasReasonInCause(error, "UnsafeRedirect")) return "UNSAFE_REDIRECT" as const;
  if (hasReasonInCause(error, "UnsupportedContentType")) return "UNSUPPORTED_CONTENT" as const;
  if (hasReasonInCause(error, "MalformedResponse")) return "MALFORMED_RESPONSE" as const;
  return "UNREACHABLE" as const;
}

export type EventProbeFailure = "CANCELLATION_IGNORED" | "NO_EVENT" | "STREAM_ENDED";

export class EventProbeError extends Error {
  override readonly name = "EventProbeError";

  constructor(readonly reason: EventProbeFailure) {
    super(reason);
  }
}

export type EventProbeOptions = {
  cancellationTimeoutMs?: number;
  firstEventTimeoutMs?: number;
};

export type PtyProbeFailure =
  | "CLEANUP_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "SOCKET_CLOSED"
  | "SOCKET_ERROR"
  | "SOCKET_TIMEOUT"
  | "WEBSOCKET_UNAVAILABLE";

export class PtyProbeError extends Error {
  override readonly name = "PtyProbeError";

  constructor(readonly reason: PtyProbeFailure) {
    super(reason);
  }
}

type PtyProbeClient = {
  location: Pick<OpenCodeClient["location"], "get">;
  pty: Pick<OpenCodeClient["pty"], "create" | "remove"> & {
    connect: Pick<OpenCodeClient["pty"]["connect"], "token">;
  };
};

export type PtyProbeOptions = {
  maxOutputBytes?: number;
  requestTimeoutMs?: number;
  socketTimeoutMs?: number;
  WebSocketConstructor?: typeof WebSocket;
};

export function ptyWebSocketUrl(baseUrl: string, ptyID: string, directory: string, ticket: string) {
  const url = new URL(`/api/pty/${encodeURIComponent(ptyID)}/connect`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("location[directory]", directory);
  url.searchParams.set("cursor", "-1");
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export async function probePtyTransport(
  client: PtyProbeClient,
  baseUrl: string,
  options: PtyProbeOptions = {},
) {
  const WebSocketConstructor = options.WebSocketConstructor ?? globalThis.WebSocket;
  if (!WebSocketConstructor) throw new PtyProbeError("WEBSOCKET_UNAVAILABLE");

  const marker = `opencode-mobile-pty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let ptyID: string | undefined;
  let directory: string | undefined;
  let socket: WebSocket | undefined;
  let failed = false;
  let failure: unknown;
  let result: { cleanup: true; output: true; ticketExpiresIn: number } | undefined;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;

  try {
    const activeLocation = await withAbortDeadline(
      (signal) => client.location.get(undefined, { signal }),
      requestTimeoutMs,
    );
    const location = { directory: activeLocation.directory };
    const created = await withAbortDeadline(
      (signal) =>
        client.pty.create(
          {
            command: "/bin/cat",
            location,
            title: "opencode2-mobile transport probe",
          },
          { signal },
        ),
      requestTimeoutMs,
    );
    const createdPtyID = created.data.id;
    const createdDirectory = activeLocation.directory;
    ptyID = createdPtyID;
    directory = createdDirectory;
    const token = await withAbortDeadline(
      (signal) =>
        client.pty.connect.token(
          {
            ptyID: createdPtyID,
            location,
            "x-opencode-ticket": "1",
          },
          { signal },
        ),
      requestTimeoutMs,
    );

    socket = new WebSocketConstructor(
      ptyWebSocketUrl(baseUrl, createdPtyID, createdDirectory, token.data.ticket),
    );
    socket.binaryType = "arraybuffer";
    await waitForPtyMarker(
      socket,
      marker,
      options.maxOutputBytes ?? 64 * 1024,
      options.socketTimeoutMs ?? 5_000,
    );

    result = {
      cleanup: true,
      output: true,
      ticketExpiresIn: token.data.expires_in,
    };
  } catch (error) {
    failed = true;
    failure = error;
  }

  if (socket && socket.readyState < 2) {
    try {
      socket.close(1000, "probe complete");
    } catch {}
  }
  if (ptyID && directory) {
    try {
      await withAbortDeadline(
        (signal) => client.pty.remove({ ptyID, location: { directory } }, { signal }),
        requestTimeoutMs,
      );
    } catch {
      if (!failed) {
        failed = true;
        failure = new PtyProbeError("CLEANUP_FAILED");
      }
    }
  }

  if (failed) throw failure;
  return result as NonNullable<typeof result>;
}

export async function probeEventStream(
  client: Pick<OpenCodeClient, "event">,
  options: EventProbeOptions = {},
) {
  const probe = startEventStreamProbe(client, options);
  const first = await probe.firstEvent;
  await probe.stop();
  return { cancellation: true, eventType: first.eventType } as const;
}

export async function openEventStreamGeneration(
  client: Pick<OpenCodeClient, "event">,
  options: EventProbeOptions = {},
) {
  const probe = startEventStreamProbe(client, options);
  try {
    const first = await probe.firstEvent;
    return { eventType: first.eventType, cancel: probe.stop };
  } catch (error) {
    await probe.stop().catch(() => undefined);
    throw error;
  }
}

export function startEventStreamProbe(
  client: Pick<OpenCodeClient, "event">,
  options: EventProbeOptions = {},
) {
  const controller = new AbortController();
  const iterator = client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]();
  const firstRead = withDeadline(
    iterator.next(),
    options.firstEventTimeoutMs ?? 10_000,
    () => controller.abort(),
    "NO_EVENT",
  );
  const firstEvent = firstRead.then((first) => {
    if (first.done) throw new EventProbeError("STREAM_ENDED");
    return { eventType: first.value.type } as const;
  });
  let cancellation: Promise<void> | undefined;

  return {
    firstEvent,
    stop() {
      controller.abort();
      cancellation ??= firstRead.then(
        (first) => {
          if (first.done) return;
          return waitForEventCancellation(
            iterator,
            controller,
            options.cancellationTimeoutMs ?? 3_000,
          );
        },
        (error: unknown) => {
          if (controller.signal.aborted || classifyOpenCodeError(error) === "TIMEOUT") return;
          throw error;
        },
      );
      return cancellation;
    },
  };
}

async function waitForEventCancellation(
  iterator: AsyncIterator<OpenCodeEvent>,
  controller: AbortController,
  timeoutMs: number,
) {
  for (let buffered = 0; buffered < 3; buffered += 1) {
    try {
      const next = await withDeadline(
        iterator.next(),
        timeoutMs,
        () => undefined,
        "CANCELLATION_IGNORED",
      );
      if (next.done) return;
    } catch (error) {
      if (error instanceof EventProbeError) throw error;
      if (controller.signal.aborted || classifyOpenCodeError(error) === "TIMEOUT") return;
      throw error;
    }
  }

  throw new EventProbeError("CANCELLATION_IGNORED");
}

function waitForPtyMarker(
  socket: WebSocket,
  marker: string,
  maxOutputBytes: number,
  timeoutMs: number,
) {
  return new Promise<void>((resolve, reject) => {
    let outputBytes = 0;
    let tail = "";
    let settled = false;
    const decoder = new TextDecoder();
    const timeout = setTimeout(() => finish(new PtyProbeError("SOCKET_TIMEOUT")), timeoutMs);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onOpen = () => {
      try {
        socket.send(`${marker}\n`);
      } catch {
        finish(new PtyProbeError("SOCKET_ERROR"));
      }
    };
    const onMessage = (event: MessageEvent) => {
      const text = decodePtyMessage(event.data, decoder);
      if (text === undefined) return;
      outputBytes += new TextEncoder().encode(text).byteLength;
      if (outputBytes > maxOutputBytes) {
        finish(new PtyProbeError("OUTPUT_TOO_LARGE"));
        return;
      }

      const combined = tail + text;
      if (combined.includes(marker)) {
        finish();
        return;
      }
      tail = combined.slice(-marker.length);
    };
    const onError = () => finish(new PtyProbeError("SOCKET_ERROR"));
    const onClose = () => finish(new PtyProbeError("SOCKET_CLOSED"));

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function withAbortDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number) {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("The operation timed out", "AbortError"));
    }, timeoutMs);

    operation(controller.signal).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function decodePtyMessage(data: unknown, decoder: TextDecoder) {
  if (typeof data === "string") return data;

  let bytes: Uint8Array | undefined;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (!bytes || bytes[0] === 0) return undefined;
  return decoder.decode(bytes);
}

function exceedsUtf8Bytes(value: string, maxBytes: number) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) return true;
  }
  return false;
}

function requestUrl(input: RequestInfo | URL) {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
}

function hasTag(value: unknown, tag: string): value is { _tag: string } {
  return typeof value === "object" && value !== null && "_tag" in value && value._tag === tag;
}

function hasTagInCause(value: unknown, tag: string) {
  return causeChainSome(value, (current) => hasTag(current, tag));
}

function hasReason(value: unknown, reason: string): value is { reason: string } {
  return (
    typeof value === "object" && value !== null && "reason" in value && value.reason === reason
  );
}

function hasReasonInCause(value: unknown, reason: string) {
  return causeChainSome(value, (current) => hasReason(current, reason));
}

function hasTlsFailure(value: unknown) {
  const tlsCodes = new Set([
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ]);
  return causeChainSome(value, (current) => {
    if ("code" in current) {
      if (typeof current.code === "number" && current.code >= -1206 && current.code <= -1200) {
        return true;
      }
      if (typeof current.code === "string" && tlsCodes.has(current.code.toUpperCase())) return true;
    }
    if ("name" in current && typeof current.name === "string") {
      if (/SSL|TLS|Certificate|CertPath/i.test(current.name)) return true;
    }
    if ("message" in current && typeof current.message === "string") {
      return /certificate|SSL|TLS|trust anchor|secure connection/i.test(current.message);
    }
    return false;
  });
}

function causeChainSome(value: unknown, predicate: (current: object) => boolean) {
  const seen = new Set<unknown>();
  let current = value;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    if (predicate(current)) return true;
    seen.add(current);
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}

function hasAbortCause(value: unknown) {
  return causeChainSome(value, (current) => "name" in current && current.name === "AbortError");
}

function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  reason: EventProbeFailure,
) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout();
      reject(new EventProbeError(reason));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export type OpenCodeClient = ReturnType<typeof createOpenCodeClient>;

export type {
  AgentInfo,
  AgentListOutput,
  FileDiffInfo,
  FormAnswer,
  FormField,
  FormInfo,
  FormState,
  LocationGetOutput,
  LocationRef,
  MessageListInput,
  ModelDefaultOutput,
  ModelInfo,
  ModelListOutput,
  ModelRef,
  PermissionReply,
  PermissionRequest,
  ProjectCurrent,
  ProjectListOutput,
  ServiceHealth,
  SessionActive,
  SessionInboxDelivery,
  SessionInboxInfo,
  SessionInboxUser,
  SessionInfo,
  SessionListInput,
  SessionMessageInfo,
  SessionMessagesResponse,
  SessionsResponse,
} from "@opencode-ai/client";
export type { OpenCodeEvent };
