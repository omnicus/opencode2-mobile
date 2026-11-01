import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { prepareAppReload } from "../updates/prepare-app-reload";

import { useSessionDraft } from "./use-session-draft";

const mockDeleteDraft = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockReadDraft = jest.fn<
  (...args: unknown[]) => Promise<
    | {
        content: string;
        mentions: Array<{
          id: string;
          mention: { end: number; start: number; text: string };
          type: "skill";
        }>;
        revision: number;
        updatedAtMs: number;
      }
    | undefined
  >
>(async () => undefined);
const mockWriteDraft = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockDatabase = {};

jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDatabase }));
jest.mock("../storage/draft-repository", () => ({
  deleteSessionDraft: (...args: unknown[]) => mockDeleteDraft(...args),
  readSessionDraft: (...args: unknown[]) => mockReadDraft(...args),
  writeSessionDraft: (...args: unknown[]) => mockWriteDraft(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockReadDraft.mockResolvedValue(undefined);
  mockWriteDraft.mockResolvedValue(undefined);
});

test("flushes a just-edited draft before an app update without waiting for the debounce", async () => {
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setDraft("Keep this draft"));
  await act(async () => {
    await prepareAppReload();
  });
  expect(mockWriteDraft).toHaveBeenCalledWith(
    mockDatabase,
    expect.objectContaining({ content: "Keep this draft" }),
  );
});

test("blocks an app update when the current draft cannot be saved", async () => {
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setDraft("Keep this draft"));
  mockWriteDraft.mockRejectedValueOnce(new Error("database unavailable"));
  await act(async () => {
    await expect(prepareAppReload()).rejects.toThrow("database unavailable");
  });
  expect(hook.result.current.draft).toBe("Keep this draft");
});

test("does not overwrite an unreadable draft when preparing an update", async () => {
  mockReadDraft.mockRejectedValueOnce(new Error("key unavailable"));
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await act(async () => {
    await prepareAppReload();
  });
  expect(mockWriteDraft).not.toHaveBeenCalled();
  expect(mockDeleteDraft).not.toHaveBeenCalled();
});

test("retries a failed debounced save before applying an app update", async () => {
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  mockWriteDraft.mockRejectedValueOnce(new Error("temporary write failure"));
  act(() => hook.result.current.setDraft("Still needs saving"));
  await waitFor(() => expect(hook.result.current.error).toBeDefined());
  await act(async () => {
    await prepareAppReload();
  });
  expect(mockWriteDraft).toHaveBeenCalledTimes(2);
  expect(hook.result.current.error).toBeUndefined();
});

test("does not clear text edited after the submitted draft revision", async () => {
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));

  act(() => hook.result.current.setDraft("Submitted"));
  const submittedRevision = hook.result.current.revision;
  act(() => hook.result.current.setDraft("Next turn"));
  act(() => hook.result.current.clearDraft(submittedRevision));

  expect(hook.result.current.draft).toBe("Next turn");
  expect(mockDeleteDraft).not.toHaveBeenCalled();

  act(() => hook.result.current.clearDraft(hook.result.current.revision));
  await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalledTimes(1));
  expect(hook.result.current.draft).toBe("");
});

test("restores a durable revision and structured mentions", async () => {
  const mentions = [
    {
      id: "release",
      mention: { end: 8, start: 0, text: "@release" },
      type: "skill" as const,
    },
  ];
  mockReadDraft.mockResolvedValueOnce({
    content: "@release Submitted",
    mentions,
    revision: 7,
    updatedAtMs: 10,
  });
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));

  expect(hook.result.current.revision).toBe(7);
  expect(hook.result.current.mentions).toEqual(mentions);
  act(() => hook.result.current.clearDraft(7));

  await waitFor(() =>
    expect(mockDeleteDraft).toHaveBeenCalledWith(mockDatabase, "connection-1", "ses_a"),
  );
  expect(hook.result.current.draft).toBe("");
  expect(hook.result.current.mentions).toEqual([]);
});

test("writes mention metadata with the encrypted draft", async () => {
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  const mentions = [
    {
      id: "release",
      mention: { end: 8, start: 0, text: "@release" },
      type: "skill" as const,
    },
  ];

  act(() => hook.result.current.setDraft("@release ", mentions));
  await act(async () => {
    await hook.result.current.persistDraft("@release ", hook.result.current.revision);
  });

  expect(mockWriteDraft).toHaveBeenCalledWith(
    mockDatabase,
    expect.objectContaining({ content: "@release ", mentions }),
  );
});

test("a late confirmation only clears the draft scope that submitted it", async () => {
  const hook = renderHook(
    ({ sessionId }: { sessionId: string }) => useSessionDraft("connection-1", sessionId),
    { initialProps: { sessionId: "ses_a" } },
  );
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setDraft("Session A"));
  const clearSessionA = hook.result.current.clearDraft;
  const sessionARevision = hook.result.current.revision;

  hook.rerender({ sessionId: "ses_b" });
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setDraft("Session B"));
  act(() => clearSessionA(sessionARevision));

  await waitFor(() =>
    expect(mockDeleteDraft).toHaveBeenCalledWith(mockDatabase, "connection-1", "ses_a"),
  );
  expect(hook.result.current.draft).toBe("Session B");
});

test("serializes confirmation deletion after the submitted draft write", async () => {
  let finishWrite: (() => void) | undefined;
  mockWriteDraft.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
  );
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setDraft("Submitted"));
  const submittedRevision = hook.result.current.revision;
  let persistence: Promise<void> | undefined;
  act(() => {
    persistence = hook.result.current.persistDraft("Submitted", submittedRevision);
  });
  await waitFor(() => expect(mockWriteDraft).toHaveBeenCalledTimes(1));

  act(() => hook.result.current.clearDraft(submittedRevision));
  expect(mockDeleteDraft).not.toHaveBeenCalled();
  await act(async () => {
    finishWrite?.();
    await persistence;
  });

  await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalledTimes(1));
});

test("does not show an old scope write failure on the next session", async () => {
  let failWrite: ((error: Error) => void) | undefined;
  mockWriteDraft.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        failWrite = reject;
      }),
  );
  const hook = renderHook(
    ({ sessionId }: { sessionId: string }) => useSessionDraft("connection-1", sessionId),
    { initialProps: { sessionId: "ses_a" } },
  );
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setDraft("Session A"));
  let persistence: Promise<void> | undefined;
  act(() => {
    persistence = hook.result.current.persistDraft("Session A", hook.result.current.revision);
  });
  await waitFor(() => expect(mockWriteDraft).toHaveBeenCalledTimes(1));

  hook.rerender({ sessionId: "ses_b" });
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await act(async () => {
    failWrite?.(new Error("failed"));
    await persistence?.catch(() => undefined);
  });

  expect(hook.result.current.error).toBeUndefined();
});

test("debounces draft writes and flushes immediately when the app leaves the foreground", async () => {
  jest.useFakeTimers();
  try {
    const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => hook.result.current.setDraft("First"));
    act(() => hook.result.current.setDraft("Second"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(399);
    });
    expect(mockWriteDraft).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(mockWriteDraft).toHaveBeenCalledTimes(1);
    expect(mockWriteDraft).toHaveBeenLastCalledWith(
      mockDatabase,
      expect.objectContaining({ content: "Second", revision: 2 }),
    );

    act(() => hook.result.current.setDraft("Third"));
    const onChange = jest.mocked(AppState.addEventListener).mock.calls.at(-1)?.[1] as
      | ((state: AppStateStatus) => void)
      | undefined;
    await act(async () => {
      onChange?.("active");
    });
    expect(mockWriteDraft).toHaveBeenCalledTimes(1);
    await act(async () => {
      onChange?.("background");
    });
    expect(mockWriteDraft).toHaveBeenCalledTimes(2);
    expect(mockWriteDraft).toHaveBeenLastCalledWith(
      mockDatabase,
      expect.objectContaining({ content: "Third", revision: 3 }),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(mockWriteDraft).toHaveBeenCalledTimes(2);
    hook.unmount();
  } finally {
    jest.useRealTimers();
  }
});

test("keeps text typed before the saved draft finishes loading", async () => {
  let finishRead: ((value: undefined) => void) | undefined;
  mockReadDraft.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  act(() => hook.result.current.setDraft("Typed early"));
  await act(async () => {
    finishRead?.(undefined);
  });
  expect(hook.result.current.loaded).toBe(true);
  expect(hook.result.current.draft).toBe("Typed early");
  expect(hook.result.current.revision).toBe(1);
});

test("ignores a draft read that settles after the hook unmounts", async () => {
  let failRead: ((error: Error) => void) | undefined;
  mockReadDraft.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failRead = reject;
      }),
  );
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  hook.unmount();
  await act(async () => {
    failRead?.(new Error("late"));
  });
  expect(hook.result.current.error).toBeUndefined();
  expect(hook.result.current.loaded).toBe(false);
  expect(mockWriteDraft).not.toHaveBeenCalled();
  expect(mockDeleteDraft).not.toHaveBeenCalled();
});

test("refuses to send a draft that changed after its revision was captured", async () => {
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setDraft("Submitted"));
  const revision = hook.result.current.revision;

  await expect(hook.result.current.persistDraft("Other text", revision)).rejects.toThrow(
    "DRAFT_CHANGED_BEFORE_SEND",
  );
  await expect(hook.result.current.persistDraft("Submitted", revision - 1)).rejects.toThrow(
    "DRAFT_CHANGED_BEFORE_SEND",
  );
  expect(mockWriteDraft).not.toHaveBeenCalled();
});

test("persists a draft whose debounced write already ran", async () => {
  jest.useFakeTimers();
  try {
    const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => hook.result.current.setDraft("Saved"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });
    expect(mockWriteDraft).toHaveBeenCalledTimes(1);
    await act(async () => {
      await hook.result.current.persistDraft("Saved", hook.result.current.revision);
    });
    expect(mockWriteDraft).toHaveBeenCalledTimes(2);
    expect(mockWriteDraft).toHaveBeenLastCalledWith(
      mockDatabase,
      expect.objectContaining({ content: "Saved", revision: 1 }),
    );
    hook.unmount();
  } finally {
    jest.useRealTimers();
  }
});

test("blocks an app update when the draft changes while it is being saved", async () => {
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setDraft("Before update"));
  let finishWrite: (() => void) | undefined;
  mockWriteDraft.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
  );
  let reload: Promise<void> | undefined;
  act(() => {
    reload = prepareAppReload();
  });
  await waitFor(() => expect(mockWriteDraft).toHaveBeenCalledTimes(1));
  act(() => hook.result.current.setDraft("Edited during update"));
  await act(async () => {
    finishWrite?.();
    await expect(reload).rejects.toThrow("DRAFT_CHANGED_BEFORE_RELOAD");
  });
  hook.unmount();
});
