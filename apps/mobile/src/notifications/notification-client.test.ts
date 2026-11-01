import { afterEach, expect, jest, test } from "@jest/globals";
import {
  decodeNotificationBytes,
  encodeNotificationBytes,
  type NotificationPairingCode,
  notificationBootstrapAdditionalData,
  notificationDeviceKeyBytes,
  notificationNonceBytes,
  notificationPairingAdditionalData,
  notificationPairingResponseAdditionalData,
  openNotificationJson,
  sealNotificationJson,
} from "@opencode2-mobile/notification-protocol";

import {
  completeNotificationPairing,
  issueNotificationPairingFromOpenCode,
  prepareOpenCodeDevicePairing,
  sendNotificationDeviceCommand,
} from "./notification-client";

jest.mock("expo-crypto", () => ({
  getRandomBytes: (size: number) => new Uint8Array(size).fill(1),
  randomUUID: () => "nonce-id",
}));

const originalFetch = globalThis.fetch;
const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (timeoutDescriptor) Object.defineProperty(AbortSignal, "timeout", timeoutDescriptor);
});

test("posts a device command when Hermes does not provide AbortSignal.timeout", async () => {
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    value: undefined,
  });
  const fetch = jest.fn(async () => ({
    json: async () => ({ enabled: true, updatedAtMs: 1_000, v: 1 }),
    ok: true,
  }));
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

  await expect(
    sendNotificationDeviceCommand({
      bindingID: "binding-1",
      brokerOrigin: "https://push.test",
      deviceKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      operation: "status",
    }),
  ).resolves.toEqual({ enabled: true, updatedAtMs: 1_000, v: 1 });

  expect(fetch).toHaveBeenCalledTimes(1);
});

test("rejects malformed shared notification state", async () => {
  globalThis.fetch = jest.fn(async () => ({
    json: async () => ({ enabled: "yes", updatedAtMs: 1_000, v: 1 }),
    ok: true,
  })) as unknown as typeof globalThis.fetch;

  await expect(
    sendNotificationDeviceCommand({
      bindingID: "binding-1",
      brokerOrigin: "https://push.test",
      deviceKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      operation: "status",
    }),
  ).rejects.toThrow("INVALID_NOTIFICATION_STATE");
});

test("prepares the first non-loopback URL from an OpenCode pair QR", () => {
  expect(
    prepareOpenCodeDevicePairing({
      password: "secret",
      urls: ["http://localhost:4096", "http://100.64.0.10:4096"],
      username: "opencode",
    }),
  ).toMatchObject({
    allowDevelopmentHttp: true,
    brokerOrigin: "http://100.64.0.10:37100",
    name: "OpenCode on 100.64.0.10",
    openCodeOrigin: "http://100.64.0.10:4096",
  });
});

test("rejects loopback and unspecified OpenCode pair URLs", () => {
  expect(() =>
    prepareOpenCodeDevicePairing({
      password: "secret",
      urls: [
        "http://127.0.0.2:4096",
        "http://[::1]:4096",
        "http://0.0.0.0:4096",
        "http://[::]:4096",
        "http://[::ffff:127.0.0.1]:4096",
      ],
      username: "opencode",
    }),
  ).toThrow("PAIRING_OPENCODE_IS_LOOPBACK");
});

test("issues a notification challenge without putting credentials in the URL", async () => {
  const prepared = prepareOpenCodeDevicePairing({
    password: "secret",
    urls: ["https://code.example.test:4096"],
    username: "opencode",
  });
  const fetch = jest.fn(async (_url: string, _init: RequestInit) => ({
    json: async () => ({
      allowDevelopmentHttp: false,
      authMode: "basic",
      brokerOrigin: "https://code.example.test:37100",
      challengeID: "challenge-1",
      expiresAtMs: Date.now() + 60_000,
      name: "OpenCode on code.example.test",
      openCodeOrigin: "https://code.example.test:4096",
      pairingSecret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      v: 1,
    }),
    ok: true,
  }));
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

  await issueNotificationPairingFromOpenCode(prepared);

  expect(fetch).toHaveBeenCalledWith(
    "https://code.example.test:37100/v1/pair/opencode",
    expect.objectContaining({
      body: expect.stringContaining('"password":"secret"'),
      method: "POST",
      redirect: "error",
    }),
  );
  expect(fetch.mock.calls[0]?.[0]).not.toContain("secret");
});

test("rejects a broker challenge for a server the user did not approve", async () => {
  const prepared = prepareOpenCodeDevicePairing({
    password: "secret",
    urls: ["https://code.example.test:4096"],
    username: "opencode",
  });
  globalThis.fetch = jest.fn(async () => ({
    json: async () => ({
      allowDevelopmentHttp: false,
      authMode: "basic",
      brokerOrigin: "https://code.example.test:37100",
      challengeID: "challenge-1",
      expiresAtMs: Date.now() + 60_000,
      name: "OpenCode on attacker.example.test",
      openCodeOrigin: "https://attacker.example.test:4096",
      pairingSecret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      v: 1,
    }),
    ok: true,
  })) as unknown as typeof globalThis.fetch;

  await expect(issueNotificationPairingFromOpenCode(prepared)).rejects.toThrow(
    "PAIRING_ISSUE_MISMATCH",
  );
});

test("cancelling a pairing aborts the broker request", async () => {
  const prepared = prepareOpenCodeDevicePairing({
    password: "secret",
    urls: ["https://code.example.test:4096"],
    username: "opencode",
  });
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = jest.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        requestSignal = init.signal ?? undefined;
        requestSignal?.addEventListener("abort", () => reject(new Error("Aborted")));
      }),
  ) as unknown as typeof globalThis.fetch;
  const cancel = new AbortController();

  const pairing = issueNotificationPairingFromOpenCode(prepared, cancel.signal);
  cancel.abort();

  await expect(pairing).rejects.toThrow("Aborted");
  expect(requestSignal?.aborted).toBe(true);
});

const pairingSecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const randomDeviceKey = encodeNotificationBytes(new Uint8Array(notificationDeviceKeyBytes).fill(1));
const storedDeviceKey = encodeNotificationBytes(new Uint8Array(notificationDeviceKeyBytes).fill(4));
const registration = {
  bindingID: "binding-1",
  deviceName: "Pixel",
  expoPushToken: "ExponentPushToken[token-1]",
  platform: "android",
} as const;

function pairingCode(overrides: Partial<NotificationPairingCode> = {}): NotificationPairingCode {
  return {
    allowDevelopmentHttp: false,
    authMode: "basic",
    brokerOrigin: "https://push.example.test",
    challengeID: "challenge-1",
    expiresAtMs: Number.MAX_SAFE_INTEGER,
    name: "Workstation",
    openCodeOrigin: "https://code.example.test",
    pairingSecret,
    v: 1,
    ...overrides,
  };
}

function bootstrap(overrides: Record<string, unknown> = {}) {
  return {
    allowDevelopmentHttp: false,
    auth: { mode: "basic", password: "secret", username: "opencode" },
    baseUrl: "https://code.example.test",
    name: "Workstation",
    v: 1,
    ...overrides,
  };
}

function pairingResponse(
  input: {
    bootstrap?: unknown;
    bootstrapAdditionalData?: string;
    metadata?: unknown;
    response?: Record<string, unknown>;
  } = {},
) {
  const key = decodeNotificationBytes(pairingSecret, notificationDeviceKeyBytes);
  const bootstrapNonce = new Uint8Array(notificationNonceBytes).fill(2);
  const metadataNonce = new Uint8Array(notificationNonceBytes).fill(3);
  return {
    bootstrapCiphertext: sealNotificationJson(
      key,
      bootstrapNonce,
      "bootstrap" in input ? input.bootstrap : bootstrap(),
      input.bootstrapAdditionalData ?? notificationBootstrapAdditionalData("challenge-1"),
    ),
    bootstrapNonce: encodeNotificationBytes(bootstrapNonce),
    brokerID: "broker-1",
    metadataCiphertext: sealNotificationJson(
      key,
      metadataNonce,
      "metadata" in input ? input.metadata : { brokerID: "broker-1", pairedAtMs: 5_000, v: 1 },
      notificationPairingResponseAdditionalData("challenge-1"),
    ),
    metadataNonce: encodeNotificationBytes(metadataNonce),
    pairedAtMs: 5_000,
    v: 1,
    ...input.response,
  };
}

function mockBroker(value: unknown, ok = true) {
  const fetch = jest.fn(async (_url: string, _init: RequestInit) => ({
    json: async () => value,
    ok,
  }));
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  return fetch;
}

test("completes pairing with a sealed registration and returns the verified bootstrap", async () => {
  const fetch = mockBroker(pairingResponse());

  await expect(completeNotificationPairing(pairingCode(), registration)).resolves.toEqual({
    bindingID: "binding-1",
    bootstrap: bootstrap(),
    brokerID: "broker-1",
    brokerOrigin: "https://push.example.test",
    deviceKey: randomDeviceKey,
  });

  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0] ?? [];
  expect(url).toBe("https://push.example.test/v1/pair/complete");
  expect(init).toMatchObject({
    headers: { "Content-Type": "application/json" },
    method: "POST",
    redirect: "error",
  });
  const request = JSON.parse(String(init?.body));
  expect(request).toEqual({
    challengeID: "challenge-1",
    ciphertext: expect.any(String),
    nonce: encodeNotificationBytes(new Uint8Array(notificationNonceBytes).fill(1)),
    v: 1,
  });
  expect(
    openNotificationJson(
      decodeNotificationBytes(pairingSecret, notificationDeviceKeyBytes),
      decodeNotificationBytes(request.nonce, notificationNonceBytes),
      request.ciphertext,
      notificationPairingAdditionalData("challenge-1"),
    ),
  ).toEqual({ ...registration, deviceKey: randomDeviceKey, v: 1 });
  expect(String(init?.body)).not.toContain("ExponentPushToken");
});

test("accepts a JSON pairing code and reuses an existing device key", async () => {
  const fetch = mockBroker(pairingResponse());

  await expect(
    completeNotificationPairing(JSON.stringify(pairingCode()), registration, storedDeviceKey),
  ).resolves.toMatchObject({ deviceKey: storedDeviceKey });

  const request = JSON.parse(String(fetch.mock.calls[0]?.[1].body));
  expect(
    openNotificationJson(
      decodeNotificationBytes(pairingSecret, notificationDeviceKeyBytes),
      decodeNotificationBytes(request.nonce, notificationNonceBytes),
      request.ciphertext,
      notificationPairingAdditionalData("challenge-1"),
    ),
  ).toMatchObject({ deviceKey: storedDeviceKey });
});

test("allows an approved development HTTP broker", async () => {
  mockBroker(
    pairingResponse({
      bootstrap: bootstrap({ allowDevelopmentHttp: true, baseUrl: "http://100.64.0.10:4096" }),
    }),
  );

  await expect(
    completeNotificationPairing(
      pairingCode({
        allowDevelopmentHttp: true,
        brokerOrigin: "http://100.64.0.10:37100",
        openCodeOrigin: "http://100.64.0.10:4096",
      }),
      registration,
    ),
  ).resolves.toMatchObject({ brokerOrigin: "http://100.64.0.10:37100" });
});

test.each([
  ["a malformed code", { v: 2 }, "INVALID_PAIRING_CODE"],
  ["an expired code", pairingCode({ expiresAtMs: 0 }), "PAIRING_CODE_EXPIRED"],
  [
    "an unapproved HTTP broker",
    pairingCode({ brokerOrigin: "http://push.example.test" }),
    "PAIRING_HTTP_NOT_APPROVED",
  ],
  [
    "a loopback broker",
    pairingCode({ brokerOrigin: "https://localhost:37100" }),
    "PAIRING_BROKER_IS_LOOPBACK",
  ],
  [
    "a loopback OpenCode server",
    pairingCode({ openCodeOrigin: "https://127.0.0.1:4096" }),
    "PAIRING_OPENCODE_IS_LOOPBACK",
  ],
])("rejects %s before contacting the broker", async (_label, code, error) => {
  const fetch = mockBroker(pairingResponse());

  await expect(completeNotificationPairing(code, registration)).rejects.toThrow(error);
  expect(fetch).not.toHaveBeenCalled();
});

test("rejects a malformed stored device key before contacting the broker", async () => {
  const fetch = mockBroker(pairingResponse());

  await expect(completeNotificationPairing(pairingCode(), registration, "short")).rejects.toThrow(
    "INVALID_NOTIFICATION_BYTES",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  ["the broker error code", { error: "PAIRING_CHALLENGE_USED" }, "PAIRING_CHALLENGE_USED"],
  ["a generic error without a code", { error: 42 }, "BROKER_ERROR"],
  ["a generic error for a non-object body", undefined, "BROKER_ERROR"],
])("surfaces %s when the broker refuses pairing", async (_label, body, error) => {
  mockBroker(body, false);

  await expect(completeNotificationPairing(pairingCode(), registration)).rejects.toThrow(error);
});

test("reports a generic error when a refused pairing has no JSON body", async () => {
  globalThis.fetch = jest.fn(async () => ({
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
    ok: false,
  })) as unknown as typeof globalThis.fetch;

  await expect(completeNotificationPairing(pairingCode(), registration)).rejects.toThrow(
    "BROKER_ERROR",
  );
});

test.each([
  ["a non-object", "nope", "INVALID_PAIRING_RESPONSE"],
  [
    "a bad nonce",
    pairingResponse({ response: { bootstrapNonce: "AAAA" } }),
    "INVALID_PAIRING_RESPONSE",
  ],
  ["a bad broker ID", pairingResponse({ response: { brokerID: "" } }), "INVALID_PAIRING_RESPONSE"],
  [
    "a bootstrap sealed for another challenge",
    pairingResponse({
      bootstrapAdditionalData: notificationBootstrapAdditionalData("challenge-2"),
    }),
    "INVALID_NOTIFICATION_CIPHERTEXT",
  ],
  [
    "a malformed bootstrap",
    pairingResponse({ bootstrap: { v: 1 } }),
    "INVALID_CONNECTION_BOOTSTRAP",
  ],
])("rejects a pairing response with %s", async (_label, body, error) => {
  mockBroker(body);

  await expect(completeNotificationPairing(pairingCode(), registration)).rejects.toThrow(error);
});

test.each([
  ["a non-object", "metadata"],
  ["an array", []],
  ["a different version", { brokerID: "broker-1", pairedAtMs: 5_000, v: 2 }],
  ["a different broker", { brokerID: "broker-2", pairedAtMs: 5_000, v: 1 }],
  ["a different pairing time", { brokerID: "broker-1", pairedAtMs: 6_000, v: 1 }],
])("rejects sealed metadata with %s", async (_label, metadata) => {
  mockBroker(pairingResponse({ metadata }));

  await expect(completeNotificationPairing(pairingCode(), registration)).rejects.toThrow(
    "PAIRING_RESPONSE_MISMATCH",
  );
});

test.each([
  ["another OpenCode server", { baseUrl: "https://attacker.example.test" }],
  ["another name", { name: "Attacker" }],
  ["another auth mode", { auth: { mode: "bearer", token: "token" } }],
  ["development HTTP the code did not allow", { allowDevelopmentHttp: true }],
])("rejects a bootstrap for %s", async (_label, overrides) => {
  mockBroker(pairingResponse({ bootstrap: bootstrap(overrides) }));

  await expect(completeNotificationPairing(pairingCode(), registration)).rejects.toThrow(
    "PAIRING_BOOTSTRAP_MISMATCH",
  );
});
