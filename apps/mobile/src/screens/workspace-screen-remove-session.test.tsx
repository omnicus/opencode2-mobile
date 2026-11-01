import { afterEach, expect, jest, test } from "@jest/globals";
import {
  type OpenCodeClient,
  removeOpenCodeSession,
  type SessionInfo,
} from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import type { SQLiteDatabase } from "expo-sqlite";
import type { ReactNode } from "react";
import { Alert } from "react-native";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { deleteSessionLocalState } from "../storage/prompt-admission-repository";
import { loadOpenCodeSessionTreeIds } from "./session-deletion";
import { useRemoveSessionMutation } from "./workspace-screen-remove-session";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  removeOpenCodeSession: jest.fn(async () => undefined),
}));
jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Warning: "warning" },
  notificationAsync: jest.fn(async () => undefined),
}));
jest.mock("../storage/prompt-admission-repository", () => ({
  deleteSessionLocalState: jest.fn(async () => undefined),
}));
jest.mock("./session-deletion", () => ({
  loadOpenCodeSessionTreeIds: jest.fn(async () => ["ses_parent", "ses_child"]),
}));

const client = {} as OpenCodeClient;
const db = {} as SQLiteDatabase;
const location = { directory: "/workspace" };
const session = {
  cost: 0,
  id: "ses_parent",
  location,
  projectID: "project-1",
  time: { created: 1, updated: 1 },
  title: "Parent",
  tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
} as SessionInfo;

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

test("deletes the session tree, clears its cached queries, and confirms with haptics", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const { queryClient, result, removeAbortRef } = renderRemoval();
  for (const sessionID of ["ses_parent", "ses_child"]) {
    queryClient.setQueryData(openCodeQueryKeys.session("connection-1", location, sessionID), {});
    queryClient.setQueryData(
      openCodeQueryKeys.promptAdmissions("connection-1", location, sessionID),
      [],
    );
  }
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");

  await act(async () => {
    await result.current.mutateAsync(session);
    await settleNotifications();
  });

  expect(loadOpenCodeSessionTreeIds).toHaveBeenCalledWith(
    client,
    location,
    "ses_parent",
    expect.any(AbortSignal),
  );
  expect(removeOpenCodeSession).toHaveBeenCalledWith(client, "ses_parent", {
    signal: expect.any(AbortSignal),
  });
  expect(deleteSessionLocalState).toHaveBeenCalledWith(db, "connection-1", [
    "ses_parent",
    "ses_child",
  ]);
  expect(
    queryClient.getQueryData(openCodeQueryKeys.session("connection-1", location, "ses_child")),
  ).toBeUndefined();
  expect(
    queryClient.getQueryData(
      openCodeQueryKeys.promptAdmissions("connection-1", location, "ses_parent"),
    ),
  ).toBeUndefined();
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: openCodeQueryKeys.connection("connection-1"),
  });
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning");
  expect(alert).not.toHaveBeenCalled();
  expect(removeAbortRef.current).toBeNull();
});

test("warns when the server deleted the session but local cleanup failed", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  jest.mocked(deleteSessionLocalState).mockRejectedValueOnce(new Error("locked"));
  const { result } = renderRemoval();

  await act(async () => {
    await result.current.mutateAsync(session);
    await settleNotifications();
  });

  expect(alert).toHaveBeenCalledWith(
    "Local cleanup incomplete",
    "The server deleted the session, but encrypted local state could not be removed. Removing this connection profile will clear it.",
  );
});

test("reports a failed delete and keeps the session", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  jest.mocked(removeOpenCodeSession).mockRejectedValueOnce(new Error("UNREACHABLE"));
  const { result } = renderRemoval();

  await act(async () => {
    await expect(result.current.mutateAsync(session)).rejects.toThrow("UNREACHABLE");
    await settleNotifications();
  });

  expect(alert).toHaveBeenCalledWith(
    "Delete failed",
    "The session is still present. Refresh and try again.",
  );
  expect(deleteSessionLocalState).not.toHaveBeenCalled();
});

test("a newer delete aborts the previous one without an alert", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  jest.mocked(loadOpenCodeSessionTreeIds).mockImplementationOnce(
    (_client, _location, _sessionID, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const { result } = renderRemoval();

  let first: Promise<unknown> | undefined;
  await act(async () => {
    first = result.current.mutateAsync(session).catch((error: unknown) => error);
    await settleNotifications();
  });
  expect(loadOpenCodeSessionTreeIds).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.mutateAsync({ ...session, id: "ses_other" });
    await settleNotifications();
  });

  expect(await first).toEqual(new Error("REQUEST_ABORTED"));
  expect(alert).not.toHaveBeenCalled();
  expect(removeOpenCodeSession).toHaveBeenCalledTimes(1);
  expect(removeOpenCodeSession).toHaveBeenCalledWith(client, "ses_other", expect.anything());
});

test("refuses to delete before the connection is ready", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const { result } = renderRemoval({ connectionId: undefined });

  await act(async () => {
    await expect(result.current.mutateAsync(session)).rejects.toThrow("CONNECTION_NOT_READY");
    await settleNotifications();
  });

  expect(loadOpenCodeSessionTreeIds).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    "Delete failed",
    "The session is still present. Refresh and try again.",
  );
});

test("skips cache cleanup when the connection closes before the delete settles", async () => {
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  let finishRemoval = () => {};
  jest.mocked(removeOpenCodeSession).mockImplementationOnce(
    () =>
      new Promise<undefined>((resolve) => {
        finishRemoval = () => resolve(undefined);
      }),
  );
  const { queryClient, rerender, result } = renderRemoval();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");

  let removal: Promise<unknown> | undefined;
  await act(async () => {
    removal = result.current.mutateAsync(session);
    await settleNotifications();
  });
  expect(removeOpenCodeSession).toHaveBeenCalled();
  rerender({ connectionId: undefined });
  await act(async () => {
    finishRemoval();
    await removal;
  });

  expect(invalidate).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

// React Query defers observer notifications to a zero-delay timer.
function settleNotifications() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function renderRemoval(
  initial: { connectionId: string | undefined } = { connectionId: "connection-1" },
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { gcTime: Infinity },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const removeAbortRef = { current: null as AbortController | null };
  const hook = renderHook(
    ({ connectionId }: { connectionId: string | undefined }) =>
      useRemoveSessionMutation({ client, connectionId, db, queryClient, removeAbortRef }),
    {
      initialProps: initial,
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
  return { ...hook, queryClient, removeAbortRef };
}
