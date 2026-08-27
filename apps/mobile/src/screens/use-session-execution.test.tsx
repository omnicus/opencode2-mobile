import { afterAll, afterEach, beforeAll, beforeEach, expect, jest, test } from "@jest/globals";
import type {
  LocationRef,
  OpenCodeClient,
  SessionInboxInfo,
  SessionInfo,
  SessionMessageInfo,
} from "@opencode2-mobile/opencode-adapter";
import {
  notifyManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { openCodeQueryKeys } from "../state/open-code-query-keys";
import type { PromptAdmission } from "./prompt-admission-model";
import { resolveSessionAgent, useSessionExecution } from "./use-session-execution";

const mockLocation = { directory: "/workspace" } satisfies LocationRef;
const mockAdmissionDb = {
  getAllAsync: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  runAsync: jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  withExclusiveTransactionAsync: jest.fn(async (task: (txn: unknown) => Promise<void>) =>
    task(mockAdmissionDb),
  ),
};
const mockBackground = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockCancel = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockCommand = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockGetMessage = jest.fn<(...args: unknown[]) => Promise<SessionMessageInfo>>();
const mockInterrupt = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockListActive = jest.fn<
  (...args: unknown[]) => Promise<Record<string, { type: "running" }>>
>(async () => ({}));
const mockListAgents = jest.fn<
  (...args: unknown[]) => Promise<{ data: []; location: LocationRef }>
>(async () => ({ data: [], location: mockLocation }));
const mockListCommands = jest.fn<
  (...args: unknown[]) => Promise<{ data: []; location: LocationRef }>
>(async () => ({ data: [], location: mockLocation }));
const mockListInbox = jest.fn<(...args: unknown[]) => Promise<SessionInboxInfo[]>>(async () => []);
const mockListModels = jest.fn<
  (...args: unknown[]) => Promise<{ data: []; location: LocationRef }>
>(async () => ({ data: [], location: mockLocation }));
const mockListSkills = jest.fn<
  (...args: unknown[]) => Promise<{ data: []; location: LocationRef }>
>(async () => ({ data: [], location: mockLocation }));
const mockPrompt = jest.fn<(...args: unknown[]) => Promise<SessionInboxInfo>>();
const mockQueue = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockSteer = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockSwitchAgent = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockSwitchModel = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockWait = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockPersistDraft = jest.fn<(content: string, revision: number) => Promise<void>>(
  async () => undefined,
);

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  backgroundOpenCodeSession: (...args: unknown[]) => mockBackground(...args),
  cancelOpenCodeSessionInboxItem: (...args: unknown[]) => mockCancel(...args),
  classifyOpenCodeError: (error: unknown) => mockClassifyError(error),
  getDefaultOpenCodeAgent: jest.fn(async () => null),
  getDefaultOpenCodeModel: jest.fn(async () => ({ data: null, location: mockLocation })),
  getOpenCodeSessionMessage: (...args: unknown[]) => mockGetMessage(...args),
  interruptOpenCodeSession: (...args: unknown[]) => mockInterrupt(...args),
  listActiveOpenCodeSessions: (...args: unknown[]) => mockListActive(...args),
  listOpenCodeAgents: (...args: unknown[]) => mockListAgents(...args),
  listOpenCodeCommands: (...args: unknown[]) => mockListCommands(...args),
  listOpenCodeModels: (...args: unknown[]) => mockListModels(...args),
  listOpenCodeSessionInbox: (...args: unknown[]) => mockListInbox(...args),
  listOpenCodeSkills: (...args: unknown[]) => mockListSkills(...args),
  promptOpenCodeSession: (...args: unknown[]) => mockPrompt(...args),
  queueOpenCodeSessionInboxItem: (...args: unknown[]) => mockQueue(...args),
  runOpenCodeSessionCommand: (...args: unknown[]) => mockCommand(...args),
  steerOpenCodeSessionInboxItem: (...args: unknown[]) => mockSteer(...args),
  switchOpenCodeSessionAgent: (...args: unknown[]) => mockSwitchAgent(...args),
  switchOpenCodeSessionModel: (...args: unknown[]) => mockSwitchModel(...args),
  waitForOpenCodeSession: (...args: unknown[]) => mockWait(...args),
}));

jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-crypto", () => {
  let nextID = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++nextID).padStart(12, "0")}` };
});

jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockAdmissionDb }));

const location = mockLocation;
const client = {} as OpenCodeClient;

beforeAll(() => {
  notifyManager.setNotifyFunction((callback) => {
    act(callback);
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockListActive.mockResolvedValue({});
  mockListInbox.mockResolvedValue([]);
  mockAdmissionDb.getAllAsync.mockResolvedValue([]);
  act(() => onlineManager.setOnline(true));
});

afterEach(() => {
  act(() => onlineManager.setOnline(true));
});

afterAll(() => {
  notifyManager.setNotifyFunction((callback) => callback());
});

test("resolves session, configured, and build agent defaults in priority order", () => {
  expect(resolveSessionAgent("review", "plan", ["build", "plan", "review"])).toBe("review");
  expect(resolveSessionAgent(undefined, "plan", ["build", "plan"])).toBe("plan");
  expect(resolveSessionAgent(undefined, "missing", ["review", "build"])).toBe("build");
  expect(resolveSessionAgent(undefined, undefined, ["review"])).toBe("review");
});

test("admits only once when the send control is tapped twice before rerender", async () => {
  let resolvePrompt: ((item: SessionInboxInfo) => void) | undefined;
  mockPrompt.mockImplementation(
    () =>
      new Promise<SessionInboxInfo>((resolve) => {
        resolvePrompt = resolve;
      }),
  );
  const clearDraft = jest.fn();
  const hook = renderExecutionHook({ onAdmissionConfirmed: clearDraft });
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() => {
    hook.result.current.submit("Do the work");
    hook.result.current.submit("Do the work");
  });

  await waitFor(() => expect(mockPrompt).toHaveBeenCalledTimes(1));
  expect(mockPersistDraft).toHaveBeenCalledWith("Do the work", 0);
  expect(mockPersistDraft.mock.invocationCallOrder[0]).toBeLessThan(
    mockAdmissionDb.runAsync.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
  );
  expect(String(mockAdmissionDb.runAsync.mock.calls[0]?.[0])).toContain(
    "INSERT INTO unresolved_prompt_admissions",
  );
  expect(mockAdmissionDb.runAsync.mock.invocationCallOrder[0]).toBeLessThan(
    mockPrompt.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
  );
  const admissionID = (mockPrompt.mock.calls[0]?.[2] as { id: string } | undefined)?.id ?? "";
  await act(async () => {
    resolvePrompt?.(userInbox(admissionID, "steer"));
  });
  await waitFor(() => expect(clearDraft).toHaveBeenCalledTimes(1));
});

test("does not transmit when unresolved admission metadata cannot be persisted", async () => {
  mockAdmissionDb.runAsync.mockRejectedValueOnce(new Error("storage unavailable"));
  const hook = renderExecutionHook();
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() => hook.result.current.submit("Do not send"));

  await waitFor(() => expect(hook.result.current.error).toMatch(/not sent/i));
  expect(mockPrompt).not.toHaveBeenCalled();
  expect(hook.result.current.submitDisabled).toBe(false);
});

test("does not transmit when the submitted encrypted draft cannot be persisted", async () => {
  mockPersistDraft.mockRejectedValueOnce(new Error("storage unavailable"));
  const hook = renderExecutionHook();
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() => hook.result.current.submit("Do not send"));

  await waitFor(() => expect(hook.result.current.error).toMatch(/not sent/i));
  expect(mockAdmissionDb.runAsync).not.toHaveBeenCalled();
  expect(mockPrompt).not.toHaveBeenCalled();
});

test("does not leave an offline prompt paused as an automatic reconnect outbox", async () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(openCodeQueryKeys.activeSessions("connection-1"), {});
  queryClient.setQueryData(openCodeQueryKeys.inbox("connection-1", location, "ses_a"), []);
  queryClient.setQueryData(
    openCodeQueryKeys.promptAdmissions("connection-1", location, "ses_a"),
    [],
  );
  act(() => onlineManager.setOnline(false));
  mockPrompt.mockRejectedValueOnce(new TypeError("Network request failed"));
  const hook = renderHook(() => useSessionExecution(executionOptions("ses_a")), {
    wrapper: queryWrapper(queryClient),
  });
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() => hook.result.current.submit("Attempt now"));

  await waitFor(() => expect(mockPrompt).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(hook.result.current.admissions[0]?.status).toBe("unknown-delivery"));
  act(() => onlineManager.setOnline(true));
  expect(mockPrompt).toHaveBeenCalledTimes(1);
});

test("preserves an unknown draft when the latest server snapshot has no matching ID", async () => {
  mockPrompt.mockRejectedValueOnce({ _tag: "ConflictError" });
  mockGetMessage.mockRejectedValue({ _tag: "MessageNotFoundError" });
  const clearDraft = jest.fn();
  const hook = renderExecutionHook({ onAdmissionConfirmed: clearDraft });
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() => hook.result.current.submit("Possibly admitted"));
  await waitFor(() => expect(hook.result.current.admissions[0]?.status).toBe("unknown-delivery"));
  expect(hook.result.current.submitDisabled).toBe(true);
  const admissionID = hook.result.current.admissions[0]?.id;
  expect(admissionID).toBeDefined();

  act(() => hook.result.current.reconcileAdmission(admissionID ?? ""));
  await waitFor(() => expect(hook.result.current.error).toMatch(/Do not resend/i));
  expect(hook.result.current.admissions[0]?.status).toBe("unknown-delivery");
  expect(hook.result.current.admissions[0]?.retryOffered).toBe(true);
  expect(hook.result.current.submitDisabled).toBe(true);
  expect(clearDraft).not.toHaveBeenCalled();
  expect(mockPrompt).toHaveBeenCalledTimes(1);

  act(() => hook.result.current.allowRetry(admissionID ?? ""));
  await waitFor(() => expect(hook.result.current.admissions).toEqual([]));
  expect(hook.result.current.submitDisabled).toBe(false);
  expect(clearDraft).not.toHaveBeenCalled();
});

test("requires explicit active-turn delivery and applies inbox and execution controls", async () => {
  mockListActive.mockResolvedValue({ ses_a: { type: "running" } });
  mockListInbox.mockResolvedValue([userInbox("msg_queued", "queue")]);
  mockPrompt.mockImplementation(async (...args) => {
    const input = args[2] as { delivery: "queue" | "steer"; id: string };
    return userInbox(input.id, input.delivery);
  });
  const hook = renderExecutionHook();
  await waitFor(() => expect(hook.result.current.active).toBe(true));

  act(() => hook.result.current.submit("Follow up"));
  expect(mockPrompt).not.toHaveBeenCalled();
  act(() => hook.result.current.setDelivery("queue"));
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));
  act(() => hook.result.current.submit("Follow up"));
  await waitFor(() => expect(mockPrompt).toHaveBeenCalledTimes(1));
  expect((mockPrompt.mock.calls[0]?.[2] as { delivery?: string } | undefined)?.delivery).toBe(
    "queue",
  );

  act(() => hook.result.current.steerInbox("msg_queued"));
  await waitFor(() => expect(mockSteer).toHaveBeenCalledTimes(1));
  act(() => hook.result.current.queueInbox("msg_queued"));
  await waitFor(() => expect(mockQueue).toHaveBeenCalledTimes(1));
  act(() => hook.result.current.cancelInbox("msg_queued"));
  await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
  act(() => hook.result.current.interrupt());
  await waitFor(() => expect(mockInterrupt).toHaveBeenCalledTimes(1));
  expect(mockInterrupt.mock.calls[0]?.[2]).toBe(false);
  act(() => hook.result.current.background());
  await waitFor(() => expect(mockBackground).toHaveBeenCalledTimes(1));
  act(() => hook.result.current.wait());
  await waitFor(() => expect(mockWait).toHaveBeenCalledTimes(1));
});

test("submits a command through the command endpoint with the existing admission guard", async () => {
  const clearDraft = jest.fn();
  const hook = renderExecutionHook({ onAdmissionConfirmed: clearDraft });
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() =>
    hook.result.current.submit("/review src/æ.ts\nthen tests", {
      arguments: "src/æ.ts\nthen tests",
      command: "review",
      type: "command",
    }),
  );

  await waitFor(() => expect(mockCommand).toHaveBeenCalledTimes(1));
  expect(mockCommand.mock.calls[0]?.[2]).toMatchObject({
    command: "review",
    delivery: "steer",
    text: "src/æ.ts\nthen tests",
  });
  expect(mockPrompt).not.toHaveBeenCalled();
  await waitFor(() => expect(clearDraft).toHaveBeenCalledTimes(1));
});

test("offers an explicit duplicate-risk retry when a command response is lost", async () => {
  mockCommand.mockRejectedValueOnce(new TypeError("Network request failed"));
  const clearDraft = jest.fn();
  const hook = renderExecutionHook({ onAdmissionConfirmed: clearDraft });
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() =>
    hook.result.current.submit("/review", {
      command: "review",
      type: "command",
    }),
  );

  await waitFor(() => expect(hook.result.current.admissions[0]?.status).toBe("unknown-delivery"));
  expect(hook.result.current.admissions[0]).toMatchObject({
    kind: "command",
    retryOffered: true,
  });
  expect(hook.result.current.submitDisabled).toBe(true);
  expect(clearDraft).not.toHaveBeenCalled();

  const admissionID = hook.result.current.admissions[0]?.id ?? "";
  act(() => hook.result.current.reconcileAdmission(admissionID));
  await waitFor(() => expect(hook.result.current.error).toMatch(/cannot be identified/i));
  expect(mockGetMessage).not.toHaveBeenCalled();
});

test("submits structured file, skill, and agent mentions through the prompt endpoint", async () => {
  mockPrompt.mockImplementation(async (...args) => {
    const input = args[2] as { delivery: "queue" | "steer"; id: string };
    return userInbox(input.id, input.delivery);
  });
  const clearDraft = jest.fn();
  const hook = renderExecutionHook({ onAdmissionConfirmed: clearDraft });
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() =>
    hook.result.current.submit("Check @src/index.ts with @Explore and @release", {
      agents: [{ mention: { end: 33, start: 25, text: "@Explore" }, name: "Explore" }],
      files: [
        {
          mention: { end: 19, start: 6, text: "@src/index.ts" },
          name: "src/index.ts",
          uri: "file:///workspace/src/index.ts",
        },
      ],
      skills: [{ id: "release", mention: { end: 46, start: 38, text: "@release" } }],
      type: "prompt",
    }),
  );

  await waitFor(() => expect(mockPrompt).toHaveBeenCalledTimes(1));
  expect(mockPrompt.mock.calls[0]?.[2]).toMatchObject({
    agents: [{ name: "Explore" }],
    files: [{ uri: "file:///workspace/src/index.ts" }],
    skills: [{ id: "release" }],
  });
  await waitFor(() => expect(clearDraft).toHaveBeenCalledTimes(1));
});

test("restores an unresolved admission after restart and reconciles it from the inbox", async () => {
  const queryClient = createQueryClient();
  const admission = {
    durable: false,
    id: "msg_reconnected",
    kind: "prompt",
    status: "unknown-delivery",
    submittedAtMs: 1,
  } satisfies PromptAdmission;
  mockAdmissionDb.getAllAsync.mockResolvedValueOnce([
    {
      admission_id: admission.id,
      delivery: null,
      draft_revision: 0,
      submission_kind: "prompt",
      status: "submitting",
      submitted_at_ms: 1,
    },
  ]);
  mockListInbox.mockResolvedValue([userInbox(admission.id, "queue")]);
  const clearDraft = jest.fn();
  const hook = renderHook(() => useSessionExecution(executionOptions("ses_a", clearDraft)), {
    wrapper: queryWrapper(queryClient),
  });

  await waitFor(() => expect(hook.result.current.admissions[0]?.status).toBe("queued"));
  expect(clearDraft).toHaveBeenCalledTimes(1);
});

test("does not clear a newer draft when a handled admission is restored", async () => {
  const queryClient = createQueryClient();
  const admission = {
    confirmationHandled: true,
    delivery: "queue",
    durable: true,
    id: "msg_handled",
    kind: "prompt",
    status: "queued",
    submittedAtMs: 1,
  } satisfies PromptAdmission;
  queryClient.setQueryData(openCodeQueryKeys.promptAdmissions("connection-1", location, "ses_a"), [
    admission,
  ]);
  mockListInbox.mockResolvedValue([userInbox(admission.id, "queue")]);
  const clearDraft = jest.fn();
  const hook = renderHook(() => useSessionExecution(executionOptions("ses_a", clearDraft)), {
    wrapper: queryWrapper(queryClient),
  });

  await waitFor(() => expect(hook.result.current.admissions[0]?.status).toBe("queued"));
  expect(clearDraft).not.toHaveBeenCalled();
});

test("keeps a late admission result scoped to the session that sent it", async () => {
  let submittedSignal: AbortSignal | undefined;
  mockPrompt.mockImplementation((...args) => {
    const options = args[3] as { signal: AbortSignal };
    return new Promise((_resolve, reject) => {
      submittedSignal = options.signal;
      options.signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  });
  const queryClient = createQueryClient();
  const clearA = jest.fn();
  const clearB = jest.fn();
  const hook = renderHook(
    (props: { clearDraft: () => void; sessionID: string }) =>
      useSessionExecution(executionOptions(props.sessionID, props.clearDraft)),
    {
      initialProps: { clearDraft: clearA, sessionID: "ses_a" },
      wrapper: queryWrapper(queryClient),
    },
  );
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));
  act(() => hook.result.current.submit("Session A"));
  await waitFor(() => expect(mockPrompt).toHaveBeenCalledTimes(1));

  hook.rerender({ clearDraft: clearB, sessionID: "ses_b" });
  await waitFor(() => expect(submittedSignal?.aborted).toBe(true));
  await waitFor(() => {
    const sessionA = queryClient.getQueryData<PromptAdmission[]>(
      openCodeQueryKeys.promptAdmissions("connection-1", location, "ses_a"),
    );
    expect(sessionA?.[0]?.status).toBe("unknown-delivery");
  });
  expect(hook.result.current.admissions).toEqual([]);
  expect(hook.result.current.error).toBeUndefined();
  expect(clearA).not.toHaveBeenCalled();
  expect(clearB).not.toHaveBeenCalled();
});

test("resets delivery and visible errors when the session scope changes", async () => {
  mockListActive.mockResolvedValue({
    ses_a: { type: "running" },
    ses_b: { type: "running" },
  });
  mockSwitchAgent.mockRejectedValueOnce(new Error("failed"));
  const hook = renderHook(
    ({ sessionID }: { sessionID: string }) => useSessionExecution(executionOptions(sessionID)),
    {
      initialProps: { sessionID: "ses_a" },
      wrapper: queryWrapper(createQueryClient()),
    },
  );
  await waitFor(() => expect(hook.result.current.active).toBe(true));
  act(() => hook.result.current.setDelivery("queue"));
  act(() => hook.result.current.switchAgent("build"));
  await waitFor(() => expect(hook.result.current.error).toMatch(/agent/i));

  hook.rerender({ sessionID: "ses_b" });

  await waitFor(() => expect(hook.result.current.delivery).toBeUndefined());
  expect(hook.result.current.error).toBeUndefined();
  expect(hook.result.current.busyAction).toBeUndefined();
});

function renderExecutionHook(overrides?: { onAdmissionConfirmed?: () => void }) {
  const queryClient = createQueryClient();
  return renderHook(
    () => useSessionExecution(executionOptions("ses_a", overrides?.onAdmissionConfirmed)),
    {
      wrapper: queryWrapper(queryClient),
    },
  );
}

function executionOptions(sessionID: string, onAdmissionConfirmed: () => void = jest.fn()) {
  return {
    client,
    connectionId: "connection-1",
    draftReady: true,
    draftRevision: 0,
    location,
    messages: [],
    onAdmissionConfirmed,
    persistDraft: mockPersistDraft,
    refetchMessages: jest.fn(async () => undefined),
    routeConnectionId: "connection-1",
    session: sessionInfo(sessionID),
    sessionID,
  };
}

function sessionInfo(sessionID: string): SessionInfo {
  return {
    cost: 0,
    id: sessionID,
    location,
    projectID: "project-1",
    time: { created: 1, updated: 1 },
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  };
}

function userInbox(id: string, delivery: "queue" | "steer") {
  return {
    delivery,
    id,
    payload: { text: "Prompt" },
    sessionID: "ses_a",
    timeCreated: 1,
    type: "user" as const,
  } satisfies SessionInboxInfo;
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { gcTime: Number.POSITIVE_INFINITY },
      queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
}

function queryWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function mockClassifyError(error: unknown) {
  if (mockIsTagged(error, "ConflictError") || mockIsTagged(error, "SessionBusyError")) {
    return "CONFLICT";
  }
  if (mockIsTagged(error, "MessageNotFoundError")) return "MESSAGE_NOT_FOUND";
  if (mockIsTagged(error, "InvalidRequestError")) return "INVALID_REQUEST";
  if (mockIsTagged(error, "SessionNotFoundError")) return "NOT_FOUND";
  if (mockIsTagged(error, "UnauthorizedError")) return "UNAUTHORIZED";
  return "UNREACHABLE";
}

function mockIsTagged(error: unknown, tag: string) {
  return typeof error === "object" && error !== null && "_tag" in error && error._tag === tag;
}
