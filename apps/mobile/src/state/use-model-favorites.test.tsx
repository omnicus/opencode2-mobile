import { expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { ModelIdentity } from "../storage/model-favorites-repository";
import { useModelFavorites } from "./use-model-favorites";

const mockRead = jest.fn<(db: unknown, connectionID: string) => Promise<ModelIdentity[]>>();
const mockWrite = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => ({}) }));
jest.mock("../storage/model-favorites-repository", () => ({
  readModelFavorites: (...args: Parameters<typeof mockRead>) => mockRead(...args),
  setModelFavorite: (...args: unknown[]) => mockWrite(...args),
}));

test("a late favorite write cannot cross into a newly selected connection", async () => {
  mockRead.mockImplementation(async (_db, connectionID) => [{ providerID: "p", id: connectionID }]);
  let finish!: () => void;
  mockWrite.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ connectionID }: { connectionID: string }) => useModelFavorites(connectionID, 7),
    {
      wrapper,
      initialProps: { connectionID: "a" },
    },
  );
  await waitFor(() => expect(view.result.current.models).toEqual([{ providerID: "p", id: "a" }]));
  act(() => view.result.current.toggle({ providerID: "p", id: "favorite" }, true));
  await waitFor(() =>
    expect(mockWrite).toHaveBeenCalledWith(
      expect.anything(),
      "a",
      7,
      { providerID: "p", id: "favorite" },
      true,
    ),
  );
  view.rerender({ connectionID: "b" });
  await waitFor(() => expect(view.result.current.models).toEqual([{ providerID: "p", id: "b" }]));
  await act(async () => finish());
  await waitFor(() => expect(view.result.current.disabled).toBe(false));
  expect(view.result.current.models).toEqual([{ providerID: "p", id: "b" }]);
  view.unmount();
  client.clear();
});

test("failed saves retain the loaded favorites and expose retry", async () => {
  mockRead.mockResolvedValue([{ providerID: "p", id: "existing" }]);
  mockWrite.mockRejectedValue(new Error("write failed"));
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useModelFavorites("a", 7), { wrapper });
  await waitFor(() => expect(view.result.current.disabled).toBe(false));
  act(() => view.result.current.toggle({ providerID: "p", id: "existing" }, false));
  await waitFor(() => expect(view.result.current.error).toBe(true));
  expect(view.result.current.models).toEqual([{ providerID: "p", id: "existing" }]);
  act(() => view.result.current.retry());
  await waitFor(() => expect(view.result.current.error).toBe(false));
  view.unmount();
  client.clear();
});
