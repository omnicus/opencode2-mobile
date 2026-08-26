import { randomBytes } from "node:crypto";
import type { NotificationCategory } from "@opencode2-mobile/notification-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrokerDatabase } from "./database.js";
import { ExpoPushWorker, notificationBody } from "./expo-push.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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
