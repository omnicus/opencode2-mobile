import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import {
  getOpenCodeShell,
  getOpenCodeShellOutput,
  type OpenCodeClient,
  type ShellGetOutput,
  type ShellOutputOutput,
} from "@opencode2-mobile/opencode-adapter";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { SessionShellScope, ShellObservation } from "./session-shell-output";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  getOpenCodeShell: jest.fn(),
  getOpenCodeShellOutput: jest.fn(),
  isShellNotFoundError: (error: unknown) =>
    (error as { _tag?: string })?._tag === "ShellNotFoundError",
  maxShellOutputBytes: 65536,
}));

const getShell = jest.mocked(getOpenCodeShell);
const getOutput = jest.mocked(getOpenCodeShellOutput);
const location = { directory: "/workspace" };
const info: ShellGetOutput = {
  location,
  data: {
    id: "sh_test",
    status: "running",
    command: "build",
    cwd: "/workspace",
    shell: "sh",
    file: "/output",
    metadata: {},
    time: { started: 1 },
  },
};
const clients: QueryClient[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  getShell.mockReset().mockResolvedValue(info);
  getOutput.mockReset().mockResolvedValue(page("one", 3));
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

function page(output: string, cursor: number, size = cursor): ShellOutputOutput {
  return { location, data: { output, cursor, size, truncated: false } };
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queryClient);
  const tree = (connectionId = "connection-1", directory = "/workspace", enabled = true) => (
    <QueryClientProvider client={queryClient}>
      <SessionShellScope.Provider
        value={{ connectionId, location: { directory }, client: {} as OpenCodeClient, enabled }}
      >
        <ShellObservation shellID="sh_test">
          {(result) => (
            <>
              <Text>{result?.snapshot?.output ?? "loading"}</Text>
              <Text>
                {result?.error
                  ? "unavailable"
                  : result?.snapshot?.missing
                    ? "missing"
                    : result?.snapshot?.info?.status}
              </Text>
              <Text>{result?.snapshot?.truncated ? "truncated" : "complete buffer"}</Text>
            </>
          )}
        </ShellObservation>
      </SessionShellScope.Provider>
    </QueryClientProvider>
  );
  return { ...render(tree()), tree, queryClient };
}

async function tick(ms = 1000) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

test("follows byte cursors without session activity and stops after fetching final output", async () => {
  const view = setup();
  await screen.findByText("one");
  getOutput.mockResolvedValue(page(" two", 7));
  await tick();
  expect(screen.getByText("one two")).toBeOnTheScreen();
  expect(getOutput).toHaveBeenLastCalledWith(
    expect.anything(),
    location,
    "sh_test",
    expect.objectContaining({ cursor: 3 }),
  );
  getShell.mockResolvedValue({ ...info, data: { ...info.data, status: "exited", exit: 0 } });
  getOutput.mockResolvedValue(page(" done", 12));
  await tick();
  expect(screen.getByText("one two done")).toBeOnTheScreen();
  expect(screen.getByText("exited")).toBeOnTheScreen();
  const calls = getOutput.mock.calls.length;
  await tick(5000);
  expect(getOutput).toHaveBeenCalledTimes(calls);
  view.unmount();
});

test("pauses offscreen, offline and in the native background, then reconciles on return", async () => {
  const view = setup();
  await screen.findByText("one");
  getOutput.mockResolvedValue(page(" two", 7));
  act(() => focusManager.setFocused(false));
  await tick(3000);
  expect(getOutput).toHaveBeenCalledTimes(1);
  act(() => {
    onlineManager.setOnline(false);
    focusManager.setFocused(true);
  });
  await tick(3000);
  expect(getOutput).toHaveBeenCalledTimes(1);
  act(() => onlineManager.setOnline(true));
  await tick(0);
  expect(await screen.findByText("one two")).toBeOnTheScreen();
  view.rerender(view.tree("connection-1", "/workspace", false));
  const calls = getOutput.mock.calls.length;
  await tick(3000);
  expect(getOutput).toHaveBeenCalledTimes(calls);
  getOutput.mockResolvedValue(page(" done", 12));
  view.rerender(view.tree());
  expect(await screen.findByText("one two done")).toBeOnTheScreen();
  view.unmount();
});

test("jumps to a bounded recent tail instead of downloading an entire large log", async () => {
  getOutput
    .mockResolvedValueOnce(page("x".repeat(65536), 65536, 1_000_000))
    .mockResolvedValueOnce(page("tail", 1_000_000));
  const view = setup();
  expect(await screen.findByText("tail")).toBeOnTheScreen();
  expect(screen.getByText("truncated")).toBeOnTheScreen();
  expect(getOutput).toHaveBeenCalledTimes(2);
  expect(getOutput).toHaveBeenLastCalledWith(
    expect.anything(),
    location,
    "sh_test",
    expect.objectContaining({ cursor: 1_000_000 - 65536 }),
  );
  view.unmount();
});

test("retains observed output and stops polling when the server has removed the shell", async () => {
  const view = setup();
  await screen.findByText("one");
  getShell.mockRejectedValue({ _tag: "ShellNotFoundError" });
  await tick();
  expect(screen.getByText("one")).toBeOnTheScreen();
  expect(screen.getByText("missing")).toBeOnTheScreen();
  const calls = getShell.mock.calls.length;
  await tick(5000);
  expect(getShell).toHaveBeenCalledTimes(calls);
  view.unmount();
});

test("bounds accumulated multibyte output without cutting a character in half", async () => {
  getOutput
    .mockResolvedValueOnce(page("ø".repeat(20000), 40000))
    .mockResolvedValueOnce(page("ø".repeat(20000), 80000));
  const view = setup();
  await screen.findByText("ø".repeat(20000));
  await tick();
  expect(screen.getByText("ø".repeat(32768))).toBeOnTheScreen();
  expect(screen.getByText("truncated")).toBeOnTheScreen();
  view.unmount();
});

test("keeps previous output on transport errors and recovers on reconciliation", async () => {
  const view = setup();
  await screen.findByText("one");
  getShell.mockRejectedValue(new Error("Offline"));
  await tick(3000);
  expect(screen.getByText("one")).toBeOnTheScreen();
  expect(screen.getByText("unavailable")).toBeOnTheScreen();
  const calls = getShell.mock.calls.length;
  await tick(3000);
  expect(getShell).toHaveBeenCalledTimes(calls);
  getShell.mockResolvedValue({ ...info, data: { ...info.data, status: "exited" } });
  getOutput.mockResolvedValue(page(" done", 8));
  await act(async () => {
    await view.queryClient.invalidateQueries();
  });
  expect(await screen.findByText("one done")).toBeOnTheScreen();
  view.unmount();
});

test.each(["connection", "location"])(
  "isolates late shell output after a %s change",
  async (change) => {
    let resolve: ((value: ShellOutputOutput) => void) | undefined;
    getOutput.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = setup();
    await tick(0);
    const signal = getOutput.mock.calls[0]?.[3]?.signal;
    getOutput.mockResolvedValue(page("new scope", 9));
    view.rerender(
      view.tree(
        change === "connection" ? "connection-2" : "connection-1",
        change === "location" ? "/other" : "/workspace",
      ),
    );
    expect(await screen.findByText("new scope")).toBeOnTheScreen();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolve?.(page("old scope", 9));
    });
    expect(screen.queryByText("old scope")).toBeNull();
    expect(getOutput.mock.calls.at(-1)?.[3]?.cursor).toBe(0);
    view.unmount();
  },
);
