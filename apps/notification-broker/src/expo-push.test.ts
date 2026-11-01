import { randomBytes } from "node:crypto";
import type { NotificationCategory } from "@opencode2-mobile/notification-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrokerDatabase } from "./database.js";
import { ExpoPushWorker, notificationBody } from "./expo-push.js";

const originalFetch = globalThis.fetch;
const startMs = 1_800_000_000_000;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe("notificationBody", () => {
  it.each([
    ["form", "OpenCode has a question for you"],
    ["permission-question", "OpenCode has a question for you"],
    ["permission-edit", "Permission to edit files"],
    ["permission-execute", "Permission to use Code Mode"],
    ["permission-external-directory", "Permission to access external files"],
    ["permission-glob", "Permission to search file paths"],
    ["permission-grep", "Permission to search file contents"],
    ["permission-other", "Permission requested"],
    ["permission-read", "Permission to read a file"],
    ["permission-shell", "Permission to run a command"],
    ["permission-skill", "Permission to load a skill"],
    ["permission-subagent", "Permission to start a subagent"],
    ["permission-webfetch", "Permission to fetch a URL"],
    ["permission-websearch", "Permission to search the web"],
    ["session-done", "Session done"],
    ["test", "OpenCode needs your attention."],
  ] satisfies Array<[NotificationCategory, string]>)("maps %s to safe copy", (category, body) => {
    expect(notificationBody(category)).toBe(body);
  });
});

it("does not send later rows from a batch after delivery is paused", async () => {
  const database = pairedDatabase();
  database.enqueueTest("binding-1", 502);
  const fetch = vi.fn(async () => {
    database.setDeliveryEnabled(false, 600);
    return Response.json({ data: { id: "ticket-1", status: "ok" } });
  });
  globalThis.fetch = fetch;

  await new ExpoPushWorker(database, undefined, "expo").tick();

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    database.database
      .prepare("SELECT state, last_error_code FROM outbox ORDER BY created_at_ms")
      .all(),
  ).toEqual([
    { last_error_code: "PAUSED", state: "failed" },
    { last_error_code: "PAUSED", state: "failed" },
  ]);
  database.close();
});

describe("sending queued notifications", () => {
  it("marks rows delivered without calling Expo in fake mode", async () => {
    const database = queuedDatabase();
    const fetch = stubFetch(() => Response.json({}));

    await new ExpoPushWorker(database, undefined, "fake").tick();

    expect(fetch).not.toHaveBeenCalled();
    expect(outboxRows(database)).toEqual([]);
    database.close();
  });

  it("posts the notification and stores the ticket", async () => {
    const database = queuedDatabase();
    const [queued] = database.nextQueued();
    const fetch = stubFetch(() => Response.json({ data: [{ id: "ticket-1", status: "ok" }] }));

    await new ExpoPushWorker(database, "expo-secret", "expo").tick();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer expo-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      body: "OpenCode needs your attention.",
      channelId: "opencode-attention",
      collapseId: queued?.collapse_id,
      data: JSON.parse(String(queued?.push_data_json)),
      priority: "high",
      sound: "default",
      tag: queued?.collapse_id,
      title: "OpenCode",
      to: "ExponentPushToken[test-token]",
      ttl: 604_800,
    });
    expect(outboxRows(database)).toEqual([
      {
        attempts: 1,
        last_error_code: null,
        receipt_due_at_ms: startMs + 15 * 60_000,
        state: "ticketed",
        ticket_id: "ticket-1",
      },
    ]);
    database.close();
  });

  it("omits the authorization header without an access token", async () => {
    const database = queuedDatabase();
    const fetch = stubFetch(() => Response.json({ data: { id: "ticket-1", status: "ok" } }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    database.close();
  });

  it.each([
    [429, "RATE_LIMITED"],
    [500, "EXPO_UNAVAILABLE"],
    [503, "EXPO_UNAVAILABLE"],
  ])("retries after HTTP %i with %s", async (status, errorCode) => {
    const database = queuedDatabase();
    stubFetch(() => new Response(null, { status }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([queuedRetry(errorCode)]);
    database.close();
  });

  it("fails rows Expo rejects", async () => {
    const database = queuedDatabase();
    stubFetch(() => new Response(null, { status: 400 }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([failed("EXPO_REJECTED")]);
    database.close();
  });

  it("disables unregistered devices from ticket errors", async () => {
    const database = queuedDatabase();
    stubFetch(() => Response.json({ data: expoError("DeviceNotRegistered") }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([failed("DEVICE_NOT_REGISTERED")]);
    expect(deviceState(database)).toEqual({
      disabled_at_ms: startMs,
      disabled_reason: "provider-unregistered",
    });
    database.close();
  });

  it("retries rate-limited tickets", async () => {
    const database = queuedDatabase();
    stubFetch(() => Response.json({ data: expoError("MessageRateExceeded") }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([queuedRetry("MESSAGE_RATE_EXCEEDED")]);
    expect(nextAttemptAtMs(database)).toBe(startMs + 2_000);
    expect(deviceState(database)).toEqual({ disabled_at_ms: null, disabled_reason: null });
    database.close();
  });

  it("does not retry rate-limited tickets for interactions resolved during the send", async () => {
    const database = interactionDatabase();
    const fetch = stubFetch(() => {
      resolveInteraction(database);
      return Response.json({ data: expoError("MessageRateExceeded") });
    });
    const worker = new ExpoPushWorker(database, undefined, "expo");

    await worker.tick();
    vi.setSystemTime(startMs + 60_000);
    await worker.tick();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(resolvedRow(database)).toEqual({
      last_error_code: "RESOLVED",
      push_data_json: "{}",
      state: "failed",
    });
    database.close();
  });

  it("fails other ticket errors", async () => {
    const database = queuedDatabase();
    stubFetch(() => Response.json({ data: { status: "error" } }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([failed("EXPO_TICKET_ERROR")]);
    database.close();
  });

  it.each([
    ["the request fails", () => Promise.reject(new Error("offline"))],
    ["the ticket is malformed", () => Response.json({ data: { status: "ok" } })],
    ["the response is not an object", () => Response.json([])],
  ])("retries as a network error when %s", async (_name, respond) => {
    const database = queuedDatabase();
    stubFetch(respond);

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([queuedRetry("NETWORK_ERROR")]);
    database.close();
  });

  it("retries rows with an unknown category without calling Expo", async () => {
    const database = queuedDatabase();
    database.database.prepare("UPDATE outbox SET notification_category = 'unknown'").run();
    const fetch = stubFetch(() => Response.json({ data: { id: "ticket-1", status: "ok" } }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(fetch).not.toHaveBeenCalled();
    expect(outboxRows(database)).toEqual([queuedRetry("NETWORK_ERROR")]);
    database.close();
  });
});

describe("checking receipts", () => {
  it("leaves ticketed rows alone in fake mode", async () => {
    const database = await ticketedDatabase();
    const fetch = stubFetch(() => Response.json({}));

    await new ExpoPushWorker(database, undefined, "fake").tick();

    expect(fetch).not.toHaveBeenCalled();
    expect(outboxRows(database)).toEqual([ticketed()]);
    database.close();
  });

  it("asks Expo for due receipts and deletes delivered rows", async () => {
    const database = await ticketedDatabase();
    const fetch = stubFetch(() => Response.json({ data: { "ticket-1": { status: "ok" } } }));

    await new ExpoPushWorker(database, "expo-secret", "expo").tick();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://exp.host/--/api/v2/push/getReceipts");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer expo-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ ids: ["ticket-1"] });
    expect(outboxRows(database)).toEqual([]);
    database.close();
  });

  it("disables unregistered devices from receipt errors", async () => {
    const database = await ticketedDatabase();
    stubFetch(() => Response.json({ data: { "ticket-1": expoError("DeviceNotRegistered") } }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([receiptFailed("DEVICE_NOT_REGISTERED")]);
    expect(deviceState(database)).toEqual({
      disabled_at_ms: startMs + 15 * 60_000,
      disabled_reason: "provider-unregistered",
    });
    database.close();
  });

  it("requeues rate-limited receipts with the ticket backoff", async () => {
    const database = await ticketedDatabase();
    stubFetch(() => Response.json({ data: { "ticket-1": expoError("MessageRateExceeded") } }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([queuedRetry("MESSAGE_RATE_EXCEEDED")]);
    expect(nextAttemptAtMs(database)).toBe(startMs + 15 * 60_000 + 2_000);
    expect(deviceState(database)).toEqual({ disabled_at_ms: null, disabled_reason: null });
    database.close();
  });

  it("resends rate-limited receipts after the backoff and backs off again", async () => {
    const database = await ticketedDatabase();
    const worker = new ExpoPushWorker(database, undefined, "expo");
    stubFetch(() => Response.json({ data: { "ticket-1": expoError("MessageRateExceeded") } }));
    await worker.tick();

    vi.setSystemTime(startMs + 15 * 60_000 + 1_999);
    const early = stubFetch(() => Response.json({ data: { id: "ticket-2", status: "ok" } }));
    await worker.tick();
    expect(early).not.toHaveBeenCalled();

    vi.setSystemTime(startMs + 15 * 60_000 + 2_000);
    const resend = stubFetch(() => Response.json({ data: { id: "ticket-2", status: "ok" } }));
    await worker.tick();
    expect(resend.mock.calls.map(([url]) => url)).toEqual(["https://exp.host/--/api/v2/push/send"]);
    expect(outboxRows(database)).toEqual([
      {
        attempts: 2,
        last_error_code: "MESSAGE_RATE_EXCEEDED",
        receipt_due_at_ms: startMs + 30 * 60_000 + 2_000,
        state: "ticketed",
        ticket_id: "ticket-2",
      },
    ]);

    vi.setSystemTime(startMs + 30 * 60_000 + 2_000);
    stubFetch(() => Response.json({ data: { "ticket-2": expoError("MessageRateExceeded") } }));
    await worker.tick();
    expect(outboxRows(database)).toEqual([
      { ...queuedRetry("MESSAGE_RATE_EXCEEDED"), attempts: 2 },
    ]);
    expect(nextAttemptAtMs(database)).toBe(startMs + 30 * 60_000 + 6_000);
    database.close();
  });

  it("fails rate-limited receipts while delivery is paused", async () => {
    const database = await ticketedDatabase();
    database.setDeliveryEnabled(false);
    stubFetch(() => Response.json({ data: { "ticket-1": expoError("MessageRateExceeded") } }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([receiptFailed("PAUSED")]);
    database.close();
  });

  it("does not resend rate-limited receipts for resolved interactions", async () => {
    const database = await ticketedInteractionDatabase();
    resolveInteraction(database);
    const fetch = stubFetch(() =>
      Response.json({ data: { "ticket-1": expoError("MessageRateExceeded") } }),
    );
    const worker = new ExpoPushWorker(database, undefined, "expo");

    await worker.tick();
    vi.setSystemTime(startMs + 30 * 60_000);
    await worker.tick();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(resolvedRow(database)).toEqual({
      last_error_code: "RESOLVED",
      push_data_json: "{}",
      state: "failed",
    });
    database.close();
  });

  it("disables unregistered devices from receipts for resolved interactions", async () => {
    const database = await ticketedInteractionDatabase();
    resolveInteraction(database);
    stubFetch(() => Response.json({ data: { "ticket-1": expoError("DeviceNotRegistered") } }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(resolvedRow(database)).toMatchObject({
      last_error_code: "DEVICE_NOT_REGISTERED",
      state: "failed",
    });
    expect(deviceState(database)).toEqual({
      disabled_at_ms: startMs + 15 * 60_000,
      disabled_reason: "provider-unregistered",
    });
    database.close();
  });

  it("fails other receipt errors", async () => {
    const database = await ticketedDatabase();
    stubFetch(() => Response.json({ data: { "ticket-1": expoError("MessageTooBig") } }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([receiptFailed("EXPO_RECEIPT_ERROR")]);
    database.close();
  });

  it("checks missing receipts again later", async () => {
    const database = await ticketedDatabase();
    stubFetch(() => Response.json({ data: {} }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([
      { ...ticketed(), receipt_due_at_ms: startMs + 30 * 60_000 },
    ]);
    database.close();
  });

  it("fails receipts still missing a day after enqueueing", async () => {
    const database = await ticketedDatabase();
    vi.setSystemTime(startMs + 24 * 60 * 60_000);
    stubFetch(() => Response.json({ data: {} }));

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([receiptFailed("RECEIPT_EXPIRED")]);
    database.close();
  });

  it.each([
    ["Expo returns an error status", () => new Response(null, { status: 503 })],
    ["the request fails", () => Promise.reject(new Error("offline"))],
    ["the receipts are malformed", () => Response.json({ data: [] })],
    ["a receipt is malformed", () => Response.json({ data: { "ticket-1": { status: "?" } } })],
  ])("defers receipts for five minutes when %s", async (_name, respond) => {
    const database = await ticketedDatabase();
    stubFetch(respond);

    await new ExpoPushWorker(database, undefined, "expo").tick();

    expect(outboxRows(database)).toEqual([
      { ...ticketed(), receipt_due_at_ms: startMs + 20 * 60_000 },
    ]);
    database.close();
  });
});

function pairedDatabase() {
  const database = new BrokerDatabase(":memory:", randomBytes(32));
  const code = database.createPairing(
    {
      allowDevelopmentHttp: true,
      authMode: "none",
      brokerOrigin: "http://broker.test:37100",
      name: "Test server",
      openCodeOrigin: "http://server.test:4096",
    },
    {
      allowDevelopmentHttp: true,
      auth: { mode: "none" },
      baseUrl: "http://server.test:4096",
      name: "Test server",
      v: 1,
    },
    500,
  );
  database.completePairing(
    code.challengeID,
    {
      bindingID: "binding-1",
      deviceKey: Buffer.from(randomBytes(32)).toString("base64url"),
      deviceName: "Test phone",
      expoPushToken: "ExponentPushToken[test-token]",
      platform: "ios",
      v: 1,
    },
    "broker-1",
    501,
  );
  return database;
}

function queuedDatabase() {
  vi.useFakeTimers({ now: startMs, toFake: ["Date"] });
  const database = pairedDatabase();
  database.database.prepare("DELETE FROM outbox").run();
  database.enqueueTest("binding-1", startMs);
  return database;
}

async function ticketedDatabase() {
  const database = queuedDatabase();
  stubFetch(() => Response.json({ data: { id: "ticket-1", status: "ok" } }));
  await new ExpoPushWorker(database, undefined, "expo").tick();
  vi.setSystemTime(startMs + 15 * 60_000);
  return database;
}

function interactionDatabase() {
  vi.useFakeTimers({ now: startMs, toFake: ["Date"] });
  const database = pairedDatabase();
  database.database.prepare("DELETE FROM outbox").run();
  database.acceptPluginEvent({ ...interactionEvent, eventID: "evt_pending", state: "pending" });
  return database;
}

async function ticketedInteractionDatabase() {
  const database = interactionDatabase();
  stubFetch(() => Response.json({ data: { id: "ticket-1", status: "ok" } }));
  await new ExpoPushWorker(database, undefined, "expo").tick();
  vi.setSystemTime(startMs + 15 * 60_000);
  return database;
}

const interactionEvent = {
  interaction: "permission",
  observedAtMs: startMs,
  requestID: "per_1",
  sessionID: "ses_1",
  v: 1,
};

function resolveInteraction(database: BrokerDatabase) {
  database.acceptPluginEvent({
    ...interactionEvent,
    eventID: "evt_resolved",
    observedAtMs: Date.now(),
    state: "resolved",
  });
}

function resolvedRow(database: BrokerDatabase) {
  return database.database
    .prepare("SELECT state, push_data_json, last_error_code FROM outbox WHERE event_id = ?")
    .get("evt_pending");
}

function stubFetch(respond: () => Response | Promise<Response>) {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => respond());
  globalThis.fetch = fetch;
  return fetch;
}

function expoError(error: string) {
  return { details: { error }, message: error, status: "error" };
}

function outboxRows(database: BrokerDatabase) {
  return database.database
    .prepare(
      `SELECT state, attempts, ticket_id, receipt_due_at_ms, last_error_code
       FROM outbox ORDER BY created_at_ms`,
    )
    .all();
}

function nextAttemptAtMs(database: BrokerDatabase) {
  const row = database.database.prepare("SELECT next_attempt_at_ms FROM outbox").get() as {
    next_attempt_at_ms: number;
  };
  return row.next_attempt_at_ms;
}

function deviceState(database: BrokerDatabase) {
  return database.database
    .prepare("SELECT disabled_at_ms, disabled_reason FROM devices WHERE binding_id = ?")
    .get("binding-1");
}

function queuedRetry(errorCode: string) {
  return {
    attempts: 1,
    last_error_code: errorCode,
    receipt_due_at_ms: null,
    state: "queued",
    ticket_id: null,
  };
}

function failed(errorCode: string) {
  return {
    attempts: 0,
    last_error_code: errorCode,
    receipt_due_at_ms: null,
    state: "failed",
    ticket_id: null,
  };
}

function receiptFailed(errorCode: string) {
  return { ...ticketed(), last_error_code: errorCode, state: "failed" };
}

function ticketed() {
  return {
    attempts: 1,
    last_error_code: null,
    receipt_due_at_ms: startMs + 15 * 60_000,
    state: "ticketed",
    ticket_id: "ticket-1",
  };
}
