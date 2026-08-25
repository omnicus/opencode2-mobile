import { readFile } from "node:fs/promises";

import { Plugin } from "@opencode-ai/plugin";
import {
  type NotificationPluginEvent,
  parseNotificationPluginEvent,
} from "@opencode2-mobile/notification-protocol";

const queueStorageKey = "notification-outbox-v1";
const droppedStorageKey = "notification-outbox-dropped-v1";
const maximumQueueSize = 1_000;

export default Plugin.define({
  id: "opencode-mobile-notifications",
  async setup(ctx) {
    const options = parseOptions(ctx.options);
    const ingestToken = (await readFile(options.tokenFile, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(ingestToken)) throw new Error("INVALID_INGEST_TOKEN");
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
          response = await fetch(`${options.brokerOrigin}/v1/plugin/events`, {
            body: JSON.stringify({ events: batch, v: 1 }),
            headers: {
              Authorization: `Bearer ${ingestToken}`,
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
        queue.some((queued) => queued.eventID === event.eventID && queued.state === event.state)
      ) {
        return;
      }
      if (queue.length >= maximumQueueSize) {
        const resolvedIndex = queue.findIndex((queued) => queued.state === "resolved");
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
      eventID: value.id,
      interaction: "permission",
      observedAtMs: value.created,
      requestID: data.id,
      sessionID: data.sessionID,
      state: "pending",
      v: 1,
    });
  }
  if (value.type === "permission.replied") {
    return safePluginEvent({
      eventID: value.id,
      interaction: "permission",
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
      eventID: value.id,
      interaction: "form",
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
      eventID: value.id,
      interaction: "form",
      ...(sessionID === "global" && location ? { location } : {}),
      observedAtMs: value.created,
      requestID: data.id,
      sessionID,
      state: "resolved",
      v: 1,
    });
  }
  return undefined;
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

function parseOptions(value: Readonly<Record<string, unknown>>) {
  const brokerOrigin = value.brokerOrigin;
  const tokenFile = value.tokenFile;
  if (typeof brokerOrigin !== "string" || typeof tokenFile !== "string") {
    throw new Error("NOTIFICATION_PLUGIN_OPTIONS_REQUIRED");
  }
  const url = new URL(brokerOrigin);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("INVALID_NOTIFICATION_BROKER_ORIGIN");
  }
  return { brokerOrigin: url.origin, tokenFile };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
