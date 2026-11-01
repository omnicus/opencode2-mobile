import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  decodeNotificationBytes,
  encodeNotificationBytes,
  type NotificationDeviceCommand,
  type NotificationDeviceRequest,
  notificationDeviceAdditionalData,
  notificationPairingAdditionalData,
  notificationPairingResponseAdditionalData,
  openNotificationJson,
  parseNotificationDeviceRequest,
  parseNotificationPairingIssueRequest,
  parseNotificationPairingRequest,
  sealNotificationJson,
} from "@opencode2-mobile/notification-protocol";

import type { BrokerConfig } from "./config.js";
import { secureTokenEquals } from "./crypto.js";
import type { BrokerDatabase } from "./database.js";
import type { ExpoPushWorker } from "./expo-push.js";

export function startBrokerServers(
  config: BrokerConfig,
  database: BrokerDatabase,
  worker: ExpoPushWorker,
  pluginToken: string,
) {
  const pairingIssueLimiter = new PairingIssueLimiter();
  const publicServer = createServer((request, response) => {
    void handlePublic(request, response, config, database, worker, pairingIssueLimiter);
  });
  const pluginServer = createServer((request, response) => {
    void handlePlugin(request, response, database, pluginToken);
  });
  publicServer.listen(config.publicPort, config.listenHost);
  pluginServer.listen(config.pluginPort, "127.0.0.1");
  return {
    pluginServer,
    publicServer,
    async close() {
      worker.stop();
      await Promise.all([closeServer(publicServer), closeServer(pluginServer)]);
    },
  };
}

type PublicContext = {
  config: BrokerConfig;
  database: BrokerDatabase;
  pairingIssueLimiter: PairingIssueLimiter;
  worker: ExpoPushWorker;
};

type DeviceOperation = NotificationDeviceCommand["operation"];

const deviceOperations: ReadonlySet<string> = new Set<DeviceOperation>([
  "enable",
  "pause",
  "status",
  "token",
  "test",
  "revoke",
]);

async function handlePublic(
  request: IncomingMessage,
  response: ServerResponse,
  config: BrokerConfig,
  database: BrokerDatabase,
  worker: ExpoPushWorker,
  pairingIssueLimiter: PairingIssueLimiter,
) {
  setHeaders(response);
  try {
    await routePublic(request, response, { config, database, pairingIssueLimiter, worker });
  } catch (error) {
    writeFailure(request, response, error);
  }
}

async function routePublic(
  request: IncomingMessage,
  response: ServerResponse,
  context: PublicContext,
) {
  if (request.method === "GET" && request.url === "/healthz") {
    writeJson(response, 200, { ok: true });
    return;
  }
  if (request.method !== "POST") throw new HttpError(404, "NOT_FOUND");
  if (request.url === "/v1/pair/complete") {
    await completePairing(request, response, context);
    return;
  }
  if (request.url === "/v1/pair/opencode") {
    await issueOpenCodePairing(request, response, context);
    return;
  }
  if (request.url?.startsWith("/v1/device/")) {
    await runDeviceCommand(request, response, context, request.url.slice("/v1/device/".length));
    return;
  }
  throw new HttpError(404, "NOT_FOUND");
}

async function completePairing(
  request: IncomingMessage,
  response: ServerResponse,
  { config, database, worker }: PublicContext,
) {
  const input = parseNotificationPairingRequest(await readJson(request));
  const secret = database.readPairingSecret(input.challengeID);
  const registration = openNotificationJson(
    secret,
    decodeNotificationBytes(input.nonce, 24),
    input.ciphertext,
    notificationPairingAdditionalData(input.challengeID),
  );
  const output = database.completePairing(input.challengeID, registration, config.brokerID);
  const metadataNonce = randomBytes(24);
  worker.start();
  writeJson(response, 200, {
    ...output,
    metadataCiphertext: sealNotificationJson(
      secret,
      metadataNonce,
      { brokerID: output.brokerID, pairedAtMs: output.pairedAtMs, v: 1 },
      notificationPairingResponseAdditionalData(input.challengeID),
    ),
    metadataNonce: encodeNotificationBytes(metadataNonce),
  });
}

async function issueOpenCodePairing(
  request: IncomingMessage,
  response: ServerResponse,
  { config, database, pairingIssueLimiter }: PublicContext,
) {
  pairingIssueLimiter.check(request.socket.remoteAddress ?? "unknown");
  const input = parseNotificationPairingIssueRequest(await readJson(request));
  assertOpenCodePairingOrigin(
    config.publicOrigin,
    input.openCodeOrigin,
    config.openCodePairingPorts,
  );
  pairingIssueLimiter.check(`account:${input.openCodeOrigin}:${input.username}`);
  try {
    await validateOpenCodePairingCredentials(input);
  } catch {
    // Do not reveal whether a username and password were correct on the public listener.
    throw new HttpError(400, "PAIRING_OPENCODE_REJECTED");
  }
  const code = database.createPairing(
    {
      allowDevelopmentHttp: input.allowDevelopmentHttp,
      authMode: "basic",
      brokerOrigin: config.publicOrigin,
      name: input.name,
      openCodeOrigin: input.openCodeOrigin,
    },
    {
      allowDevelopmentHttp: input.allowDevelopmentHttp,
      auth: { mode: "basic", password: input.password, username: input.username },
      baseUrl: input.openCodeOrigin,
      name: input.name,
      v: 1,
    },
  );
  writeJson(response, 201, code);
}

async function runDeviceCommand(
  request: IncomingMessage,
  response: ServerResponse,
  { database, worker }: PublicContext,
  operation: string,
) {
  if (!isDeviceOperation(operation)) throw new HttpError(404, "NOT_FOUND");
  const input = parseNotificationDeviceRequest(await readJson(request));
  const commandValue = openDeviceCommand(database, input, operation);
  const { command } = database.authenticateDeviceCommand(input.bindingID, commandValue);
  if (command.operation !== operation) throw new HttpError(400, "OPERATION_MISMATCH");
  applyDeviceCommand(database, worker, input.bindingID, command);
  writeJson(response, 200, database.deliveryState());
}

function openDeviceCommand(
  database: BrokerDatabase,
  input: NotificationDeviceRequest,
  operation: DeviceOperation,
) {
  const keyRow = database.getDeviceForCommand(input.bindingID);
  if (!keyRow) throw new HttpError(404, "DEVICE_NOT_FOUND");
  try {
    return openNotificationJson(
      database.getDeviceKey(keyRow),
      decodeNotificationBytes(input.nonce, 24),
      input.ciphertext,
      notificationDeviceAdditionalData(input.bindingID, operation),
    );
  } catch {
    throw new HttpError(404, "DEVICE_NOT_FOUND");
  }
}

function applyDeviceCommand(
  database: BrokerDatabase,
  worker: ExpoPushWorker,
  bindingID: string,
  command: NotificationDeviceCommand,
) {
  if (command.operation === "token" && command.expoPushToken) {
    database.updateDeviceToken(bindingID, command.expoPushToken);
  } else if (command.operation === "enable") {
    database.setDeliveryEnabled(true);
  } else if (command.operation === "pause") {
    database.setDeliveryEnabled(false);
  } else if (command.operation === "test") {
    database.enqueueTest(bindingID);
    void worker.tick();
  } else if (command.operation === "revoke") {
    database.revokeDevice(bindingID);
  }
}

async function handlePlugin(
  request: IncomingMessage,
  response: ServerResponse,
  database: BrokerDatabase,
  pluginToken: string,
) {
  setHeaders(response);
  try {
    assertPluginAuthorization(request, pluginToken);
    await routePlugin(request, response, database);
  } catch (error) {
    writeFailure(request, response, error);
  }
}

function assertPluginAuthorization(request: IncomingMessage, pluginToken: string) {
  const authorization = request.headers.authorization;
  if (
    !authorization?.startsWith("Bearer ") ||
    !secureTokenEquals(authorization.slice(7), pluginToken)
  ) {
    throw new HttpError(401, "UNAUTHORIZED");
  }
}

async function routePlugin(
  request: IncomingMessage,
  response: ServerResponse,
  database: BrokerDatabase,
) {
  if (request.method === "GET" && request.url === "/v1/plugin/status") {
    writeJson(response, 200, database.deliveryState());
    return;
  }
  if (
    request.method === "POST" &&
    (request.url === "/v1/plugin/enable" || request.url === "/v1/plugin/pause")
  ) {
    writeJson(response, 200, database.setDeliveryEnabled(request.url.endsWith("/enable")));
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/plugin/events") {
    throw new HttpError(404, "NOT_FOUND");
  }
  await acceptPluginEvents(request, response, database);
}

async function acceptPluginEvents(
  request: IncomingMessage,
  response: ServerResponse,
  database: BrokerDatabase,
) {
  const body = await readJson(request, 64 * 1_024);
  if (!isRecord(body) || !Array.isArray(body.events) || body.events.length > 100) {
    throw new HttpError(400, "INVALID_PLUGIN_BATCH");
  }
  for (const event of body.events) database.acceptPluginEvent(event);
  response.statusCode = 202;
  response.end();
}

async function readJson(request: IncomingMessage, limit = 16 * 1_024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > limit) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON");
  }
}

function setHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function writeJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.end(JSON.stringify(value));
}

function writeFailure(request: IncomingMessage, response: ServerResponse, error: unknown) {
  let status = 500;
  let code = "INTERNAL_ERROR";
  if (error instanceof HttpError) {
    status = error.status;
    code = error.code;
  } else if (
    error instanceof Error &&
    /^(PAIRING_|DEVICE_|INVALID_|OPERATION_)/.test(error.message)
  ) {
    status = 400;
    code = error.message;
  }
  let pathname = "INVALID_PATH";
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {}
  process.stderr.write(
    `Notification broker request failed: ${request.method ?? "UNKNOWN"} ${pathname} ${code}\n`,
  );
  writeJson(response, status, { error: code });
}

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function validateOpenCodePairingCredentials(
  input: ReturnType<typeof parseNotificationPairingIssueRequest>,
  fetchImplementation: typeof fetch = fetch,
) {
  const authorization = `Basic ${Buffer.from(`${input.username}:${input.password}`).toString("base64")}`;
  try {
    await Promise.all(
      ["/api/status", "/api/session?limit=1&order=desc"].map(async (path) => {
        const response = await fetchImplementation(new URL(path, input.openCodeOrigin), {
          headers: { Authorization: authorization },
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) {
          throw new HttpError(401, "PAIRING_OPENCODE_UNAUTHORIZED");
        }
        if (!response.ok) throw new HttpError(502, "PAIRING_OPENCODE_UNAVAILABLE");
      }),
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "PAIRING_OPENCODE_UNAVAILABLE");
  }
}

export function assertOpenCodePairingOrigin(
  brokerOrigin: string,
  openCodeOrigin: string,
  allowedPorts: readonly number[],
) {
  const openCode = new URL(openCodeOrigin);
  if (openCode.hostname !== new URL(brokerOrigin).hostname) {
    throw new HttpError(400, "PAIRING_ORIGIN_HOST_MISMATCH");
  }
  const port = Number(openCode.port || (openCode.protocol === "https:" ? 443 : 80));
  if (!allowedPorts.includes(port)) throw new HttpError(400, "PAIRING_OPENCODE_PORT_MISMATCH");
}

class PairingIssueLimiter {
  private readonly attempts = new Map<string, number[]>();

  check(address: string, now = Date.now()) {
    const recent = (this.attempts.get(address) ?? []).filter((attempt) => attempt > now - 60_000);
    if (recent.length >= 5) throw new HttpError(429, "PAIRING_RATE_LIMITED");
    recent.push(now);
    this.attempts.set(address, recent);
    if (this.attempts.size > 1_024) {
      const oldest = this.attempts.keys().next().value;
      if (oldest !== undefined) this.attempts.delete(oldest);
    }
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function isDeviceOperation(value: string): value is DeviceOperation {
  return deviceOperations.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
