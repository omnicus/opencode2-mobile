import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { useSessionDraft } from "./use-session-draft";

const mockDeleteDraft = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
const mockReadDraft = jest.fn<
  (
    ...args: unknown[]
  ) => Promise<{ content: string; revision: number; updatedAtMs: number } | undefined>
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

test("restores a durable revision and clears that exact submitted draft", async () => {
  mockReadDraft.mockResolvedValueOnce({ content: "Submitted", revision: 7, updatedAtMs: 10 });
  const hook = renderHook(() => useSessionDraft("connection-1", "ses_a"));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));

  expect(hook.result.current.revision).toBe(7);
  act(() => hook.result.current.clearDraft(7));

  await waitFor(() =>
    expect(mockDeleteDraft).toHaveBeenCalledWith(mockDatabase, "connection-1", "ses_a"),
  );
  expect(hook.result.current.draft).toBe("");
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
