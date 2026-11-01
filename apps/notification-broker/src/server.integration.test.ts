import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import {
  decodeNotificationBytes,
  encodeNotificationBytes,
  notificationDeviceAdditionalData,
  notificationPairingAdditionalData,
  notificationPairingResponseAdditionalData,
  openNotificationJson,
  sealNotificationJson,
} from "@opencode2-mobile/notification-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrokerConfig } from "./config.js";
import { BrokerDatabase } from "./database.js";
import { ExpoPushWorker } from "./expo-push.js";
import { startBrokerServers } from "./server.js";

const pluginToken = "plugin-token-0123456789abcdefghijklmnopqrstuvwxyz";
const bindingID = "binding-1";

type Broker = {
  close(): Promise<void>;
  database: BrokerDatabase;
  deviceKey: Uint8Array;
  pluginUrl: string;
  publicUrl: string;
};

let broker: Broker | undefined;
let openCode: Server | undefined;
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(async () => {
  await broker?.close();
  broker = undefined;
  if (openCode) {
    openCode.closeAllConnections();
    await new Promise((resolve) => openCode?.close(resolve));
    openCode = undefined;
  }
  vi.restoreAllMocks();
});

describe("public listener", () => {
  it("reports health with no-store JSON headers", async () => {
    const { publicUrl } = await startBroker();

    const response = await fetch(`${publicUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.each([
    ["GET", "/missing"],
    ["POST", "/healthz"],
    ["POST", "/v1/unknown"],
    ["GET", "/v1/pair/complete"],
    ["GET", "/v1/device/status"],
  ])("rejects %s %s as not found", async (method, path) => {
    const { publicUrl } = await startBroker();

    const response = await fetch(`${publicUrl}${path}`, { method });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
    expect(stderr).toHaveBeenCalledWith(
      `Notification broker request failed: ${method} ${path} NOT_FOUND\n`,
    );
  });

  it("logs only the pathname of a failed request", async () => {
    const { publicUrl } = await startBroker();

    await fetch(`${publicUrl}/missing?secret=value`);

    expect(stderr).toHaveBeenCalledWith(
      "Notification broker request failed: GET /missing NOT_FOUND\n",
    );
  });

  it("logs an unparseable request path without echoing it", async () => {
    const { publicUrl } = await startBroker();

    const raw = await sendRaw(
      publicUrl,
      "GET // HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );

    expect(raw).toMatch(/^HTTP\/1\.1 404 /);
    expect(stderr).toHaveBeenCalledWith(
      "Notification broker request failed: GET INVALID_PATH NOT_FOUND\n",
    );
  });

  it("rejects malformed JSON", async () => {
    const { publicUrl } = await startBroker();

    const response = await post(`${publicUrl}/v1/pair/complete`, "{");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_JSON" });
  });

  it("stops reading a body over 16 KiB", async () => {
    const { publicUrl } = await startBroker();

    const response = await post(
      `${publicUrl}/v1/pair/complete`,
      JSON.stringify({ padding: "x".repeat(17_000) }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });

    expect(stderr).toHaveBeenCalledWith(
      "Notification broker request failed: POST /v1/pair/complete PAYLOAD_TOO_LARGE\n",
    );
  });
});

describe("pairing completion", () => {
  it("registers the device and returns sealed broker metadata", async () => {
    const { database, publicUrl } = await startBroker({ paired: false });
    const code = createPairingCode(database);
    const secret = decodeNotificationBytes(code.pairingSecret, 32);
    const nonce = randomBytes(24);

    const response = await post(`${publicUrl}/v1/pair/complete`, {
      challengeID: code.challengeID,
      ciphertext: sealNotificationJson(
        secret,
        nonce,
        registration(randomBytes(32)),
        notificationPairingAdditionalData(code.challengeID),
      ),
      nonce: encodeNotificationBytes(nonce),
      v: 1,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, string | number>;
    expect(body).toMatchObject({ brokerID: "broker-test-1", v: 1 });
    expect(
      openNotificationJson(
        secret,
        decodeNotificationBytes(String(body.metadataNonce), 24),
        String(body.metadataCiphertext),
        notificationPairingResponseAdditionalData(code.challengeID),
      ),
    ).toEqual({ brokerID: "broker-test-1", pairedAtMs: body.pairedAtMs, v: 1 });
    expect(database.listDevices()).toHaveLength(1);
  });

  it("rejects an unknown challenge", async () => {
    const { publicUrl } = await startBroker({ paired: false });
    const nonce = randomBytes(24);

    const response = await post(`${publicUrl}/v1/pair/complete`, {
      challengeID: randomUUID(),
      ciphertext: sealNotificationJson(randomBytes(32), nonce, {}, "unused"),
      nonce: encodeNotificationBytes(nonce),
      v: 1,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "PAIRING_UNAVAILABLE" });
  });

  it("rejects a malformed pairing request", async () => {
    const { publicUrl } = await startBroker({ paired: false });

    const response = await post(`${publicUrl}/v1/pair/complete`, { v: 1 });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_PAIRING_REQUEST" });
  });
});

describe("OpenCode pairing", () => {
  it("issues a basic-auth pairing code after OpenCode accepts the credentials", async () => {
    const openCodeOrigin = await startOpenCode();
    const { database, publicUrl } = await startBroker({
      openCodePairingPorts: [Number(new URL(openCodeOrigin).port)],
      paired: false,
    });

    const response = await post(`${publicUrl}/v1/pair/opencode`, pairingIssue(openCodeOrigin));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      allowDevelopmentHttp: true,
      authMode: "basic",
      brokerOrigin: publicUrl,
      name: "Workstation",
      openCodeOrigin,
      v: 1,
    });
    expect(
      database.database.prepare("SELECT COUNT(*) AS count FROM pairing_challenges").get(),
    ).toEqual({ count: 1 });
  });

  it("hides why OpenCode rejected the credentials", async () => {
    const openCodeOrigin = await startOpenCode();
    const { publicUrl } = await startBroker({
      openCodePairingPorts: [Number(new URL(openCodeOrigin).port)],
      paired: false,
    });

    const response = await post(`${publicUrl}/v1/pair/opencode`, {
      ...pairingIssue(openCodeOrigin),
      password: "wrong",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "PAIRING_OPENCODE_REJECTED" });
  });

  it("checks the OpenCode origin before contacting it", async () => {
    const { publicUrl } = await startBroker({ paired: false });

    const response = await post(
      `${publicUrl}/v1/pair/opencode`,
      pairingIssue("http://127.0.0.1:4097"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "PAIRING_OPENCODE_PORT_MISMATCH" });
  });

  it("rate limits pairing attempts from one address", async () => {
    const { publicUrl } = await startBroker({ paired: false });

    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await post(`${publicUrl}/v1/pair/opencode`, { v: 1 });
      statuses.push(response.status);
      if (attempt === 5) expect(await response.json()).toEqual({ error: "PAIRING_RATE_LIMITED" });
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
  });
});

describe("device commands", () => {
  it.each([
    ["status", { enabled: true }],
    ["pause", { enabled: false }],
    ["enable", { enabled: true }],
  ])("runs %s and returns the delivery state", async (operation, state) => {
    const { database, deviceKey, publicUrl } = await startBroker();
    database.setDeliveryEnabled(operation !== "pause", 0);

    const response = await post(
      `${publicUrl}/v1/device/${operation}`,
      deviceRequest(deviceKey, operation),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ...state, v: 1 });
    expect(database.deliveryState().enabled).toBe(state.enabled);
  });

  it("replaces the push token", async () => {
    const { database, deviceKey, publicUrl } = await startBroker();

    const response = await post(
      `${publicUrl}/v1/device/token`,
      deviceRequest(deviceKey, "token", { expoPushToken: "ExponentPushToken[replaced]" }),
    );

    expect(response.status).toBe(200);
    const [row] = database.nextQueued();
    expect(row && database.decryptExpoToken(row)).toBe("ExponentPushToken[replaced]");
  });

  it("queues a test notification and wakes the worker", async () => {
    const tick = vi.spyOn(ExpoPushWorker.prototype, "tick").mockResolvedValue();
    const { database, deviceKey, publicUrl } = await startBroker();
    database.database.prepare("DELETE FROM outbox").run();

    const response = await post(`${publicUrl}/v1/device/test`, deviceRequest(deviceKey, "test"));

    expect(response.status).toBe(200);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(database.database.prepare("SELECT notification_category FROM outbox").all()).toEqual([
      { notification_category: "test" },
    ]);
  });

  it("revokes the device", async () => {
    const { database, deviceKey, publicUrl } = await startBroker();

    const response = await post(
      `${publicUrl}/v1/device/revoke`,
      deviceRequest(deviceKey, "revoke"),
    );

    expect(response.status).toBe(200);
    expect(database.listDevices()).toEqual([
      expect.objectContaining({ binding_id: bindingID, disabled_reason: "revoked" }),
    ]);
    const again = await post(`${publicUrl}/v1/device/status`, deviceRequest(deviceKey, "status"));
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "DEVICE_NOT_FOUND" });
  });

  it("rejects an unknown operation before reading the body", async () => {
    const { publicUrl } = await startBroker();

    const response = await post(`${publicUrl}/v1/device/delete`, "{");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("rejects an unknown binding", async () => {
    const { deviceKey, publicUrl } = await startBroker();

    const response = await post(`${publicUrl}/v1/device/status`, {
      ...deviceRequest(deviceKey, "status"),
      bindingID: "binding-unknown",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "DEVICE_NOT_FOUND" });
  });

  it("does not reveal a ciphertext sealed with the wrong key or operation", async () => {
    const { deviceKey, publicUrl } = await startBroker();

    const wrongKey = await post(
      `${publicUrl}/v1/device/status`,
      deviceRequest(randomBytes(32), "status"),
    );
    const wrongOperation = await post(
      `${publicUrl}/v1/device/pause`,
      deviceRequest(deviceKey, "status"),
    );

    expect(wrongKey.status).toBe(404);
    expect(await wrongKey.json()).toEqual({ error: "DEVICE_NOT_FOUND" });
    expect(wrongOperation.status).toBe(404);
    expect(await wrongOperation.json()).toEqual({ error: "DEVICE_NOT_FOUND" });
  });

  it("rejects a command whose operation does not match the route", async () => {
    const { database, deviceKey, publicUrl } = await startBroker();

    const response = await post(
      `${publicUrl}/v1/device/pause`,
      deviceRequest(deviceKey, "pause", { operation: "enable" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "OPERATION_MISMATCH" });
    expect(database.deliveryState().enabled).toBe(true);
  });

  it("rejects a replayed command", async () => {
    const { deviceKey, publicUrl } = await startBroker();
    const request = deviceRequest(deviceKey, "status");

    const first = await post(`${publicUrl}/v1/device/status`, request);
    const second = await post(`${publicUrl}/v1/device/status`, request);

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ error: "DEVICE_REQUEST_REPLAYED" });
  });

  it("rejects a malformed device request", async () => {
    const { publicUrl } = await startBroker();

    const response = await post(`${publicUrl}/v1/device/status`, { bindingID, v: 1 });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_DEVICE_REQUEST" });
  });
});

describe("plugin listener", () => {
  it.each([
    ["no authorization", undefined],
    ["a different scheme", `Basic ${pluginToken}`],
    ["the wrong token", "Bearer wrong-token"],
  ])("rejects %s", async (_label, authorization) => {
    const { pluginUrl } = await startBroker();

    const response = await fetch(`${pluginUrl}/v1/plugin/status`, {
      headers: authorization ? { Authorization: authorization } : {},
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports, pauses and resumes delivery", async () => {
    const { database, pluginUrl } = await startBroker();
    database.setDeliveryEnabled(true, 0);

    const status = await fetch(`${pluginUrl}/v1/plugin/status`, { headers: pluginHeaders() });
    const paused = await pluginPost(`${pluginUrl}/v1/plugin/pause`);
    expect(database.deliveryState().enabled).toBe(false);
    const enabled = await pluginPost(`${pluginUrl}/v1/plugin/enable`);

    expect(await status.json()).toEqual({ enabled: true, updatedAtMs: 0, v: 1 });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ enabled: false, v: 1 });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ enabled: true, v: 1 });
  });

  it.each([
    ["GET", "/v1/plugin/events"],
    ["GET", "/v1/plugin/pause"],
    ["POST", "/v1/plugin/status"],
    ["POST", "/v1/plugin/other"],
  ])("rejects %s %s as not found", async (method, path) => {
    const { pluginUrl } = await startBroker();

    const response = await fetch(`${pluginUrl}${path}`, { headers: pluginHeaders(), method });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("accepts a batch of events", async () => {
    const { database, pluginUrl } = await startBroker();

    const response = await pluginPost(`${pluginUrl}/v1/plugin/events`, {
      events: [
        {
          eventID: "evt_1",
          interaction: "permission",
          observedAtMs: Date.now(),
          requestID: "per_1",
          sessionID: "ses_1",
          state: "pending",
          v: 1,
        },
      ],
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
    expect(database.database.prepare("SELECT event_id, state FROM plugin_events").all()).toEqual([
      { event_id: "evt_1", state: "pending" },
    ]);
  });

  it.each([
    ["an array body", []],
    ["missing events", {}],
    ["non-array events", { events: {} }],
    ["more than 100 events", { events: Array.from({ length: 101 }, () => ({})) }],
  ])("rejects %s", async (_label, body) => {
    const { pluginUrl } = await startBroker();

    const response = await pluginPost(`${pluginUrl}/v1/plugin/events`, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_PLUGIN_BATCH" });
  });

  it("rejects an invalid event", async () => {
    const { pluginUrl } = await startBroker();

    const response = await pluginPost(`${pluginUrl}/v1/plugin/events`, { events: [{ v: 2 }] });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_PLUGIN_EVENT" });
  });

  it("reads batches larger than the public 16 KiB limit", async () => {
    const { pluginUrl } = await startBroker();

    const response = await pluginPost(`${pluginUrl}/v1/plugin/events`, {
      events: [],
      padding: "x".repeat(20_000),
    });

    expect(response.status).toBe(202);
  });

  it("stops reading a batch over 64 KiB", async () => {
    const { pluginUrl } = await startBroker();

    const response = await pluginPost(`${pluginUrl}/v1/plugin/events`, {
      padding: "x".repeat(66_000),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });

    expect(stderr).toHaveBeenCalledWith(
      "Notification broker request failed: POST /v1/plugin/events PAYLOAD_TOO_LARGE\n",
    );
  });

  it("hides unexpected failures behind a generic error", async () => {
    const { database, pluginUrl } = await startBroker();
    database.close();

    const response = await fetch(`${pluginUrl}/v1/plugin/status`, { headers: pluginHeaders() });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "INTERNAL_ERROR" });
    expect(stderr).toHaveBeenCalledWith(
      "Notification broker request failed: GET /v1/plugin/status INTERNAL_ERROR\n",
    );
  });
});

async function startBroker(
  options: { openCodePairingPorts?: number[]; paired?: boolean } = {},
): Promise<Broker> {
  const database = new BrokerDatabase(":memory:", randomBytes(32));
  const deviceKey = randomBytes(32);
  if (options.paired !== false) {
    const code = createPairingCode(database);
    database.completePairing(code.challengeID, registration(deviceKey), "broker-test-1");
  }
  const config: BrokerConfig = {
    allowDevelopmentHttp: true,
    brokerID: "broker-test-1",
    listenHost: "127.0.0.1",
    openCodePairingPorts: options.openCodePairingPorts ?? [4_096],
    pluginPort: 0,
    publicOrigin: "http://127.0.0.1:37100",
    publicPort: 0,
    v: 1,
  };
  const servers = startBrokerServers(
    config,
    database,
    new ExpoPushWorker(database, undefined, "fake"),
    pluginToken,
  );
  await Promise.all([
    once(servers.publicServer, "listening"),
    once(servers.pluginServer, "listening"),
  ]);
  const publicUrl = serverUrl(servers.publicServer);
  config.publicOrigin = publicUrl;
  broker = {
    async close() {
      servers.publicServer.closeAllConnections();
      servers.pluginServer.closeAllConnections();
      await servers.close();
      if (database.database.isOpen) database.close();
    },
    database,
    deviceKey,
    pluginUrl: serverUrl(servers.pluginServer),
    publicUrl,
  };
  return broker;
}

async function startOpenCode() {
  const expected = `Basic ${Buffer.from("opencode:secret").toString("base64")}`;
  openCode = createServer((request, response) => {
    response.statusCode = request.headers.authorization === expected ? 200 : 401;
    response.end("{}");
  });
  openCode.listen(0, "127.0.0.1");
  await once(openCode, "listening");
  return serverUrl(openCode);
}

function serverUrl(server: Server) {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function createPairingCode(database: BrokerDatabase) {
  return database.createPairing(
    {
      allowDevelopmentHttp: true,
      authMode: "none",
      brokerOrigin: "http://127.0.0.1:37100",
      name: "Test server",
      openCodeOrigin: "http://127.0.0.1:4096",
    },
    {
      allowDevelopmentHttp: true,
      auth: { mode: "none" },
      baseUrl: "http://127.0.0.1:4096",
      name: "Test server",
      v: 1,
    },
  );
}

function registration(deviceKey: Uint8Array) {
  return {
    bindingID,
    deviceKey: encodeNotificationBytes(deviceKey),
    deviceName: "Test phone",
    expoPushToken: "ExponentPushToken[test-token]",
    platform: "ios",
    v: 1,
  };
}

function pairingIssue(openCodeOrigin: string) {
  return {
    allowDevelopmentHttp: true,
    name: "Workstation",
    openCodeOrigin,
    password: "secret",
    username: "opencode",
    v: 1,
  };
}

function deviceRequest(
  deviceKey: Uint8Array,
  operation: string,
  command: Record<string, unknown> = {},
) {
  const nonce = randomBytes(24);
  return {
    bindingID,
    ciphertext: sealNotificationJson(
      deviceKey,
      nonce,
      { atMs: Date.now(), nonceID: randomUUID(), operation, v: 1, ...command },
      notificationDeviceAdditionalData(bindingID, operation),
    ),
    nonce: encodeNotificationBytes(nonce),
    v: 1,
  };
}

function post(url: string, body: unknown) {
  return fetch(url, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function pluginHeaders() {
  return { Authorization: `Bearer ${pluginToken}` };
}

function pluginPost(url: string, body?: unknown) {
  return fetch(url, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: pluginHeaders(),
    method: "POST",
  });
}

function sendRaw(url: string, request: string) {
  const { hostname, port } = new URL(url);
  return new Promise<string>((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => socket.end(request));
    let output = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      output += chunk;
    });
    socket.on("end", () => resolve(output));
    socket.on("error", reject);
  });
}
