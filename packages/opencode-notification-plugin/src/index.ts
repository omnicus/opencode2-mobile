import { Plugin } from "@opencode-ai/plugin";
import {
  type NotificationCategory,
  type NotificationPluginEvent,
  parseNotificationPluginEvent,
} from "@opencode2-mobile/notification-protocol";

import { readBrokerAccess } from "./broker.js";

const queueStorageKey = "notification-outbox-v1";
const droppedStorageKey = "notification-outbox-dropped-v1";
const maximumQueueSize = 1_000;

export default Plugin.define({
  id: "opencode-mobile-notifications",
  tui: true,
  async setup(ctx) {
    const access = await readBrokerAccess(ctx.options);
    let queue = parseStoredQueue(await ctx.storage.get(queueStorageKey));
    let droppedEvents = parseDroppedCount(await ctx.storage.get(droppedStorageKey));
    let stopped = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let serial = Promise.resolve();
    const controller = new AbortController();
    const iterator = ctx.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]();

    const persist = () => ctx.storage.set(queueStorageKey, queue);
    const scheduleFlush = (delayMs: number) => {
      if (stopped || flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        serial = serial.then(flush).catch(() => undefined);
      }, delayMs);
    };
    const flush = async () => {
      while (!stopped && queue.length > 0) {
        const batch = queue.slice(0, 100);
        let response: Response;
        try {
          response = await fetch(`${access.brokerOrigin}/v1/plugin/events`, {
            body: JSON.stringify({ events: batch, v: 1 }),
            headers: {
              Authorization: `Bearer ${access.ingestToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            signal: AbortSignal.timeout(5_000),
          });
        } catch {
          scheduleFlush(5_000);
          return;
        }
        if (response.status !== 202) {
          scheduleFlush(response.status === 429 || response.status >= 500 ? 5_000 : 30_000);
          return;
        }
        queue = queue.slice(batch.length);
        await persist();
      }
    };
    const enqueue = async (event: NotificationPluginEvent) => {
      if (
        queue.some(
          (queued) =>
            queued.eventID === event.eventID &&
            (queued.kind === "session-done" ||
              event.kind === "session-done" ||
              queued.state === event.state),
        )
      ) {
        return;
      }
      if (queue.length >= maximumQueueSize) {
        const resolvedIndex = queue.findIndex(
          (queued) => queued.kind === "interaction" && queued.state === "resolved",
        );
        queue = queue.toSpliced(resolvedIndex >= 0 ? resolvedIndex : 0, 1);
        droppedEvents += 1;
        await ctx.storage.set(droppedStorageKey, droppedEvents);
      }
      queue = [...queue, event];
      await persist();
      scheduleFlush(0);
    };

    const consume = (async () => {
      try {
        for (;;) {
          const item = await iterator.next();
          if (item.done || stopped) return;
          const event = normalizeOpenCodeNotificationEvent(item.value);
          if (event) await enqueue(event);
        }
      } catch {
        if (!stopped) scheduleFlush(5_000);
      }
    })();
    scheduleFlush(0);

    return async () => {
      stopped = true;
      if (flushTimer) clearTimeout(flushTimer);
      controller.abort();
      await iterator.return?.();
      await Promise.race([consume, new Promise((resolve) => setTimeout(resolve, 1_000))]);
    };
  },
});

export function normalizeOpenCodeNotificationEvent(
  value: unknown,
): NotificationPluginEvent | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.created !== "number") {
    return undefined;
  }
  const data = value.data;
  if (!isRecord(data)) return undefined;
  const location = parseEventLocation(value.location);
  if (value.type === "permission.asked") {
    return safePluginEvent({
      category: permissionCategory(data.action),
      eventID: value.id,
      interaction: "permission",
      kind: "interaction",
      observedAtMs: value.created,
      requestID: data.id,
      sessionID: data.sessionID,
      state: "pending",
      v: 1,
    });
  }
  if (value.type === "permission.replied") {
    return safePluginEvent({
      category: "permission-other",
      eventID: value.id,
      interaction: "permission",
      kind: "interaction",
      observedAtMs: value.created,
      requestID: data.requestID,
      sessionID: data.sessionID,
      state: "resolved",
      v: 1,
    });
  }
  if (value.type === "form.created" && isRecord(data.form)) {
    const sessionID = data.form.sessionID;
    return safePluginEvent({
      category: "form",
      eventID: value.id,
      interaction: "form",
      kind: "interaction",
      ...(sessionID === "global" && location ? { location } : {}),
      observedAtMs: value.created,
      requestID: data.form.id,
      sessionID,
      state: "pending",
      v: 1,
    });
  }
  if (value.type === "form.replied" || value.type === "form.cancelled") {
    const sessionID = data.sessionID;
    return safePluginEvent({
      category: "form",
      eventID: value.id,
      interaction: "form",
      kind: "interaction",
      ...(sessionID === "global" && location ? { location } : {}),
      observedAtMs: value.created,
      requestID: data.id,
      sessionID,
      state: "resolved",
      v: 1,
    });
  }
  if (value.type === "session.execution.succeeded") {
    return safePluginEvent({
      category: "session-done",
      eventID: value.id,
      kind: "session-done",
      observedAtMs: value.created,
      sessionID: data.sessionID,
      v: 1,
    });
  }
  return undefined;
}

const permissionCategories = new Map<string, NotificationCategory>([
  ["edit", "permission-edit"],
  ["execute", "permission-execute"],
  ["external_directory", "permission-external-directory"],
  ["glob", "permission-glob"],
  ["grep", "permission-grep"],
  ["question", "permission-question"],
  ["read", "permission-read"],
  ["shell", "permission-shell"],
  ["skill", "permission-skill"],
  ["subagent", "permission-subagent"],
  ["webfetch", "permission-webfetch"],
  ["websearch", "permission-websearch"],
]);

function permissionCategory(value: unknown) {
  return typeof value === "string"
    ? (permissionCategories.get(value) ?? "permission-other")
    : "permission-other";
}

function safePluginEvent(value: unknown) {
  try {
    return parseNotificationPluginEvent(value);
  } catch {
    return undefined;
  }
}

function parseStoredQueue(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumQueueSize)
    throw new Error("INVALID_STORED_OUTBOX");
  return value.map(parseNotificationPluginEvent);
}

function parseDroppedCount(value: unknown) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("INVALID_DROPPED_COUNT");
  return Number(value);
}

function parseEventLocation(value: unknown) {
  if (!isRecord(value) || typeof value.directory !== "string") return undefined;
  return {
    directory: value.directory,
    ...(typeof value.workspaceID === "string" ? { workspaceID: value.workspaceID } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
