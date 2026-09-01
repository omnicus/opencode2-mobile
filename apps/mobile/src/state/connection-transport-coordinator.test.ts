import { expect, jest, test } from "@jest/globals";

import type { OpenCodeClient, OpenCodeEvent } from "@opencode2-mobile/opencode-adapter";
import { eventRequiresConnectionSnapshot } from "./connection-event-query-bridge";
import {
  type ConnectionGenerationReason,
  ConnectionTransportCoordinator,
  type ConnectionTransportCoordinatorOptions,
  type ConnectionTransportStatus,
} from "./connection-transport-coordinator";

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  classifyOpenCodeError: (error: unknown) =>
    typeof error === "object" && error !== null && "_tag" in error ? "UNAUTHORIZED" : "UNREACHABLE",
}));

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
    health: { get: jest.fn(async () => ({ healthy: true, pid: "invalid", version: "test" })) },
    project: { list: jest.fn(async () => []) },
    session: { active: jest.fn(async () => ({})) },
  } as unknown as Pick<OpenCodeClient, "health" | "project" | "session">;
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
    health: {
      get: jest.fn(async () => ({ healthy: true as const, pid: 42, version: "newer-beta" })),
    },
    project: { list: jest.fn(async () => []) },
    session: { active: jest.fn(async () => ({})) },
  } as unknown as Pick<OpenCodeClient, "health" | "project" | "session">;
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
    health: { get: jest.fn(async () => ({ healthy: true as const, pid: pid++, version: "test" })) },
    project: { list: jest.fn(async () => []) },
    session: { active: jest.fn(async () => ({})) },
  } as unknown as Pick<OpenCodeClient, "health" | "project" | "session">;
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
  let resolveHealth: ((value: { healthy: true; pid: number; version: string }) => void) | undefined;
  const health = immediate
    ? Promise.resolve({ healthy: true as const, pid: 42, version: "test" })
    : new Promise<{ healthy: true; pid: number; version: string }>((resolve) => {
        resolveHealth = resolve;
      });
  const client = {
    health: { get: jest.fn(() => health) },
    project: { list: jest.fn(async () => []) },
    session: { active: jest.fn(async () => ({})) },
  } as unknown as Pick<OpenCodeClient, "health" | "project" | "session">;
  return {
    client,
    resolve() {
      resolveHealth?.({ healthy: true, pid: 42, version: "test" });
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
