import { expect, jest, test } from "@jest/globals";
import type { OpenCodeEvent } from "@opencode2-mobile/opencode-adapter";
import { QueryClient } from "@tanstack/react-query";

import {
  ConnectionEventQueryBridge,
  eventRequiresConnectionSnapshot,
  reduceActiveSessions,
} from "./connection-event-query-bridge";
import { openCodeQueryKeys } from "./open-code-query-keys";

test("reduces active-session events idempotently", () => {
  const busy = sessionStatusEvent("event-1", "busy");
  const first = reduceActiveSessions({}, busy);
  const duplicate = reduceActiveSessions(first, busy);
  const idle = reduceActiveSessions(first, sessionStatusEvent("event-2", "idle"));

  expect(first).toEqual({ "session-1": { type: "running" } });
  expect(duplicate).toBe(first);
  expect(idle).toEqual({});
  expect(reduceActiveSessions(idle, sessionStatusEvent("event-3", "idle"))).toBe(idle);
});

test("removes a deleted session from active state", () => {
  const current = { "session-1": { type: "running" as const } };
  const event = {
    created: 1,
    data: { sessionID: "session-1" },
    durable: { aggregateID: "session-1", seq: 2, version: 2 as const },
    id: "event-1",
    type: "session.deleted",
  } satisfies OpenCodeEvent;

  expect(reduceActiveSessions(current, event)).toEqual({});
});

test("coalesces session metadata invalidations", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const scheduled: Array<() => void> = [];
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) => {
    scheduled.push(callback);
  });
  queryClient.setQueryData(openCodeQueryKeys.activeSessions("connection-1"), {});
  const messageKey = openCodeQueryKeys.messages(
    "connection-1",
    { directory: "/workspace" },
    "session-1",
    {},
  );
  const followedKey = openCodeQueryKeys.followedProjectSessions(
    "connection-1",
    ["project-1"],
    { limit: 30, order: "desc", parentID: null },
    1,
  );
  queryClient.setQueryData(messageKey, []);
  queryClient.setQueryData(followedKey, []);

  bridge.apply(sessionRenamedEvent("event-1"));
  bridge.apply(sessionRenamedEvent("event-2"));

  expect(scheduled).toHaveLength(1);
  expect(invalidate).not.toHaveBeenCalled();
  scheduled[0]?.();
  expect(invalidate).toHaveBeenCalledTimes(1);
  const messageQuery = queryClient.getQueryCache().find({ queryKey: messageKey });
  const followedQuery = queryClient.getQueryCache().find({ queryKey: followedKey });
  expect(messageQuery && invalidate.mock.calls[0]?.[0]?.predicate?.(messageQuery)).toBe(false);
  expect(followedQuery && invalidate.mock.calls[0]?.[0]?.predicate?.(followedQuery)).toBe(true);
  queryClient.clear();
});

test("reconciles one transcript after execution completes", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );
  const firstKey = openCodeQueryKeys.messages(
    "connection-1",
    { directory: "/first" },
    "session-1",
    {},
  );
  const otherSessionKey = openCodeQueryKeys.messages(
    "connection-1",
    { directory: "/first" },
    "session-2",
    {},
  );
  queryClient.setQueryData(firstKey, []);
  queryClient.setQueryData(otherSessionKey, []);

  bridge.apply(sessionExecutionSucceededEvent("event-1"));

  const messageInvalidation = invalidate.mock.calls.find((call) => {
    const first = queryClient.getQueryCache().find({ queryKey: firstKey });
    return Boolean(first && call[0]?.predicate?.(first));
  });
  const predicate = messageInvalidation?.[0]?.predicate;
  const first = queryClient.getQueryCache().find({ queryKey: firstKey });
  const other = queryClient.getQueryCache().find({ queryKey: otherSessionKey });
  expect(first && predicate?.(first)).toBe(true);
  expect(other && predicate?.(other)).toBe(false);
  queryClient.clear();
});

test.each(["session.step.streamed", "session.message.content.updated"] as const)(
  "%s reconciles only the affected transcript",
  (type) => {
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
      callback(),
    );
    const location = { directory: "/workspace" };
    const affectedKey = openCodeQueryKeys.messages("connection-1", location, "session-1", {});
    const otherKey = openCodeQueryKeys.messages("connection-1", location, "session-2", {});
    queryClient.setQueryData(affectedKey, []);
    queryClient.setQueryData(otherKey, []);

    bridge.apply(messageReconciliationEvent(type));

    expect(invalidate).toHaveBeenCalledTimes(1);
    const predicate = invalidate.mock.calls[0]?.[0]?.predicate;
    const affected = queryClient.getQueryCache().find({ queryKey: affectedKey });
    const other = queryClient.getQueryCache().find({ queryKey: otherKey });
    expect(affected && predicate?.(affected)).toBe(true);
    expect(other && predicate?.(other)).toBe(false);
    queryClient.clear();
  },
);

test("does not write active-session state for transcript deltas", () => {
  const queryClient = new QueryClient();
  const setQueryData = jest.spyOn(queryClient, "setQueryData");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", () => undefined);
  const event = sessionTextDeltaEvent("event-1");

  bridge.apply(event);
  bridge.apply({ ...event, id: "event-2" });

  expect(setQueryData).not.toHaveBeenCalled();
  queryClient.clear();
});

test("does not refetch session lists for transcript deltas", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );

  bridge.apply(sessionTextDeltaEvent("event-1"));

  expect(invalidate).not.toHaveBeenCalled();
  queryClient.clear();
});

test("does not refetch session lists for volatile usage updates", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );

  bridge.apply({
    created: 1,
    data: {
      cost: 1,
      sessionID: "session-1",
      tokens: { cache: { read: 0, write: 0 }, input: 1, output: 1, reasoning: 0 },
    },
    id: "event-usage",
    location: { directory: "/workspace" },
    type: "session.usage.updated",
  });

  expect(invalidate).not.toHaveBeenCalled();
  queryClient.clear();
});

test("does not refetch connection queries for file-change hints", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );

  bridge.apply({
    created: 1,
    data: { event: "change", file: "/redacted" },
    id: "event-file",
    location: { directory: "/workspace" },
    type: "filesystem.changed",
  });

  expect(invalidate).not.toHaveBeenCalled();
  queryClient.clear();
});

test("does not refetch connection queries for shell advisory events", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const scheduled: Array<() => void> = [];
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) => {
    scheduled.push(callback);
  });

  for (const [index, type] of ["shell.created", "shell.exited", "shell.deleted"].entries()) {
    bridge.apply({
      created: index + 1,
      data: {},
      id: `event-shell-${index}`,
      location: { directory: "/workspace" },
      type,
    } as unknown as OpenCodeEvent);
  }

  expect(scheduled).toHaveLength(0);
  expect(invalidate).not.toHaveBeenCalled();
  queryClient.clear();
});

test("invalidates VCS information only for the affected location", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );
  const affectedKey = openCodeQueryKeys.vcs("connection-1", { directory: "/workspace" });
  const otherKey = openCodeQueryKeys.vcs("connection-1", { directory: "/other" });
  queryClient.setQueryData(affectedKey, { data: { branch: { current: "old" } } });
  queryClient.setQueryData(otherKey, { data: { branch: { current: "other" } } });

  bridge.apply({
    created: 1,
    data: { branch: "feature/mobile" },
    id: "event-vcs",
    location: { directory: "/workspace" },
    type: "vcs.branch.updated",
  });

  const predicate = invalidate.mock.calls[0]?.[0]?.predicate;
  const affected = queryClient.getQueryCache().find({ queryKey: affectedKey });
  const other = queryClient.getQueryCache().find({ queryKey: otherKey });
  expect(affected && predicate?.(affected)).toBe(true);
  expect(other && predicate?.(other)).toBe(false);
  queryClient.clear();
});

test("falls back to connection reconciliation for an unknown session event", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );

  bridge.apply({
    created: 1,
    data: { sessionID: "session-1" },
    id: "event-future",
    type: "session.future-state",
  } as unknown as OpenCodeEvent);

  expect(invalidate).toHaveBeenCalledWith({
    queryKey: openCodeQueryKeys.connection("connection-1"),
  });
  queryClient.clear();
});

test("invalidates only the affected session inbox for inbox events", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );
  const location = { directory: "/workspace" };
  const affectedKey = openCodeQueryKeys.inbox("connection-1", location, "session-1");
  const otherKey = openCodeQueryKeys.inbox("connection-1", location, "session-2");
  queryClient.setQueryData(affectedKey, []);
  queryClient.setQueryData(otherKey, []);

  bridge.apply({
    created: 1,
    data: { inboxID: "msg_1", sessionID: "session-1" },
    durable: { aggregateID: "session-1", seq: 1, version: 1 },
    id: "event-inbox",
    location,
    type: "session.inbox.delivered",
  });

  const predicate = invalidate.mock.calls[0]?.[0]?.predicate;
  const affected = queryClient.getQueryCache().find({ queryKey: affectedKey });
  const other = queryClient.getQueryCache().find({ queryKey: otherKey });
  expect(affected && predicate?.(affected)).toBe(true);
  expect(other && predicate?.(other)).toBe(false);
  queryClient.clear();
});

test("projects permission requests immediately while scheduling REST reconciliation", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );
  const location = { directory: "/workspace" };
  const key = openCodeQueryKeys.permissions("connection-1", location);
  queryClient.setQueryData(key, { data: [], location });

  bridge.apply({
    created: 1,
    data: {
      action: "shell",
      id: "per_test",
      resources: ["redacted command"],
      sessionID: "session-1",
    },
    id: "event-permission",
    location,
    type: "permission.asked",
  });

  expect(queryClient.getQueryData(key)).toEqual({
    data: [
      {
        action: "shell",
        id: "per_test",
        resources: ["redacted command"],
        sessionID: "session-1",
      },
    ],
    location,
  });
  const query = queryClient.getQueryCache().find({ queryKey: key });
  expect(query && invalidate.mock.calls[0]?.[0]?.predicate?.(query)).toBe(true);

  bridge.apply({
    created: 2,
    data: { reply: "once", requestID: "per_test", sessionID: "session-1" },
    id: "event-permission-replied",
    location,
    type: "permission.replied",
  });
  expect(queryClient.getQueryData(key)).toEqual({ data: [], location });
  queryClient.clear();
});

test("coalesces transcript events into one cache write per frame", () => {
  const queryClient = new QueryClient();
  const scheduled: Array<() => void> = [];
  const onTranscriptFrame = jest.fn();
  const bridge = new ConnectionEventQueryBridge(
    queryClient,
    "connection-1",
    (callback) => {
      scheduled.push(callback);
    },
    onTranscriptFrame,
  );
  const key = openCodeQueryKeys.messages("connection-1", { directory: "/workspace" }, "session-1", {
    limit: 40,
    order: "desc",
  });
  queryClient.setQueryData(key, {
    pageParams: [undefined],
    pages: [{ cursor: {}, data: [] }],
  });
  const setQueryData = jest.spyOn(queryClient, "setQueryData");
  const delta = transcriptEvent("event-3", "session.text.delta", {
    assistantMessageID: "msg_assistant",
    delta: "x",
    ordinal: 0,
    sessionID: "session-1",
  });

  bridge.apply(
    transcriptEvent("event-1", "session.step.started", {
      agent: "build",
      assistantMessageID: "msg_assistant",
      model: { id: "model-1", providerID: "provider-1" },
      sessionID: "session-1",
    }),
  );
  bridge.apply(
    transcriptEvent("event-2", "session.text.started", {
      assistantMessageID: "msg_assistant",
      ordinal: 0,
      sessionID: "session-1",
    }),
  );
  bridge.apply(delta);
  bridge.apply(delta);

  expect(scheduled).toHaveLength(1);
  expect(setQueryData).not.toHaveBeenCalled();
  scheduled[0]?.();
  expect(setQueryData).toHaveBeenCalledTimes(1);
  expect(onTranscriptFrame).toHaveBeenCalledWith({
    cacheWrites: 1,
    durationMs: expect.any(Number),
    eventCount: 3,
    reconciliations: 0,
  });
  expect(queryClient.getQueryData(key)).toMatchObject({
    pages: [
      {
        data: [
          {
            content: [{ text: "x", type: "text" }],
            id: "msg_assistant",
            type: "assistant",
          },
        ],
      },
    ],
  });
  queryClient.clear();
});

test("invalidates only the affected transcript when reduction finds a gap", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );
  const affectedKey = openCodeQueryKeys.messages(
    "connection-1",
    { directory: "/workspace" },
    "session-1",
    { limit: 40, order: "desc" },
  );
  const otherKey = openCodeQueryKeys.messages(
    "connection-1",
    { directory: "/workspace" },
    "session-2",
    { limit: 40, order: "desc" },
  );
  const data = {
    pageParams: [undefined],
    pages: [{ cursor: {}, data: [] }],
  };
  queryClient.setQueryData(affectedKey, data);
  queryClient.setQueryData(otherKey, data);

  bridge.apply(
    transcriptEvent("event-gap", "session.text.started", {
      assistantMessageID: "msg_missing",
      ordinal: 0,
      sessionID: "session-1",
    }),
  );

  const predicate = invalidate.mock.calls[0]?.[0]?.predicate;
  const affected = queryClient.getQueryCache().find({ queryKey: affectedKey });
  const other = queryClient.getQueryCache().find({ queryKey: otherKey });
  expect(affected && predicate?.(affected)).toBe(true);
  expect(other && predicate?.(other)).toBe(false);
  queryClient.clear();
});

test("limits location events to matching location queries", () => {
  const queryClient = new QueryClient();
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  const bridge = new ConnectionEventQueryBridge(queryClient, "connection-1", (callback) =>
    callback(),
  );
  const firstKey = openCodeQueryKeys.sessions("connection-1", { directory: "/first" }, {});
  const secondKey = openCodeQueryKeys.sessions("connection-1", { directory: "/second" }, {});
  queryClient.setQueryData(firstKey, []);
  queryClient.setQueryData(secondKey, []);

  bridge.apply({ ...sessionRenamedEvent("event-1"), location: { directory: "/first" } });

  const predicate = invalidate.mock.calls[0]?.[0]?.predicate;
  const first = queryClient.getQueryCache().find({ queryKey: firstKey });
  const second = queryClient.getQueryCache().find({ queryKey: secondKey });
  expect(first && predicate?.(first)).toBe(true);
  expect(second && predicate?.(second)).toBe(false);
  queryClient.clear();
});

test.each(["catalog.updated", "plugin.added", "mcp.resources.changed"])(
  "%s does not restart a healthy event generation",
  (type) => {
    expect(
      eventRequiresConnectionSnapshot({
        data: {},
        id: "event-1",
        type,
      } as unknown as OpenCodeEvent),
    ).toBe(false);
  },
);

function sessionStatusEvent(id: string, type: "busy" | "idle") {
  return {
    created: 1,
    data: { sessionID: "session-1", status: { type } },
    id,
    type: "session.status",
  } satisfies OpenCodeEvent;
}

function sessionTextDeltaEvent(id: string) {
  return {
    created: 1,
    data: {
      assistantMessageID: "message-1",
      delta: "x",
      ordinal: 0,
      sessionID: "session-1",
    },
    id,
    type: "session.text.delta",
  } satisfies OpenCodeEvent;
}

function sessionRenamedEvent(id: string) {
  return {
    created: 1,
    data: { sessionID: "session-1", title: "Renamed" },
    durable: { aggregateID: "session-1", seq: 1, version: 1 as const },
    id,
    type: "session.renamed",
  } satisfies OpenCodeEvent;
}

function sessionExecutionSucceededEvent(id: string) {
  return {
    created: 1,
    data: { sessionID: "session-1" },
    durable: { aggregateID: "session-1", seq: 1, version: 1 as const },
    id,
    location: { directory: "/first" },
    type: "session.execution.succeeded",
  } satisfies OpenCodeEvent;
}

function messageReconciliationEvent(
  type: "session.step.streamed" | "session.message.content.updated",
) {
  return {
    created: 1,
    data:
      type === "session.step.streamed"
        ? { assistantMessageID: "message-1", sessionID: "session-1" }
        : { content: [], messageID: "message-1", sessionID: "session-1" },
    durable: { aggregateID: "session-1", seq: 1, version: 1 as const },
    id: `event-${type}`,
    location: { directory: "/workspace" },
    type,
  } as OpenCodeEvent;
}

function transcriptEvent(id: string, type: string, data: Record<string, unknown>) {
  return {
    created: 1,
    data,
    id,
    location: { directory: "/workspace" },
    type,
  } as unknown as OpenCodeEvent;
}
