import { expect, jest, test } from "@jest/globals";
import type { LocationRef } from "@opencode2-mobile/opencode-adapter";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus, type NativeEventSubscription, Text } from "react-native";

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
const mockReadCacheMetadata = jest.fn(async (..._args: unknown[]): Promise<unknown> => undefined);
let mockNetworkListener: ((network: { isConnected?: boolean }) => void) | undefined;
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
  openCodeClientContractVersion: "test-contract",
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
  readConnectionCacheMetadata: (...args: unknown[]) => mockReadCacheMetadata(...args),
  writeConnectionCacheMetadata: async () => undefined,
}));

jest.mock("expo-network", () => ({
  addNetworkStateListener: (listener: (network: { isConnected?: boolean }) => void) => {
    mockNetworkListener = listener;
    return { remove: jest.fn() };
  },
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
  expect(screen.getByTestId("runtime-diagnostics").props.children).toContain(
    "generation_starts=1\ndurable_sequence_gaps=0\nsnapshot_requests=1\nsnapshots_installed=1",
  );
  expect(screen.getByTestId("runtime-diagnostics").props.children).toContain("generation=startup");

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

test("bounds diagnostic kinds independently and formats redacted transport metadata", () => {
  let diagnostics: RuntimeDiagnosticEntry[] = [
    { atMs: 1, kind: "event", value: "session.updated" },
  ];
  for (let index = 0; index < 70; index += 1) {
    diagnostics = appendDiagnostic(diagnostics, {
      atMs: 300 + index,
      kind: "event",
      value: `event.${index}`,
    });
    diagnostics = appendDiagnostic(diagnostics, {
      atMs: 100 + index,
      kind: "status",
      value: index % 2 === 0 ? "connecting" : "connected",
    });
    diagnostics = appendDiagnostic(diagnostics, {
      atMs: 200 + index,
      kind: "generation",
      value: "durable_gap",
    });
  }

  expect(diagnostics.filter((entry) => entry.kind === "event")).toHaveLength(64);
  expect(diagnostics.filter((entry) => entry.kind === "status")).toHaveLength(64);
  expect(diagnostics.filter((entry) => entry.kind === "generation")).toHaveLength(64);
  expect(
    formatDiagnostics("connected", diagnostics, {
      appBuild: "7",
      appVersion: "0.1.4",
      clientContractVersion: "0.0.0-beta-18387",
      metrics: {
        durableSequenceGaps: 12,
        generationStarts: 14,
        snapshotRequests: 14,
        snapshotsInstalled: 10,
      },
      serverVersion: "unsafe\nvalue",
    }),
  ).toContain(
    "app_version=0.1.4\napp_build=7\nclient_contract=0.0.0-beta-18387\nserver_version=unknown\ngeneration_starts=14\ndurable_sequence_gaps=12\nsnapshot_requests=14\nsnapshots_installed=10",
  );
});

test("resets to idle without a selected connection", async () => {
  mockReadCredential.mockClear();
  mockProfiles = [profile("connection-1", "https://first.test")];
  mockSelectedProfileId = "missing";
  const queryClient = new QueryClient();
  const view = renderRuntime(queryClient);
  await flush();

  expect(screen.getByText("idle")).toBeOnTheScreen();
  expect(screen.getByText(":none")).toBeOnTheScreen();
  expect(screen.getByTestId("runtime-diagnostics").props.children).toContain("current_status=idle");
  expect(mockReadCredential).not.toHaveBeenCalled();

  view.unmount();
  queryClient.clear();
});

test("reports unauthorized when the credential cannot be read", async () => {
  mockReadCredential.mockRejectedValueOnce(new Error("LOCKED"));
  mockProfiles = [profile("connection-1", "https://first.test")];
  mockSelectedProfileId = "connection-1";
  const queryClient = new QueryClient();
  const view = renderRuntime(queryClient);
  await flush();

  expect(screen.getByText("unauthorized")).toBeOnTheScreen();
  expect(screen.getByText("connection-1:none")).toBeOnTheScreen();
  expect(screen.getByTestId("runtime-diagnostics").props.children).toContain(
    "current_status=unauthorized",
  );

  view.unmount();
  queryClient.clear();
});

test("forwards app state and network changes and drops stale cache metadata", async () => {
  const setFocused = jest.spyOn(focusManager, "setFocused");
  const setOnline = jest.spyOn(onlineManager, "setOnline");
  let resolveMetadata: ((metadata: unknown) => void) | undefined;
  mockReadCacheMetadata.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveMetadata = resolve;
      }),
  );
  mockClients.set("https://first.test", createClientPair());
  mockProfiles = [profile("connection-1", "https://first.test")];
  mockSelectedProfileId = "connection-1";
  const queryClient = new QueryClient();
  const view = renderRuntime(queryClient);
  await flush();
  expect(mockReadCacheMetadata).toHaveBeenLastCalledWith("connection-1", 1);
  const addEventListener = jest.mocked(AppState.addEventListener);
  const appStateListener = addEventListener.mock.calls.at(-1)?.[1] as (
    state: AppStateStatus,
  ) => void;
  const appStateSubscription = addEventListener.mock.results.at(-1)
    ?.value as NativeEventSubscription;
  const removeAppState = jest.spyOn(appStateSubscription, "remove");

  act(() => appStateListener("inactive"));
  expect(setFocused).toHaveBeenLastCalledWith(true);
  act(() => appStateListener("background"));
  expect(setFocused).toHaveBeenLastCalledWith(false);
  act(() => mockNetworkListener?.({ isConnected: false }));
  expect(setOnline).toHaveBeenLastCalledWith(false);
  act(() => mockNetworkListener?.({}));
  expect(setOnline).toHaveBeenLastCalledWith(true);

  view.unmount();
  expect(removeAppState).toHaveBeenCalled();
  await act(async () => resolveMetadata?.({ connectionId: "connection-1" }));

  setFocused.mockRestore();
  setOnline.mockRestore();
  onlineManager.setOnline(true);
  queryClient.clear();
  mockClients.clear();
  mockClientCalls.clear();
});

test("publishes cache metadata and attention locations", async () => {
  mockReadCacheMetadata.mockResolvedValueOnce({ connectionId: "connection-1" });
  mockClients.set("https://first.test", createClientPair());
  mockProfiles = [profile("connection-1", "https://first.test")];
  mockSelectedProfileId = "connection-1";
  const queryClient = new QueryClient();
  const view = renderRuntime(queryClient);
  await flush();

  expect(screen.getByText("cache:connection-1")).toBeOnTheScreen();
  act(() => runtimeHandle.current?.includeAttentionLocation({ directory: "/repo" } as LocationRef));
  act(() => runtimeHandle.current?.includeAttentionLocation({ directory: "/repo" } as LocationRef));
  expect(screen.getByText("attention:/repo")).toBeOnTheScreen();
  expect(screen.getByText("events:/repo")).toBeOnTheScreen();

  view.unmount();
  queryClient.clear();
  mockClients.clear();
  mockClientCalls.clear();
});

test("drops cached queries when the selected connection is edited", async () => {
  const pair = createClientPair();
  mockClients.set("https://first.test", pair);
  mockProfiles = [profile("connection-1", "https://first.test")];
  mockSelectedProfileId = "connection-1";
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const view = renderRuntime(queryClient);
  await flush();
  pair.resolveHealth();
  await flush();
  expect(queryClient.getQueryData(openCodeQueryKeys.health("connection-1"))).toBeDefined();

  mockProfiles = [{ ...profile("connection-1", "https://first.test"), updatedAtMs: 2 }];
  view.rerender(runtimeTree(queryClient));
  expect(queryClient.getQueryData(openCodeQueryKeys.health("connection-1"))).toBeUndefined();
  expect(screen.getByText("connecting")).toBeOnTheScreen();
  await flush();

  view.unmount();
  queryClient.clear();
  mockClients.clear();
  mockClientCalls.clear();
});

const runtimeHandle: { current?: ReturnType<typeof useConnectionRuntime> } = {};

function RuntimeDetails() {
  const runtime = useConnectionRuntime();
  runtimeHandle.current = runtime;
  return (
    <>
      <Text>cache:{runtime.cacheMetadata ? "connection-1" : "none"}</Text>
      <Text>
        attention:{runtime.attentionLocations.map((location) => location.directory).join()}
      </Text>
      <Text>events:{runtime.eventLocations.map((location) => location.directory).join()}</Text>
    </>
  );
}

function runtimeTree(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionRuntimeProvider>
        <RuntimeStatus />
        <RuntimeDetails />
      </ConnectionRuntimeProvider>
    </QueryClientProvider>
  );
}

function renderRuntime(queryClient: QueryClient) {
  return render(runtimeTree(queryClient));
}

function RuntimeStatus() {
  const runtime = useConnectionRuntime();
  return (
    <>
      <Text>{runtime.status}</Text>
      <Text>
        {runtime.connectionId}:{runtime.restClient ? "ready" : "none"}
      </Text>
      <Text testID="runtime-diagnostics">{runtime.getDiagnosticsText()}</Text>
    </>
  );
}

function createClientPair() {
  let aborted = 0;
  let generations = 0;
  let resolveHealth:
    | ((health: { urls: string[]; pid: number; version: string }) => void)
    | undefined;
  const health = new Promise<{ urls: string[]; pid: number; version: string }>((resolve) => {
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
    server: { status: jest.fn(() => health) },
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
      resolveHealth?.({ urls: [], pid: 42, version: "test" });
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
