import { afterEach, expect, jest, test } from "@jest/globals";

import {
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
    json: async () => ({ ok: true, operation: "status" }),
    ok: true,
  }));
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

  await sendNotificationDeviceCommand({
    bindingID: "binding-1",
    brokerOrigin: "https://push.test",
    deviceKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    operation: "status",
  });

  expect(fetch).toHaveBeenCalledTimes(1);
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
