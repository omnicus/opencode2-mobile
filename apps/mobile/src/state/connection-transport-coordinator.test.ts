import { expect, jest, test } from "@jest/globals";

import type { OpenCodeClient, OpenCodeEvent } from "@opencode2-mobile/opencode-adapter";
import { eventRequiresConnectionSnapshot } from "./connection-event-query-bridge";
import {
  type ConnectionGenerationReason,
  ConnectionTransportCoordinator,
  type ConnectionTransportCoordinatorOptions,
  type ConnectionTransportStatus,
  isConnectionSnapshot,
  isOpenCodeEventEnvelope,
} from "./connection-transport-coordinator";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  classifyOpenCodeError: (error: unknown) =>
    typeof error === "object" && error !== null && "_tag" in error ? "UNAUTHORIZED" : "UNREACHABLE",
}));

test("passes project snapshot cancellation in the request-options argument", async () => {
  const stream = createEventStream();
  const snapshots = createSnapshotClient(true);
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    restClient: snapshots.client,
  });

  coordinator.start();
  await flush();

  expect(snapshots.client.project.list).toHaveBeenCalledWith(undefined, {
    signal: expect.any(AbortSignal),
  });
  expect(snapshots.client.project.list).toHaveBeenCalledWith(
    undefined,
    stream.subscribe.mock.calls[0]?.[0],
  );
  coordinator.stop();
  expect(stream.subscribe.mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
});

test("buffers events until authoritative snapshots are installed", async () => {
  const stream = createEventStream();
  const snapshots = createSnapshotClient();
  const calls: string[] = [];
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onEvent: (event) => calls.push(`event:${event.type}`),
    onSnapshot: () => calls.push("snapshot"),
    restClient: snapshots.client,
  });

  coordinator.start();
  stream.push(serverConnected("event-1"));
  await flush();
  expect(calls).toEqual([]);

  snapshots.resolve();
  await flush();
  expect(calls).toEqual(["snapshot", "event:server.connected"]);
});

test("deduplicates event IDs and detects durable sequence gaps", async () => {
  const stream = createEventStream();
  const onEvent = jest.fn();
  const onDurableGap = jest.fn();
  const onSnapshot = jest.fn();
  const onUncertain = jest.fn();
  const generationReasons: ConnectionGenerationReason[] = [];
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onDurableGap,
    onEvent,
    onGeneration: (reason) => generationReasons.push(reason),
    onSnapshot,
    onUncertain,
    restClient: createSnapshotClient(true).client,
  });
  coordinator.start();
  await flush();

  const first = durableEvent("event-1", 1);
  stream.push(first);
  stream.push(first);
  stream.push(durableEvent("event-3", 3));
  await flush();
  await flush();

  expect(onEvent).toHaveBeenCalledTimes(2);
  expect(onDurableGap).toHaveBeenCalledTimes(1);
  expect(onUncertain).toHaveBeenCalledTimes(1);
  expect(onSnapshot).toHaveBeenCalledTimes(2);
  expect(generationReasons).toEqual(["startup", "durable_gap"]);
});

test("a gap seen on a fresh stream does not chain into another reconnect", async () => {
  const stream = createEventStream();
  const generationReasons: ConnectionGenerationReason[] = [];
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onEvent: jest.fn(),
    onGeneration: (reason) => generationReasons.push(reason),
    onSnapshot: jest.fn(),
    onUncertain: jest.fn(),
    restClient: createSnapshotClient(true).client,
  });
  coordinator.start();
  await flush();
  stream.push(durableEvent("event-1", 1));
  stream.push(durableEvent("event-3", 3));
  await flush();
  await flush();
  expect(generationReasons).toEqual(["startup", "durable_gap"]);

  // Events sent while the new stream connected are missing, and its snapshot covers them.
  stream.push(durableEvent("event-6", 6));
  stream.push(durableEvent("event-7", 7));
  await flush();
  await flush();
  expect(generationReasons).toEqual(["startup", "durable_gap"]);
  // A gap within the same stream is still detected.
  stream.push(durableEvent("event-9", 9));
  await flush();
  await flush();
  expect(generationReasons).toEqual(["startup", "durable_gap", "durable_gap"]);
  coordinator.stop();
});

test("reconnects with bounded full-jitter backoff", async () => {
  const stream = createEventStream();
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const statuses: ConnectionTransportStatus[] = [];
  const generationReasons: ConnectionGenerationReason[] = [];
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onGeneration: (reason) => generationReasons.push(reason),
    onStatus: (status) => statuses.push(status),
    random: () => 0.5,
    restClient: createSnapshotClient(true).client,
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return callback;
    },
  });
  coordinator.start();
  await flush();
  stream.fail(new Error("network"));
  await flush();

  expect(statuses).toContain("connected");
  expect(statuses.at(-1)).toBe("reconnecting");
  expect(scheduled[0]?.delay).toBe(250);

  scheduled[0]?.callback();
  expect(stream.generations).toBe(2);
  expect(generationReasons).toEqual(["startup", "retry"]);
});

test("bounds the pre-snapshot event buffer and marks state uncertain", async () => {
  const stream = createEventStream();
  const onEvent = jest.fn();
  const onUncertain = jest.fn();
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    maxBufferedEvents: 1,
    onEvent,
    onUncertain,
    restClient: createSnapshotClient().client,
    schedule: () => undefined,
  });
  coordinator.start();
  stream.push(serverConnected("event-1"));
  await flush();
  stream.push(serverConnected("event-2"));
  await flush();

  expect(onUncertain).toHaveBeenCalledTimes(1);
  expect(onEvent).not.toHaveBeenCalled();
  expect(stream.aborted).toBe(1);
});

test("retries when an authoritative snapshot stalls", async () => {
  jest.useFakeTimers();
  const stream = createEventStream();
  const scheduled: Array<() => void> = [];
  const statuses: ConnectionTransportStatus[] = [];
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onStatus: (status) => statuses.push(status),
    restClient: createSnapshotClient().client,
    schedule: (callback) => {
      scheduled.push(callback);
      return callback;
    },
    snapshotTimeoutMs: 100,
  });

  try {
    coordinator.start();
    jest.advanceTimersByTime(100);
    await flush();

    expect(stream.aborted).toBe(1);
    expect(statuses.at(-1)).toBe("reconnecting");
    expect(scheduled).toHaveLength(1);
  } finally {
    coordinator.stop();
    jest.useRealTimers();
  }
});

test("rejects malformed event envelopes without exporting their type", async () => {
  const stream = createEventStream();
  const onEvent = jest.fn();
  const onUncertain = jest.fn();
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onEvent,
    onUncertain,
    restClient: createSnapshotClient(true).client,
    schedule: () => undefined,
  });
  coordinator.start();
  await flush();

  stream.push({ data: {}, id: "event-1", type: "unsafe\nvalue" } as unknown as OpenCodeEvent);
  await flush();

  expect(onEvent).not.toHaveBeenCalled();
  expect(onUncertain).toHaveBeenCalledTimes(1);
  expect(stream.aborted).toBe(1);
});

test("reconciles coordinator-owned roots for an uncertain event type", async () => {
  const stream = createEventStream();
  const onSnapshot = jest.fn();
  const onUncertain = jest.fn();
  const generationReasons: ConnectionGenerationReason[] = [];
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onGeneration: (reason) => generationReasons.push(reason),
    onSnapshot,
    onUncertain,
    restClient: createSnapshotClient(true).client,
    shouldReconcileEvent: () => true,
  });
  coordinator.start();
  await flush();

  stream.push({ data: {}, id: "event-1", type: "future.updated" } as unknown as OpenCodeEvent);
  await flush();
  await flush();

  expect(onUncertain).toHaveBeenCalledTimes(1);
  expect(onSnapshot).toHaveBeenCalledTimes(2);
  expect(generationReasons).toEqual(["startup", "event_reconciliation"]);
});

test("keeps a healthy generation live for installation advisory events", async () => {
  const stream = createEventStream();
  const onSnapshot = jest.fn();
  const statuses: ConnectionTransportStatus[] = [];
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onSnapshot,
    onStatus: (status) => statuses.push(status),
    restClient: createSnapshotClient(true).client,
    shouldReconcileEvent: eventRequiresConnectionSnapshot,
  });
  coordinator.start();
  await flush();
  const settledStatuses = [...statuses];

  stream.push({
    data: {},
    id: "event-installation",
    type: "installation.update-available",
  } as unknown as OpenCodeEvent);
  await flush();

  expect(statuses).toEqual(settledStatuses);
  expect(statuses.at(-1)).toBe("connected");
  expect(stream.generations).toBe(1);
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  coordinator.stop();
});

test("rejects malformed authoritative snapshots", async () => {
  const stream = createEventStream();
  const statuses: ConnectionTransportStatus[] = [];
  const restClient = {
    server: { status: jest.fn(async () => ({ urls: [], pid: "invalid", version: "test" })) },
    project: { list: jest.fn(async () => []) },
    session: { active: jest.fn(async () => ({})) },
  } as unknown as Pick<OpenCodeClient, "server" | "project" | "session">;
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onStatus: (status) => statuses.push(status),
    restClient,
    schedule: () => undefined,
  });
  coordinator.start();
  await flush();

  expect(statuses.at(-1)).toBe("incompatible");
  expect(stream.aborted).toBe(1);
});

test("accepts a server version change when snapshot behavior remains compatible", async () => {
  const stream = createEventStream();
  const statuses: ConnectionTransportStatus[] = [];
  const restClient = {
    server: {
      status: jest.fn(async () => ({ urls: [], pid: 42, version: "newer-beta" })),
    },
    project: { list: jest.fn(async () => []) },
    session: { active: jest.fn(async () => ({})) },
  } as unknown as Pick<OpenCodeClient, "server" | "project" | "session">;
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onStatus: (status) => statuses.push(status),
    restClient,
  });
  coordinator.start();
  await flush();

  expect(statuses.at(-1)).toBe("connected");
  coordinator.stop();
});

test("reconciles a replacement snapshot after the stream restarts", async () => {
  const stream = createEventStream();
  const scheduled: Array<() => void> = [];
  const pids: number[] = [];
  let pid = 41;
  const restClient = {
    server: { status: jest.fn(async () => ({ urls: [], pid: pid++, version: "test" })) },
    project: { list: jest.fn(async () => []) },
    session: { active: jest.fn(async () => ({})) },
  } as unknown as Pick<OpenCodeClient, "server" | "project" | "session">;
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onSnapshot: (snapshot) => pids.push(snapshot.health.pid),
    restClient,
    schedule: (callback) => {
      scheduled.push(callback);
      return callback;
    },
  });
  coordinator.start();
  await flush();
  stream.fail(new Error("server restarted"));
  await flush();
  scheduled[0]?.();
  await flush();

  expect(pids).toEqual([41, 42]);
  coordinator.stop();
});

test("stops streams while backgrounded or offline", async () => {
  const stream = createEventStream();
  const statuses: ConnectionTransportStatus[] = [];
  const generationReasons: ConnectionGenerationReason[] = [];
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: stream.subscribe } } as never,
    onGeneration: (reason) => generationReasons.push(reason),
    onStatus: (status) => statuses.push(status),
    restClient: createSnapshotClient(true).client,
  });
  coordinator.start();
  await flush();

  coordinator.setForeground(false);
  expect(stream.aborted).toBe(1);
  expect(statuses.at(-1)).toBe("stale");

  coordinator.setForeground(true);
  expect(stream.generations).toBe(2);

  coordinator.setOnline(false);
  expect(statuses.at(-1)).toBe("offline");

  coordinator.setOnline(true);
  expect(stream.generations).toBe(3);
  expect(generationReasons).toEqual(["startup", "foreground", "network_restored"]);
  coordinator.stop();
});

test("records explicit reconciliation as a generation reason", async () => {
  const generationReasons: ConnectionGenerationReason[] = [];
  const coordinator = createCoordinator({
    eventClient: { event: { subscribe: createEventStream().subscribe } } as never,
    onGeneration: (reason) => generationReasons.push(reason),
    restClient: createSnapshotClient(true).client,
  });

  coordinator.start();
  await flush();
  coordinator.reconcile();

  expect(generationReasons).toEqual(["startup", "manual_reconcile"]);
  coordinator.stop();
});

test("accepts well-formed event envelopes", () => {
  const accepted: unknown[] = [
    serverConnected("event-1"),
    durableEvent("event-2", 1),
    { ...serverConnected("event-3"), location: undefined },
    { ...serverConnected("event-4"), location: { directory: "/workspace" } },
    {
      ...serverConnected("event-5"),
      location: { directory: "d".repeat(4096), workspaceID: "workspace-1" },
    },
    { data: {}, id: "i".repeat(256), type: `a${"b".repeat(127)}` },
    { data: {}, id: "event-6", type: "constructor" },
    { data: {}, id: "event-7", type: "future.event-type.2" },
    ...["idle", "busy", "retry"].map((type) => ({
      data: { sessionID: "session-1", status: { type } },
      id: `event-status-${type}`,
      type: "session.status",
    })),
    ...sessionLifecycleTypes.map((type) => ({
      data: { sessionID: "session-1" },
      id: `event-${type}`,
      type,
    })),
    {
      data: {},
      durable: { aggregateID: "a".repeat(256), seq: 0, version: 1.5 },
      id: "event-8",
      type: "server.connected",
    },
  ];

  for (const event of accepted) expect(isOpenCodeEventEnvelope(event)).toBe(true);
});

test("rejects event envelopes with malformed headers", () => {
  const rejected: unknown[] = [
    undefined,
    null,
    "event",
    [],
    { data: {}, type: "server.connected" },
    { data: {}, id: 1, type: "server.connected" },
    { data: {}, id: "", type: "server.connected" },
    { data: {}, id: "i".repeat(257), type: "server.connected" },
    { data: {}, id: "event-1" },
    { data: {}, id: "event-1", type: 1 },
    { data: {}, id: "event-1", type: "" },
    { data: {}, id: "event-1", type: "Server.connected" },
    { data: {}, id: "event-1", type: "1server" },
    { data: {}, id: "event-1", type: "server_connected" },
    { data: {}, id: "event-1", type: `a${"b".repeat(128)}` },
    { id: "event-1", type: "server.connected" },
    { data: null, id: "event-1", type: "server.connected" },
    { data: [], id: "event-1", type: "server.connected" },
    { data: "data", id: "event-1", type: "server.connected" },
  ];

  for (const event of rejected) expect(isOpenCodeEventEnvelope(event)).toBe(false);
});

test("rejects event envelopes with malformed locations", () => {
  const locations: unknown[] = [
    null,
    "/workspace",
    [],
    {},
    { directory: 1 },
    { directory: "" },
    { directory: "d".repeat(4097) },
    { directory: "/workspace", workspaceID: 1 },
    { directory: "/workspace", workspaceID: null },
  ];

  for (const location of locations) {
    expect(isOpenCodeEventEnvelope({ ...serverConnected("event-1"), location })).toBe(false);
  }
});

test("rejects session events without the data that drives active-session state", () => {
  const statuses: unknown[] = [undefined, null, "busy", [], {}, { type: "running" }];
  for (const status of statuses) {
    expect(
      isOpenCodeEventEnvelope({
        data: { sessionID: "session-1", status },
        id: "event-1",
        type: "session.status",
      }),
    ).toBe(false);
  }
  expect(
    isOpenCodeEventEnvelope({
      data: { sessionID: 1, status: { type: "busy" } },
      id: "event-1",
      type: "session.status",
    }),
  ).toBe(false);
  for (const type of sessionLifecycleTypes) {
    expect(isOpenCodeEventEnvelope({ data: {}, id: "event-1", type })).toBe(false);
    expect(isOpenCodeEventEnvelope({ data: { sessionID: 1 }, id: "event-1", type })).toBe(false);
  }
});

test("rejects event envelopes with malformed durable references", () => {
  const durables: unknown[] = [
    undefined,
    null,
    [],
    { seq: 1, version: 1 },
    { aggregateID: 1, seq: 1, version: 1 },
    { aggregateID: "", seq: 1, version: 1 },
    { aggregateID: "a".repeat(257), seq: 1, version: 1 },
    { aggregateID: "session-1", version: 1 },
    { aggregateID: "session-1", seq: 1.5, version: 1 },
    { aggregateID: "session-1", seq: Number.MAX_SAFE_INTEGER + 1, version: 1 },
    { aggregateID: "session-1", seq: "1", version: 1 },
    { aggregateID: "session-1", seq: 1 },
    { aggregateID: "session-1", seq: 1, version: "1" },
  ];

  for (const durable of durables) {
    expect(isOpenCodeEventEnvelope({ ...serverConnected("event-1"), durable })).toBe(false);
  }
});

test("accepts well-formed connection snapshots", () => {
  const health = { pid: 42, urls: ["http://127.0.0.1:4096"], version: "v".repeat(128) };
  const project = {
    canonical: "/workspace",
    id: "project-1",
    sandboxes: [],
    time: { created: 1, updated: 2 },
  };

  expect(isConnectionSnapshot(health, [], {})).toBe(true);
  expect(
    isConnectionSnapshot(health, [project, project], {
      ses_1: { type: "running" },
      ses_2: { type: "running" },
    }),
  ).toBe(true);
});

test("rejects connection snapshots with malformed server status", () => {
  const healths: unknown[] = [
    undefined,
    null,
    [],
    { pid: 42, version: "test" },
    { pid: 42, urls: "http://127.0.0.1", version: "test" },
    { pid: 42, urls: [1], version: "test" },
    { pid: 42, urls: [] },
    { pid: 42, urls: [], version: 1 },
    { pid: 42, urls: [], version: "" },
    { pid: 42, urls: [], version: "v".repeat(129) },
    { urls: [], version: "test" },
    { pid: 4.2, urls: [], version: "test" },
    { pid: "42", urls: [], version: "test" },
  ];

  for (const health of healths) expect(isConnectionSnapshot(health, [], {})).toBe(false);
});

test("rejects connection snapshots with malformed projects", () => {
  const health = { pid: 42, urls: [], version: "test" };
  const project = {
    canonical: "/workspace",
    id: "project-1",
    sandboxes: [],
    time: { created: 1, updated: 2 },
  };
  const projectLists: unknown[] = [
    undefined,
    {},
    [null],
    [[]],
    [{ ...project, id: 1 }],
    [{ ...project, canonical: undefined }],
    [{ ...project, sandboxes: {} }],
    [{ ...project, time: undefined }],
    [{ ...project, time: [] }],
    [{ ...project, time: { updated: 2 } }],
    [{ ...project, time: { created: "1", updated: 2 } }],
    [{ ...project, time: { created: 1 } }],
    [project, { ...project, time: { created: 1, updated: "2" } }],
  ];

  for (const projects of projectLists)
    expect(isConnectionSnapshot(health, projects, {})).toBe(false);
});

test("rejects connection snapshots with malformed active sessions", () => {
  const health = { pid: 42, urls: [], version: "test" };
  const activeSessionMaps: unknown[] = [
    undefined,
    null,
    [],
    { "running-1": { type: "running" } },
    { ses_1: null },
    { ses_1: [] },
    { ses_1: {} },
    { ses_1: { type: "idle" } },
    { ses_1: { type: "running" }, ses_2: { type: "busy" } },
  ];

  for (const activeSessions of activeSessionMaps) {
    expect(isConnectionSnapshot(health, [], activeSessions)).toBe(false);
  }
});

const sessionLifecycleTypes = [
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.idle",
  "session.deleted",
];

function createCoordinator(overrides: Partial<ConnectionTransportCoordinatorOptions> = {}) {
  return new ConnectionTransportCoordinator({
    eventClient: overrides.eventClient ?? ({} as never),
    ...(overrides.maxBufferedEvents ? { maxBufferedEvents: overrides.maxBufferedEvents } : {}),
    ...(overrides.onDurableGap ? { onDurableGap: overrides.onDurableGap } : {}),
    onEvent: overrides.onEvent ?? (() => undefined),
    ...(overrides.onGeneration ? { onGeneration: overrides.onGeneration } : {}),
    onSnapshot: overrides.onSnapshot ?? (() => undefined),
    onStatus: overrides.onStatus ?? (() => undefined),
    onUncertain: overrides.onUncertain ?? (() => undefined),
    ...(overrides.random ? { random: overrides.random } : {}),
    restClient: overrides.restClient ?? ({} as never),
    ...(overrides.schedule ? { schedule: overrides.schedule } : {}),
    ...(overrides.shouldReconcileEvent
      ? { shouldReconcileEvent: overrides.shouldReconcileEvent }
      : {}),
    ...(overrides.snapshotTimeoutMs ? { snapshotTimeoutMs: overrides.snapshotTimeoutMs } : {}),
  });
}

function createSnapshotClient(immediate = false) {
  let resolveHealth:
    | ((value: { urls: string[]; pid: number; version: string }) => void)
    | undefined;
  const health = immediate
    ? Promise.resolve({ urls: [], pid: 42, version: "test" })
    : new Promise<{ urls: string[]; pid: number; version: string }>((resolve) => {
        resolveHealth = resolve;
      });
  const client = {
    server: { status: jest.fn(() => health) },
    project: { list: jest.fn(async () => []) },
    session: { active: jest.fn(async () => ({})) },
  } as unknown as Pick<OpenCodeClient, "server" | "project" | "session">;
  return {
    client,
    resolve() {
      resolveHealth?.({ urls: [], pid: 42, version: "test" });
    },
  };
}

function createEventStream() {
  let generations = 0;
  let aborted = 0;
  let current:
    | {
        reject: (error: unknown) => void;
        resolve: (value: IteratorResult<OpenCodeEvent>) => void;
      }
    | undefined;
  const queued: OpenCodeEvent[] = [];
  const subscribe = jest.fn((options?: { signal?: AbortSignal }): AsyncIterable<OpenCodeEvent> => {
    generations += 1;
    options?.signal?.addEventListener(
      "abort",
      () => {
        aborted += 1;
        current?.reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            const event = queued.shift();
            if (event) return Promise.resolve({ done: false as const, value: event });
            return new Promise<IteratorResult<OpenCodeEvent>>((resolve, reject) => {
              current = { reject, resolve };
            });
          },
        };
      },
    };
  });
  return {
    get aborted() {
      return aborted;
    },
    fail(error: unknown) {
      current?.reject(error);
      current = undefined;
    },
    get generations() {
      return generations;
    },
    push(event: OpenCodeEvent) {
      if (current) {
        current.resolve({ done: false, value: event });
        current = undefined;
      } else {
        queued.push(event);
      }
    },
    subscribe,
  };
}

function serverConnected(id: string) {
  return { data: {}, id, type: "server.connected" } satisfies OpenCodeEvent;
}

function durableEvent(id: string, seq: number) {
  return {
    created: 1,
    data: { sessionID: "session-1", title: "Test" },
    durable: { aggregateID: "session-1", seq, version: 1 },
    id,
    type: "session.renamed",
  } satisfies OpenCodeEvent;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
