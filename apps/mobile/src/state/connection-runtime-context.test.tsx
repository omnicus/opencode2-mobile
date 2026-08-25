import { expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Text } from "react-native";

import {
  appendDiagnostic,
  ConnectionRuntimeProvider,
  formatDiagnostics,
  formatDiagnosticTimestamp,
  type RuntimeDiagnosticEntry,
  useConnectionRuntime,
} from "./connection-runtime-context";
import { openCodeQueryKeys } from "./open-code-query-keys";

const mockBoundedFetch = jest.fn();
const mockExpoFetch = jest.fn();
const mockReadCredential = jest.fn(async () => undefined);
const mockClients = new Map<string, ReturnType<typeof createClientPair>>();
const mockClientCalls = new Map<string, number>();
let mockSelectedProfileId = "connection-1";
let mockProfiles = [profile("connection-1", "https://first.test")];

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  classifyOpenCodeError: () => "UNREACHABLE",
  createOpenCodeClient: (options: { baseUrl: string }) => {
    const pair = mockClients.get(options.baseUrl);
    if (!pair) throw new Error("Missing test client");
    const count = mockClientCalls.get(options.baseUrl) ?? 0;
    mockClientCalls.set(options.baseUrl, count + 1);
    return count % 2 === 0 ? pair.rest : pair.event;
  },
}));

jest.mock("../connections/connections-context", () => ({
  useConnections: () => ({
    profiles: mockProfiles,
    readCredential: mockReadCredential,
    selectedProfileId: mockSelectedProfileId,
  }),
}));

jest.mock("../expo-open-code-fetch", () => ({
  boundedOpenCodeFetch: mockBoundedFetch,
  expoOpenCodeFetch: mockExpoFetch,
}));

jest.mock("./connection-cache-metadata", () => ({
  readConnectionCacheMetadata: async () => undefined,
  writeConnectionCacheMetadata: async () => undefined,
}));

jest.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: jest.fn() }),
  getNetworkStateAsync: async () => ({ isConnected: true }),
}));

test("aborts and ignores the old generation when switching connections", async () => {
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
  const first = createClientPair();
  const second = createClientPair();
  mockClients.set("https://first.test", first);
  mockClients.set("https://second.test", second);
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ConnectionRuntimeProvider>
        <RuntimeStatus />
      </ConnectionRuntimeProvider>
    </QueryClientProvider>,
  );
  await flush();
  expect(mockReadCredential).toHaveBeenCalled();
  expect(screen.getByText("connecting")).toBeOnTheScreen();
  expect(screen.getByText("connection-1:ready")).toBeOnTheScreen();
  await waitFor(() => expect(first.generations).toBe(1));

  mockProfiles = [
    profile("connection-1", "https://first.test"),
    profile("connection-2", "https://second.test"),
  ];
  mockSelectedProfileId = "connection-2";
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ConnectionRuntimeProvider>
        <RuntimeStatus />
      </ConnectionRuntimeProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText("connection-2:none")).toBeOnTheScreen();
  await flush();
  expect(screen.getByText("connection-2:ready")).toBeOnTheScreen();

  expect(first.aborted).toBe(1);
  first.resolveHealth();
  second.resolveHealth();
  await flush();

  expect(queryClient.getQueryData(openCodeQueryKeys.health("connection-1"))).toBeUndefined();
  expect(queryClient.getQueryData(openCodeQueryKeys.health("connection-2"))).toMatchObject({
    pid: 42,
    version: "test",
  });
  expect(screen.getByText("connected")).toBeOnTheScreen();

  mockSelectedProfileId = "connection-1";
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <ConnectionRuntimeProvider>
        <RuntimeStatus />
      </ConnectionRuntimeProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(first.generations).toBe(2));
  await flush();
  expect(second.aborted).toBe(1);
  expect(queryClient.getQueryData(openCodeQueryKeys.health("connection-1"))).toMatchObject({
    pid: 42,
  });

  view.unmount();
  queryClient.clear();
  mockClients.clear();
  mockClientCalls.clear();
});

test("formats diagnostic timestamps in local time with an explicit offset", () => {
  const atMs = Date.UTC(2026, 7, 23, 23, 11, 43, 719);
  const local = new Date(atMs);
  const expectedLocalTime = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(
    local.getDate(),
  )}T${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}.719`;

  expect(formatDiagnosticTimestamp(atMs)).toMatch(
    new RegExp(`^${expectedLocalTime}[+-]\\d{2}:\\d{2}$`),
  );
});

test("aggregates event bursts without evicting transport status history", () => {
  let diagnostics: RuntimeDiagnosticEntry[] = [
    { atMs: 1, kind: "status", value: "stale" },
    { atMs: 2, kind: "status", value: "offline" },
    { atMs: 3, kind: "status", value: "connecting" },
    { atMs: 4, kind: "status", value: "connected" },
  ];
  for (let index = 0; index < 70; index += 1) {
    diagnostics = appendDiagnostic(diagnostics, {
      atMs: 100 + index,
      kind: "event",
      value: "plugin.added",
    });
  }

  const formatted = formatDiagnostics("connected", diagnostics);
  expect(formatted).toContain("status=stale");
  expect(formatted).toContain("status=offline");
  expect(formatted).toContain("status=connecting");
  expect(formatted).toContain("status=connected");
  expect(formatted).toContain("event=plugin.added count=70");
  expect(diagnostics).toHaveLength(5);
});

function RuntimeStatus() {
  const runtime = useConnectionRuntime();
  return (
    <>
      <Text>{runtime.status}</Text>
      <Text>
        {runtime.connectionId}:{runtime.restClient ? "ready" : "none"}
      </Text>
    </>
  );
}

function createClientPair() {
  let aborted = 0;
  let generations = 0;
  let resolveHealth:
    | ((health: { healthy: true; pid: number; version: string }) => void)
    | undefined;
  const health = new Promise<{ healthy: true; pid: number; version: string }>((resolve) => {
    resolveHealth = resolve;
  });
  const event = {
    event: {
      subscribe(options?: { signal?: AbortSignal }) {
        generations += 1;
        options?.signal?.addEventListener(
          "abort",
          () => {
            aborted += 1;
          },
          { once: true },
        );
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise<IteratorResult<never>>(() => undefined),
            };
          },
        };
      },
    },
  };
  const rest = {
    health: { get: jest.fn(() => health) },
    project: { list: jest.fn(async () => []) },
    session: { active: jest.fn(async () => ({})) },
  };
  return {
    get aborted() {
      return aborted;
    },
    event,
    get generations() {
      return generations;
    },
    resolveHealth() {
      resolveHealth?.({ healthy: true, pid: 42, version: "test" });
    },
    rest,
  };
}

function profile(id: string, baseUrl: string) {
  return {
    allowDevelopmentHttp: false,
    authMode: "none" as const,
    baseUrl,
    createdAtMs: 1,
    id,
    name: id,
    schemaVersion: 1 as const,
    updatedAtMs: 1,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
