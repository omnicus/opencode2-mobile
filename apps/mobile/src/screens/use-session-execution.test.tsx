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
const mockPreferences: { defaultDelivery: "queue" | "steer"; busy: boolean } = {
  defaultDelivery: "steer",
  busy: false,
};
jest.mock("../state/transcript-preferences", () => ({
  useTranscriptPreferences: () => mockPreferences,
}));
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
  mockPreferences.defaultDelivery = "steer";
  mockPreferences.busy = false;
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

test("uses the saved queue default and applies inbox and execution controls", async () => {
  mockPreferences.defaultDelivery = "queue";
  mockListActive.mockResolvedValue({ ses_a: { type: "running" } });
  mockListInbox.mockResolvedValue([userInbox("msg_queued", "queue")]);
  mockPrompt.mockImplementation(async (...args) => {
    const input = args[2] as { delivery: "queue" | "steer"; id: string };
    return userInbox(input.id, input.delivery);
  });
  const hook = renderExecutionHook();
  await waitFor(() => expect(hook.result.current.active).toBe(true));

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
  expect(hook.result.current.canBackground).toBe(false);
  expect(mockBackground).not.toHaveBeenCalled();
  act(() => hook.result.current.wait());
  await waitFor(() => expect(mockWait).toHaveBeenCalledTimes(1));
});

test.each(["steer", "queue"] as const)(
  "shows a %s preview immediately, before server acceptance",
  async (delivery) => {
    mockPreferences.defaultDelivery = delivery;
    mockListActive.mockResolvedValue({ ses_a: { type: "running" } });
    let accept: ((item: SessionInboxInfo) => void) | undefined;
    mockPrompt.mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
    const hook = renderExecutionHook();
    await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));
    act(() => hook.result.current.submit("Pending follow-up"));
    await waitFor(() => expect(hook.result.current.pendingPrompts).toHaveLength(1));
    const id = hook.result.current.admissions[0]?.id;
    expect(hook.result.current.pendingPrompts[0]).toMatchObject({
      id,
      text: "Pending follow-up",
      status: "sending",
    });
    await waitFor(() => expect(accept).toBeDefined());
    expect(
      mockAdmissionDb.runAsync.mock.calls.some((args) => args.includes("Pending follow-up")),
    ).toBe(false);
    await act(async () => {
      accept?.(userInbox(id ?? "", delivery));
    });
    await waitFor(() =>
      expect(hook.result.current.pendingPrompts[0]?.status).toBe(
        delivery === "queue" ? "queued" : "steering",
      ),
    );
    expect(hook.result.current.pendingPrompts).toHaveLength(1);
    hook.unmount();
  },
);

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

test("background control follows a live foreground tool and rejects completed or stale work", async () => {
  mockListActive.mockResolvedValue({ ses_a: { type: "running" } });
  const queryClient = createQueryClient();
  const message: SessionMessageInfo = {
    type: "assistant",
    id: "msg_blocking",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 1 },
    content: [
      {
        type: "tool",
        id: "tool_shell",
        name: "shell",
        time: { created: 1 },
        state: { status: "running", input: { command: "test" }, metadata: {} },
      },
    ],
  };
  const hook = renderHook(
    ({ messages }: { messages: SessionMessageInfo[] }) =>
      useSessionExecution({
        ...executionOptions("ses_a"),
        messages,
      }),
    { initialProps: { messages: [message] }, wrapper: queryWrapper(queryClient) },
  );
  await waitFor(() => expect(hook.result.current.canBackground).toBe(true));
  act(() => hook.result.current.background());
  await waitFor(() => expect(mockBackground).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(hook.result.current.busyAction).toBeUndefined());
  const part = message.content[0];
  if (part?.type !== "tool" || part.state.status !== "running") throw new Error("fixture");
  for (const changed of [
    { ...message, time: { created: 1, completed: 2 } },
    { ...message, content: [{ ...part, name: "read" }] },
    {
      ...message,
      content: [{ ...part, state: { ...part.state, metadata: { background: true } } }],
    },
    { ...message, content: [{ ...part, state: { status: "streaming" as const, input: "{}" } }] },
  ]) {
    hook.rerender({ messages: [changed] });
    expect(hook.result.current.canBackground).toBe(false);
    act(() => hook.result.current.background());
    expect(mockBackground).toHaveBeenCalledTimes(1);
  }
  hook.rerender({
    messages: [
      { type: "idle", id: "msg_idle", outcome: "succeeded", time: { created: 2 } },
      message,
    ],
  });
  expect(hook.result.current.canBackground).toBe(false);
  hook.rerender({ messages: [{ ...message, content: [{ ...part, name: "subagent" }] }] });
  expect(hook.result.current.canBackground).toBe(true);
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

test("retains the saved delivery default and clears errors when the session scope changes", async () => {
  mockPreferences.defaultDelivery = "queue";
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
  act(() => hook.result.current.switchAgent("build"));
  await waitFor(() => expect(hook.result.current.error).toMatch(/agent/i));

  hook.rerender({ sessionID: "ses_b" });

  await waitFor(() => expect(hook.result.current.delivery).toBe("queue"));
  expect(hook.result.current.error).toBeUndefined();
  expect(hook.result.current.busyAction).toBeUndefined();
});

test("confirms an unknown prompt from its projected message when the inbox no longer lists it", async () => {
  mockPrompt.mockRejectedValueOnce(new TypeError("Network request failed"));
  const clearDraft = jest.fn();
  const refetchMessages = jest.fn(async () => undefined);
  const hook = renderHook(
    () => useSessionExecution({ ...executionOptions("ses_a", clearDraft), refetchMessages }),
    { wrapper: queryWrapper(createQueryClient()) },
  );
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));
  act(() => hook.result.current.submit("Possibly admitted"));
  await waitFor(() => expect(hook.result.current.error).toMatch(/prompt may have been admitted/i));
  const admissionID = hook.result.current.admissions[0]?.id ?? "";
  mockGetMessage.mockResolvedValueOnce({
    id: admissionID,
    time: { created: 3 },
    type: "user",
  } as unknown as SessionMessageInfo);
  refetchMessages.mockClear();

  act(() => hook.result.current.reconcileAdmission(admissionID));

  await waitFor(() => expect(clearDraft).toHaveBeenCalledWith(0));
  expect(hook.result.current.admissions[0]).toMatchObject({
    confirmationHandled: true,
    serverAdmittedAtMs: 3,
    status: "promoted",
  });
  expect(hook.result.current.error).toBeUndefined();
  await waitFor(() => expect(refetchMessages).toHaveBeenCalled());
});

test("keeps delivery unknown without offering a retry when the server cannot be read", async () => {
  mockPrompt.mockRejectedValueOnce(new TypeError("Network request failed"));
  const hook = renderExecutionHook();
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));
  act(() => hook.result.current.submit("Possibly admitted"));
  await waitFor(() => expect(hook.result.current.admissions[0]?.status).toBe("unknown-delivery"));
  mockListInbox.mockRejectedValue(new TypeError("Network request failed"));
  mockGetMessage.mockRejectedValueOnce(new TypeError("Network request failed"));

  act(() => hook.result.current.reconcileAdmission(hook.result.current.admissions[0]?.id ?? ""));

  await waitFor(() => expect(hook.result.current.error).toMatch(/still unknown/i));
  expect(hook.result.current.admissions[0]?.retryOffered).toBeUndefined();
});

test("cancels a prompt the server rejects and forgets its recovery record", async () => {
  mockPrompt.mockRejectedValueOnce({ _tag: "InvalidRequestError" });
  const hook = renderExecutionHook();
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() => hook.result.current.submit("Rejected"));

  await waitFor(() => expect(hook.result.current.error).toMatch(/rejected this prompt/i));
  expect(hook.result.current.admissions[0]?.status).toBe("cancelled");
  await waitFor(() =>
    expect(
      mockAdmissionDb.runAsync.mock.calls.some((args) => String(args[0]).includes("DELETE")),
    ).toBe(true),
  );
});

test("cancels a submission whose draft changed before transmission", async () => {
  mockPersistDraft.mockRejectedValueOnce(new Error("DRAFT_CHANGED_BEFORE_SEND"));
  const hook = renderExecutionHook();
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() => hook.result.current.submit("Changed"));

  await waitFor(() => expect(hook.result.current.error).toMatch(/draft changed/i));
  expect(hook.result.current.admissions[0]?.status).toBe("cancelled");
  expect(mockPrompt).not.toHaveBeenCalled();
});

test("reloads the inbox when an inbox action fails", async () => {
  mockListInbox.mockResolvedValue([userInbox("msg_queued", "queue")]);
  mockSteer.mockRejectedValueOnce(new Error("gone"));
  const hook = renderExecutionHook();
  await waitFor(() => expect(hook.result.current.inbox).toHaveLength(1));
  const inboxLoads = mockListInbox.mock.calls.length;

  act(() => hook.result.current.steerInbox("msg_queued"));

  await waitFor(() => expect(hook.result.current.error).toMatch(/inbox changed/i));
  await waitFor(() => expect(mockListInbox.mock.calls.length).toBeGreaterThan(inboxLoads));
});

test("switches the session agent and model and reports failures", async () => {
  const queryClient = createQueryClient();
  const sessionKey = openCodeQueryKeys.session("connection-1", location, "ses_a");
  queryClient.setQueryData(sessionKey, sessionInfo("ses_a"));
  mockSwitchModel.mockRejectedValueOnce(new Error("failed"));
  const hook = renderHook(() => useSessionExecution(executionOptions("ses_a")), {
    wrapper: queryWrapper(queryClient),
  });
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));
  const model = { id: "model", providerID: "provider" };

  act(() => hook.result.current.switchModel(model));
  await waitFor(() => expect(hook.result.current.error).toMatch(/model could not be changed/i));
  expect(mockSwitchModel.mock.calls[0]?.slice(1, 3)).toEqual(["ses_a", model]);

  act(() => hook.result.current.switchModel(model));
  await waitFor(() =>
    expect(queryClient.getQueryData<SessionInfo>(sessionKey)?.model).toEqual(model),
  );
  expect(hook.result.current.error).toBeUndefined();

  act(() => hook.result.current.switchAgent("plan"));
  await waitFor(() =>
    expect(queryClient.getQueryData<SessionInfo>(sessionKey)?.agent).toBe("plan"),
  );
  expect(mockSwitchAgent.mock.calls[0]?.slice(1, 3)).toEqual(["ses_a", "plan"]);
});

test("reports an execution control that fails", async () => {
  mockWait.mockRejectedValueOnce(new Error("failed"));
  const hook = renderExecutionHook();
  await waitFor(() => expect(hook.result.current.submitDisabled).toBe(false));

  act(() => hook.result.current.wait());

  await waitFor(() => expect(hook.result.current.error).toMatch(/execution control/i));
  await waitFor(() => expect(hook.result.current.busyAction).toBeUndefined());
});

test("keeps retry disabled when the recovery record cannot be removed", async () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(openCodeQueryKeys.promptAdmissions("connection-1", location, "ses_a"), [
    {
      durable: false,
      id: "msg_retry",
      kind: "prompt",
      retryOffered: true,
      status: "unknown-delivery",
      submittedAtMs: 1,
    },
    { durable: false, id: "msg_other", kind: "prompt", status: "submitting", submittedAtMs: 1 },
  ] satisfies PromptAdmission[]);
  const hook = renderHook(() => useSessionExecution(executionOptions("ses_a")), {
    wrapper: queryWrapper(queryClient),
  });
  await waitFor(() => expect(hook.result.current.admissions).toHaveLength(2));
  mockAdmissionDb.runAsync.mockRejectedValueOnce(new Error("storage unavailable"));

  act(() => hook.result.current.allowRetry("msg_retry"));
  await waitFor(() => expect(hook.result.current.error).toMatch(/Retry cannot be enabled/i));

  act(() => hook.result.current.allowRetry("msg_other"));
  expect(hook.result.current.admissions).toHaveLength(2);
});

test("exposes the agent and model catalogs and retries them on request", async () => {
  mockListAgents.mockResolvedValueOnce({
    data: [
      { hidden: false, id: "plan", mode: "primary", model: { id: "m", providerID: "p" } },
      { hidden: false, id: "explore", mode: "subagent" },
    ] as never,
    location,
  });
  mockListModels.mockResolvedValueOnce({
    data: [{ enabled: true, id: "m", providerID: "p", status: "active" }] as never,
    location,
  });
  const hook = renderHook(
    () => useSessionExecution({ ...executionOptions("ses_a"), session: undefined }),
    { wrapper: queryWrapper(createQueryClient()) },
  );

  await waitFor(() => expect(hook.result.current.selectedAgent).toBe("plan"));
  expect(hook.result.current.agents.map((agent) => agent.id)).toEqual(["plan"]);
  expect(hook.result.current.mentionAgents.map((agent) => agent.id)).toEqual(["explore"]);
  expect(hook.result.current.selectedModel).toEqual({ id: "m", providerID: "p" });
  await waitFor(() => expect(hook.result.current.models).toHaveLength(1));

  const agentLoads = mockListAgents.mock.calls.length;
  const modelLoads = mockListModels.mock.calls.length;
  act(() => {
    hook.result.current.agentCatalog.retry();
    hook.result.current.modelCatalog.retry();
  });
  await waitFor(() => expect(mockListAgents.mock.calls.length).toBeGreaterThan(agentLoads));
  await waitFor(() => expect(mockListModels.mock.calls.length).toBeGreaterThan(modelLoads));
});

test("ignores session actions while no client is connected", async () => {
  const hook = renderHook(
    () => useSessionExecution({ ...executionOptions("ses_a"), client: undefined }),
    { wrapper: queryWrapper(createQueryClient()) },
  );

  act(() => {
    hook.result.current.submit("Nothing");
    hook.result.current.switchAgent("plan");
    hook.result.current.switchModel({ id: "model", providerID: "provider" });
    hook.result.current.steerInbox("msg_queued");
    hook.result.current.wait();
    hook.result.current.reconcileAdmission("msg_missing");
  });

  expect(hook.result.current.submitDisabled).toBe(true);
  expect(hook.result.current.activeSessions).toBeUndefined();
  expect(hook.result.current.pendingPrompts).toEqual([]);
  expect(mockPrompt).not.toHaveBeenCalled();
  expect(mockSwitchAgent).not.toHaveBeenCalled();
  expect(mockSwitchModel).not.toHaveBeenCalled();
  expect(mockSteer).not.toHaveBeenCalled();
  expect(mockWait).not.toHaveBeenCalled();
  expect(mockListInbox).not.toHaveBeenCalled();
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
    time: { created: 1 },
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
