import { expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { PullRequestFilter } from "../storage/pull-request-filter-repository";
import { usePullRequestFilter } from "./use-pull-request-filter";

const mockRead = jest.fn<(db: unknown, connectionID: string) => Promise<PullRequestFilter>>();
const mockWrite = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => ({}) }));
jest.mock("../storage/pull-request-filter-repository", () => ({
  defaultPullRequestFilter: { status: "all" },
  readPullRequestFilter: (...args: Parameters<typeof mockRead>) => mockRead(...args),
  writePullRequestFilter: (...args: unknown[]) => mockWrite(...args),
}));

function renderFilter(connectionID: string | undefined, updatedAt: number | undefined) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => usePullRequestFilter(connectionID, updatedAt), { wrapper });
  return {
    view,
    cleanup() {
      view.unmount();
      client.clear();
    },
  };
}

test("loads the saved filter and applies a change before the write finishes", async () => {
  mockRead.mockResolvedValue({ projectID: "project-1", status: "draft" });
  let finish!: () => void;
  mockWrite.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { view, cleanup } = renderFilter("a", 7);
  try {
    expect(view.result.current.loaded).toBe(false);
    await waitFor(() => expect(view.result.current.loaded).toBe(true));
    expect(view.result.current.filter).toEqual({ projectID: "project-1", status: "draft" });
    act(() => view.result.current.setFilter({ status: "approved" }));
    await waitFor(() => expect(view.result.current.filter).toEqual({ status: "approved" }));
    expect(mockWrite).toHaveBeenCalledWith(expect.anything(), "a", 7, { status: "approved" });
    await act(async () => finish());
    expect(view.result.current.filter).toEqual({ status: "approved" });
    expect(view.result.current.error).toBe(false);
  } finally {
    cleanup();
  }
});

test("a failed save restores the stored filter and reports the error", async () => {
  mockRead.mockResolvedValue({ status: "ready" });
  mockWrite.mockRejectedValue(new Error("write failed"));
  const { view, cleanup } = renderFilter("a", 7);
  try {
    await waitFor(() => expect(view.result.current.loaded).toBe(true));
    act(() => view.result.current.setFilter({ status: "draft" }));
    await waitFor(() => expect(view.result.current.error).toBe(true));
    expect(view.result.current.filter).toEqual({ status: "ready" });
  } finally {
    cleanup();
  }
});

test("without a selected connection the filter stays at the default and ignores changes", () => {
  mockWrite.mockClear();
  const { view, cleanup } = renderFilter(undefined, undefined);
  try {
    expect(view.result.current.filter).toEqual({ status: "all" });
    act(() => view.result.current.setFilter({ status: "draft" }));
    expect(mockWrite).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});
