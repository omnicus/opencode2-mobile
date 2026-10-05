import { expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import {
  readSessionArchivePreferences,
  setSessionArchived,
} from "../storage/session-archive-repository";
import { useSessionArchives } from "./use-session-archives";

jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => ({}) }));
jest.mock("../storage/session-archive-repository", () => ({
  readSessionArchivePreferences: jest.fn(async () => ({ ids: [], restoredAt: {} })),
  setSessionArchived: jest.fn(async () => undefined),
}));

test("a pending archive cannot change the next connection's inbox and duplicate taps are ignored", async () => {
  let resolveWrite: (() => void) | undefined;
  jest.mocked(setSessionArchived).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
  );
  jest.mocked(readSessionArchivePreferences).mockImplementation(async (_db, connectionId) => ({
    ids: connectionId === "a" && resolveWrite ? ["ses_a"] : [],
    restoredAt: {},
  }));
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ id }: { id: string }) => useSessionArchives(id, 7), {
    initialProps: { id: "a" },
    wrapper,
  });
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  let write: Promise<void> | undefined;
  act(() => {
    write = hook.result.current.setArchived("ses_a", true);
  });
  await act(async () => {
    await hook.result.current.setArchived("ses_a", true);
  });
  expect(setSessionArchived).toHaveBeenCalledTimes(1);
  hook.rerender({ id: "b" });
  await waitFor(() => expect(hook.result.current.ids).toEqual([]));
  await act(async () => {
    resolveWrite?.();
    await write;
  });
  expect(hook.result.current.ids).toEqual([]);
  expect(queryClient.getQueryData(["device-session-archives", "a", 7])).toEqual({
    ids: ["ses_a"],
    restoredAt: {},
  });
  expect(queryClient.getQueryData(["device-session-archives", "b", 7])).toEqual({
    ids: [],
    restoredAt: {},
  });
  hook.unmount();
  queryClient.clear();
});
