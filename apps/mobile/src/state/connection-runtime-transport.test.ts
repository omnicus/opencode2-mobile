import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type { LocationRef, OpenCodeEvent } from "@opencode2-mobile/opencode-adapter";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";

import {
  boundedOpenCodeFetch as mockBoundedFetch,
  expoOpenCodeFetch as mockExpoFetch,
} from "../expo-open-code-fetch";
import { eventRequiresConnectionSnapshot as mockEventRequiresSnapshot } from "./connection-event-query-bridge";
import {
  appendEventLocation,
  type ConnectionRuntimeTransportSink,
  connectionTransportCallbacks,
  isTransportForeground,
  startConnectionTransport,
} from "./connection-runtime-transport";
import type { ConnectionSnapshot } from "./connection-transport-coordinator";
import { openCodeQueryKeys } from "./open-code-query-keys";
import { recordTranscriptProjectionFrame as mockRecordFrame } from "./transcript-performance";

const mockGetNetworkState = jest.fn<() => Promise<{ isConnected?: boolean }>>();
const mockWriteCacheMetadata = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCoordinators: Array<{
  options: Record<string, unknown>;
  setForeground: jest.Mock;
  setOnline: jest.Mock;
  start: jest.Mock;
}> = [];
const mockBridges: unknown[][] = [];
const queryClients: QueryClient[] = [];

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  createOpenCodeClient: (options: unknown) => ({ options }),
}));

jest.mock("../expo-open-code-fetch", () => ({
  boundedOpenCodeFetch: jest.fn(),
  expoOpenCodeFetch: jest.fn(),
}));

jest.mock("./transcript-performance", () => ({
  recordTranscriptProjectionFrame: jest.fn(),
}));

jest.mock("./connection-cache-metadata", () => ({
  writeConnectionCacheMetadata: (...args: unknown[]) => mockWriteCacheMetadata(...args),
}));

jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => mockGetNetworkState(),
}));

jest.mock("./connection-event-query-bridge", () => ({
  ConnectionEventQueryBridge: class {
    constructor(...args: unknown[]) {
      mockBridges.push(args);
    }
  },
  eventRequiresConnectionSnapshot: jest.fn(),
}));

jest.mock("./connection-transport-coordinator", () => ({
  ConnectionTransportCoordinator: class {
    readonly setForeground = jest.fn();
    readonly setOnline = jest.fn();
    readonly start = jest.fn();
    readonly options: Record<string, unknown>;
    constructor(mockOptions: Record<string, unknown>) {
      this.options = mockOptions;
      mockCoordinators.push(this);
    }
  },
}));

const profile = { baseUrl: "https://server.test", id: "connection-1", updatedAtMs: 7 };

beforeEach(() => {
  mockCoordinators.length = 0;
  mockBridges.length = 0;
  mockGetNetworkState.mockReset();
  mockWriteCacheMetadata.mockReset();
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
});

test("starts an authorized transport with bounded REST and Expo event clients", async () => {
  const setFocused = jest.spyOn(focusManager, "setFocused");
  const setOnline = jest.spyOn(onlineManager, "setOnline");
  mockGetNetworkState.mockResolvedValue({ isConnected: false });
  const queryClient = createQueryClient();
  const sink = createSink();

  const coordinator = startConnectionTransport(
    profile,
    { mode: "bearer", schemaVersion: 1, token: "secret" },
    queryClient,
    sink,
  );

  const restClient = {
    options: { authorization: "Bearer secret", baseUrl: profile.baseUrl, fetch: mockBoundedFetch },
  };
  const eventClient = {
    options: { authorization: "Bearer secret", baseUrl: profile.baseUrl, fetch: mockExpoFetch },
  };
  expect(sink.setRestClientState).toHaveBeenCalledWith({
    client: restClient,
    connectionId: profile.id,
  });
  expect(mockBridges).toEqual([[queryClient, profile.id, undefined, mockRecordFrame]]);
  expect(mockCoordinators).toHaveLength(1);
  expect(coordinator).toBe(mockCoordinators[0]);
  expect(mockCoordinators[0]?.options).toMatchObject({
    eventClient,
    restClient,
    shouldReconcileEvent: mockEventRequiresSnapshot,
  });
  expect(mockCoordinators[0]?.setForeground).toHaveBeenCalledWith(true);
  expect(setFocused).toHaveBeenCalledWith(true);
  expect(mockCoordinators[0]?.start).not.toHaveBeenCalled();

  await flush();
  expect(setOnline).toHaveBeenCalledWith(false);
  expect(mockCoordinators[0]?.setOnline).toHaveBeenCalledWith(false);
  expect(mockCoordinators[0]?.start).toHaveBeenCalledTimes(1);
});

test("omits authorization without a credential and starts in the background", async () => {
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "background" });
  mockGetNetworkState.mockResolvedValue({});

  startConnectionTransport(profile, undefined, createQueryClient(), createSink());

  expect(mockCoordinators[0]?.options.restClient).toEqual({
    options: { baseUrl: profile.baseUrl, fetch: mockBoundedFetch },
  });
  expect(mockCoordinators[0]?.options.eventClient).toEqual({
    options: { baseUrl: profile.baseUrl, fetch: mockExpoFetch },
  });
  expect(mockCoordinators[0]?.setForeground).toHaveBeenCalledWith(false);
  await flush();
  expect(mockCoordinators[0]?.setOnline).toHaveBeenCalledWith(true);
  expect(mockCoordinators[0]?.start).toHaveBeenCalledTimes(1);
});

test("keeps the transport in the foreground while iOS reports inactive", () => {
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "inactive" });
  mockGetNetworkState.mockResolvedValue({});

  startConnectionTransport(profile, undefined, createQueryClient(), createSink());

  expect(mockCoordinators[0]?.setForeground).toHaveBeenCalledWith(true);
  expect(isTransportForeground("active")).toBe(true);
  expect(isTransportForeground("inactive")).toBe(true);
  expect(isTransportForeground("background")).toBe(false);
});

test("encodes basic credentials", () => {
  mockGetNetworkState.mockResolvedValue({ isConnected: true });

  startConnectionTransport(
    profile,
    { mode: "basic", password: "pass", schemaVersion: 1, username: "user" },
    createQueryClient(),
    createSink(),
  );

  expect(mockCoordinators[0]?.options.restClient).toMatchObject({
    options: { authorization: "Basic dXNlcjpwYXNz" },
  });
});

test("does not start a transport that became inactive before the network state arrived", async () => {
  mockGetNetworkState.mockResolvedValue({ isConnected: true });

  startConnectionTransport(profile, undefined, createQueryClient(), createSink(false));

  await flush();
  expect(mockCoordinators[0]?.setOnline).not.toHaveBeenCalled();
  expect(mockCoordinators[0]?.start).not.toHaveBeenCalled();
});

test("starts without network state when it cannot be read", async () => {
  mockGetNetworkState.mockRejectedValue(new Error("NETWORK_UNAVAILABLE"));

  startConnectionTransport(profile, undefined, createQueryClient(), createSink());

  await flush();
  expect(mockCoordinators[0]?.setOnline).not.toHaveBeenCalled();
  expect(mockCoordinators[0]?.start).toHaveBeenCalledTimes(1);
});

test("applies events, tracks their locations, and records redacted diagnostics", () => {
  jest.spyOn(Date, "now").mockReturnValue(1_000);
  const bridge = createBridge();
  const sink = createSink();
  const callbacks = connectionTransportCallbacks(profile, createQueryClient(), bridge, sink);
  const location = { directory: "/repo" } as LocationRef;
  const existing = [location];

  callbacks.onEvent(event("session.updated", location));
  callbacks.onEvent(event("Session Updated"));
  callbacks.onEvent(event("permission.asked", location));
  callbacks.onEvent(event("form.created", location));

  expect(bridge.apply).toHaveBeenCalledTimes(4);
  expect(sink.setEventLocations).toHaveBeenCalledTimes(3);
  const [generic, permission, form] = sink.setEventLocations.mock.calls.map(
    ([update]) => update as (current: LocationRef[]) => LocationRef[],
  );
  expect(generic?.(existing)).toBe(existing);
  expect(generic?.([])).toEqual([location]);
  expect(permission?.(existing)).not.toBe(existing);
  expect(permission?.(existing)).toEqual(existing);
  expect(form?.(existing)).not.toBe(existing);
  expect(sink.recordDiagnostic.mock.calls).toEqual([
    [{ atMs: 1_000, kind: "event", value: "session.updated" }],
    [{ atMs: 1_000, kind: "event", value: "unknown" }],
    [{ atMs: 1_000, kind: "event", value: "permission.asked" }],
    [{ atMs: 1_000, kind: "event", value: "form.created" }],
  ]);
});

test("counts generations and durable gaps and forwards status and uncertainty", () => {
  jest.spyOn(Date, "now").mockReturnValue(2_000);
  const bridge = createBridge();
  const sink = createSink();
  const callbacks = connectionTransportCallbacks(profile, createQueryClient(), bridge, sink);
  const uncertain = event("session.updated");

  callbacks.onDurableGap?.();
  callbacks.onGeneration?.("retry");
  callbacks.onStatus("reconnecting", 3);
  callbacks.onUncertain(uncertain);

  expect(bridge.streamRestarted).toHaveBeenCalledTimes(1);
  expect(bridge.uncertain).toHaveBeenCalledWith(uncertain);
  expect(sink.metrics()).toEqual({
    durableSequenceGaps: 1,
    generationStarts: 1,
    snapshotRequests: 1,
    snapshotsInstalled: 0,
  });
  expect(sink.setStatus).toHaveBeenCalledWith("reconnecting", 3);
  expect(sink.recordDiagnostic.mock.calls).toEqual([
    [{ atMs: 2_000, kind: "generation", value: "retry" }],
    [{ atMs: 2_000, attempt: 3, kind: "status", value: "reconnecting" }],
  ]);
});

test("installs snapshots and refreshes only this connection's location queries", async () => {
  const queryClient = createQueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const metadata = { connectionId: profile.id };
  mockWriteCacheMetadata.mockResolvedValue(metadata);
  const sink = createSink();
  const callbacks = connectionTransportCallbacks(profile, queryClient, createBridge(), sink);
  const snapshot = {
    activeSessions: { session: {} },
    health: { pid: 42, urls: [], version: "1.2.3" },
    projects: [],
  } as unknown as ConnectionSnapshot;

  callbacks.onSnapshot(snapshot);

  expect(sink.metrics().snapshotsInstalled).toBe(1);
  expect(sink.setServerVersion).toHaveBeenCalledWith("1.2.3");
  expect(queryClient.getQueryData(openCodeQueryKeys.health(profile.id))).toBe(snapshot.health);
  expect(queryClient.getQueryData(openCodeQueryKeys.projects(profile.id))).toBe(snapshot.projects);
  expect(queryClient.getQueryData(openCodeQueryKeys.activeSessions(profile.id))).toBe(
    snapshot.activeSessions,
  );
  const revision = sink.setReconciliationRevision.mock.calls[0]?.[0] as (n: number) => number;
  expect(revision(4)).toBe(5);
  expect(mockWriteCacheMetadata).toHaveBeenCalledWith(profile.id, profile.updatedAtMs, snapshot);

  const options = invalidate.mock.calls[0]?.[0] as {
    predicate: (query: { queryKey: readonly unknown[] }) => boolean;
    refetchType: string;
  };
  expect(options.refetchType).toBe("active");
  const matches = (queryKey: readonly unknown[]) => options.predicate({ queryKey });
  expect(matches(["opencode", profile.id, "location"])).toBe(true);
  expect(matches(["opencode", profile.id, "location-default"])).toBe(true);
  expect(matches(["opencode", profile.id, "health"])).toBe(false);
  expect(matches(["opencode", "connection-2", "location"])).toBe(false);
  expect(matches(["other", profile.id, "location"])).toBe(false);

  await flush();
  expect(sink.setCacheMetadata).toHaveBeenCalledWith(metadata);
});

test("drops snapshot cache metadata after deactivation or a failed write", async () => {
  const snapshot = {
    activeSessions: {},
    health: { pid: 42, urls: [], version: "1.2.3" },
    projects: [],
  } as unknown as ConnectionSnapshot;
  const inactive = createSink(false);
  const failing = createSink();
  mockWriteCacheMetadata.mockResolvedValueOnce({ connectionId: profile.id });
  mockWriteCacheMetadata.mockRejectedValueOnce(new Error("WRITE_FAILED"));

  connectionTransportCallbacks(profile, createQueryClient(), createBridge(), inactive).onSnapshot(
    snapshot,
  );
  connectionTransportCallbacks(profile, createQueryClient(), createBridge(), failing).onSnapshot(
    snapshot,
  );

  await flush();
  expect(inactive.setCacheMetadata).not.toHaveBeenCalled();
  expect(failing.setCacheMetadata).not.toHaveBeenCalled();
});

test("deduplicates event locations by directory and workspace and keeps the newest 256", () => {
  const first = { directory: "/repo", workspaceID: "w1" } as LocationRef;
  const current = [first];

  expect(
    appendEventLocation(current, { directory: "/repo", workspaceID: "w1" } as LocationRef),
  ).toBe(current);
  expect(
    appendEventLocation(current, { directory: "/repo", workspaceID: "w2" } as LocationRef),
  ).toEqual([first, { directory: "/repo", workspaceID: "w2" }]);

  let locations: LocationRef[] = [];
  for (let index = 0; index < 300; index += 1) {
    locations = appendEventLocation(locations, { directory: `/repo-${index}` } as LocationRef);
  }
  expect(locations).toHaveLength(256);
  expect(locations[0]?.directory).toBe("/repo-44");
  expect(locations.at(-1)?.directory).toBe("/repo-299");
});

function createQueryClient() {
  const queryClient = new QueryClient();
  queryClients.push(queryClient);
  return queryClient;
}

function createSink(active = true) {
  const metrics = {
    durableSequenceGaps: 0,
    generationStarts: 0,
    snapshotRequests: 0,
    snapshotsInstalled: 0,
  };
  return {
    isActive: () => active,
    metrics: () => metrics,
    recordDiagnostic: jest.fn(),
    setCacheMetadata: jest.fn(),
    setEventLocations: jest.fn(),
    setReconciliationRevision: jest.fn(),
    setRestClientState: jest.fn(),
    setServerVersion: jest.fn(),
    setStatus: jest.fn(),
  } satisfies ConnectionRuntimeTransportSink;
}

function createBridge() {
  return { apply: jest.fn(), streamRestarted: jest.fn(), uncertain: jest.fn() };
}

function event(type: string, location?: LocationRef) {
  return { type, ...(location ? { location } : {}) } as unknown as OpenCodeEvent;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
