import { describe, expect, it, vi } from "vitest";

import {
  decodeNotificationBytes,
  encodeNotificationBytes,
  notificationPushAdditionalData,
  openNotificationJson,
  parseNotificationConnectionBootstrap,
  parseNotificationDeliveryState,
  parseNotificationDeviceCommand,
  parseNotificationPairingCode,
  parseNotificationPairingIssueRequest,
  parseNotificationPairingRegistration,
  parseNotificationPluginEvent,
  parseNotificationRoutingEnvelope,
  parseOpenCodeDevicePairingCode,
  parseOpenCodePairingInvite,
  sealNotificationJson,
} from "./index.js";

describe("notification protocol", () => {
  it("round trips an authenticated routing envelope", () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const nonce = Uint8Array.from({ length: 24 }, (_, index) => index + 32);
    const route = {
      bindingID: "binding-1",
      eventID: "evt_1",
      expiresAtMs: 2_000,
      interaction: "permission",
      issuedAtMs: 1_000,
      kind: "interaction",
      requestID: "per_1",
      sessionID: "ses_1",
      v: 1,
    } as const;
    const ciphertext = sealNotificationJson(
      key,
      nonce,
      route,
      notificationPushAdditionalData(route.bindingID),
    );

    expect(
      parseNotificationRoutingEnvelope(
        openNotificationJson(
          key,
          nonce,
          ciphertext,
          notificationPushAdditionalData(route.bindingID),
        ),
      ),
    ).toEqual(route);
    expect(() =>
      openNotificationJson(
        key,
        nonce,
        ciphertext,
        notificationPushAdditionalData("another-binding"),
      ),
    ).toThrow("INVALID_NOTIFICATION_CIPHERTEXT");
  });

  it("requires a location for global forms", () => {
    expect(() =>
      parseNotificationRoutingEnvelope({
        bindingID: "binding-1",
        eventID: "evt_1",
        expiresAtMs: 2_000,
        interaction: "form",
        issuedAtMs: 1_000,
        kind: "interaction",
        requestID: "frm_1",
        sessionID: "global",
        v: 1,
      }),
    ).toThrow("INVALID_NOTIFICATION_ROUTE");
  });

  it("parses session completion routes and plugin events", () => {
    expect(
      parseNotificationRoutingEnvelope({
        bindingID: "binding-1",
        eventID: "evt_done",
        expiresAtMs: 2_000,
        issuedAtMs: 1_000,
        kind: "session-done",
        sessionID: "ses_1",
        v: 1,
      }),
    ).toMatchObject({ kind: "session-done", sessionID: "ses_1" });
    expect(
      parseNotificationPluginEvent({
        category: "session-done",
        eventID: "evt_done",
        kind: "session-done",
        observedAtMs: 1_000,
        sessionID: "ses_1",
        v: 1,
      }),
    ).toMatchObject({ category: "session-done", kind: "session-done" });
  });

  it("defaults old queued interactions safely and rejects arbitrary categories", () => {
    expect(
      parseNotificationPluginEvent({
        eventID: "evt_old",
        interaction: "permission",
        observedAtMs: 1_000,
        requestID: "per_1",
        sessionID: "ses_1",
        state: "pending",
        v: 1,
      }),
    ).toMatchObject({ category: "permission-other", kind: "interaction" });
    expect(() =>
      parseNotificationPluginEvent({
        category: "permission-private-action",
        eventID: "evt_1",
        interaction: "permission",
        observedAtMs: 1_000,
        requestID: "per_1",
        sessionID: "ses_1",
        state: "pending",
        v: 1,
      }),
    ).toThrow("INVALID_PLUGIN_EVENT");
    expect(() =>
      parseNotificationPluginEvent({
        category: "permission-shell",
        eventID: "evt_done",
        kind: "session-done",
        observedAtMs: 1_000,
        sessionID: "ses_1",
        v: 1,
      }),
    ).toThrow("INVALID_PLUGIN_EVENT");
  });

  it("validates pairing origins and key sizes", () => {
    const pairingSecret = encodeNotificationBytes(new Uint8Array(32).fill(7));
    expect(
      parseNotificationPairingCode({
        allowDevelopmentHttp: true,
        authMode: "none",
        brokerOrigin: "http://broker.example",
        challengeID: "challenge-1",
        expiresAtMs: 2_000,
        name: "Workstation",
        openCodeOrigin: "http://server.example:4096",
        pairingSecret,
        v: 1,
      }),
    ).toMatchObject({ challengeID: "challenge-1", pairingSecret });
    expect(() => decodeNotificationBytes("bad", 32)).toThrow("INVALID_NOTIFICATION_BYTES");
  });

  it("parses OpenCode device pairing codes", () => {
    expect(
      parseOpenCodeDevicePairingCode(
        JSON.stringify({
          password: "secret",
          urls: ["http://100.64.0.10:4096", "https://code.example.test"],
          username: "opencode",
        }),
      ),
    ).toEqual({
      password: "secret",
      urls: ["http://100.64.0.10:4096", "https://code.example.test"],
      username: "opencode",
    });
    expect(() =>
      parseOpenCodeDevicePairingCode({
        password: "secret",
        urls: ["http://user:secret@server.test"],
        username: "opencode",
      }),
    ).toThrow("INVALID_OPENCODE_PAIRING_CODE");
    expect(
      parseOpenCodeDevicePairingCode({
        password: "  exact password  ",
        urls: ["https://server.test"],
        username: " opencode ",
      }),
    ).toMatchObject({ password: "  exact password  ", username: " opencode " });
    expect(() =>
      parseOpenCodeDevicePairingCode({
        password: "secret",
        urls: ["https://server.test"],
        username: "open:code",
      }),
    ).toThrow("INVALID_OPENCODE_PAIRING_CODE");
  });

  it("reads the code and origin from an `opencode pair` link", () => {
    expect(
      parseOpenCodePairingInvite(" http://100.64.0.1:4096/auth/connect/U4Jdtxl7zwcnJI7yHEnUMQ\n"),
    ).toEqual({ code: "U4Jdtxl7zwcnJI7yHEnUMQ", urls: ["http://100.64.0.1:4096"] });
    expect(
      parseOpenCodePairingInvite("https://code.example.test/auth/connect/abc-DEF_123"),
    ).toEqual({ code: "abc-DEF_123", urls: ["https://code.example.test"] });
  });

  it("reads the code and URLs from an `opencode pair` QR", () => {
    expect(
      parseOpenCodePairingInvite(
        '{"code":"U4Jdtxl7zwcnJI7yHEnUMQ","urls":["http://127.0.0.1:4096","http://100.64.0.1:4096"]}',
      ),
    ).toEqual({
      code: "U4Jdtxl7zwcnJI7yHEnUMQ",
      urls: ["http://127.0.0.1:4096", "http://100.64.0.1:4096"],
    });
  });

  // React Native's URL appends a slash to any path without one and accepts malformed input.
  it("reads a pairing link with React Native's URL", () => {
    const NativeUrl = globalThis.URL;
    class ReactNativeUrl extends NativeUrl {
      constructor(value: string) {
        super(value.endsWith("/") || /[?#]/.test(value) ? value : `${value}/`);
      }
    }
    vi.stubGlobal("URL", ReactNativeUrl);
    try {
      expect(
        parseOpenCodePairingInvite("http://100.64.0.1:4096/auth/connect/U4Jdtxl7zwcnJI7yHEnUMQ"),
      ).toEqual({ code: "U4Jdtxl7zwcnJI7yHEnUMQ", urls: ["http://100.64.0.1:4096"] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    "not a link",
    '{"password":"secret","urls":["http://100.64.0.1:4096"],"username":"opencode"}',
    '{"code":"short","urls":["http://100.64.0.1:4096"]}',
    '{"code":"U4Jdtxl7zwcnJI7yHEnUMQ","urls":[]}',
    '{"code":"U4Jdtxl7zwcnJI7yHEnUMQ","urls":["http://100.64.0.1:4096/path"]}',
    "ftp://100.64.0.1/auth/connect/U4Jdtxl7zwcnJI7yHEnUMQ",
    "http://user:secret@100.64.0.1:4096/auth/connect/U4Jdtxl7zwcnJI7yHEnUMQ",
    "http://100.64.0.1:4096/auth/connect/U4Jdtxl7zwcnJI7yHEnUMQ?next=/",
    "http://100.64.0.1:4096/auth/connect/U4Jdtxl7zwcnJI7yHEnUMQ#fragment",
    "http://100.64.0.1:4096/auth/connect/U4Jdtxl7zwcnJI7yHEnUMQ/extra",
    "http://100.64.0.1:4096/prefix/auth/connect/U4Jdtxl7zwcnJI7yHEnUMQ",
    "http://100.64.0.1:4096/auth/connect/short",
    "http://100.64.0.1:4096/auth/connect/has%20space",
  ])("rejects the pairing invite %s", (value) => {
    expect(() => parseOpenCodePairingInvite(value)).toThrow("INVALID_OPENCODE_PAIRING_LINK");
  });

  it("requires explicit approval for HTTP pairing issue requests", () => {
    expect(() =>
      parseNotificationPairingIssueRequest({
        allowDevelopmentHttp: false,
        name: "Workstation",
        openCodeOrigin: "http://100.64.0.10:4096",
        password: "secret",
        username: "opencode",
        v: 1,
      }),
    ).toThrow("INVALID_PAIRING_ISSUE_REQUEST");
  });

  it("preserves credentials through pairing issue and bootstrap parsing", () => {
    expect(
      parseNotificationPairingIssueRequest({
        allowDevelopmentHttp: false,
        name: "Workstation",
        openCodeOrigin: "https://server.test",
        password: "  exact password  ",
        username: " opencode ",
        v: 1,
      }),
    ).toMatchObject({ password: "  exact password  ", username: " opencode " });
    expect(
      parseNotificationConnectionBootstrap({
        allowDevelopmentHttp: false,
        auth: { mode: "bearer", token: "  exact token  " },
        baseUrl: "https://server.test",
        name: "Workstation",
        v: 1,
      }),
    ).toMatchObject({ auth: { mode: "bearer", token: "  exact token  " } });
  });

  it("validates shared notification delivery state", () => {
    expect(parseNotificationDeliveryState({ enabled: false, updatedAtMs: 1_000, v: 1 })).toEqual({
      enabled: false,
      updatedAtMs: 1_000,
      v: 1,
    });
    expect(() =>
      parseNotificationDeliveryState({ enabled: "false", updatedAtMs: 1_000, v: 1 }),
    ).toThrow("INVALID_NOTIFICATION_STATE");
  });

  it.each(["enable", "pause", "revoke", "status", "test"] as const)(
    "parses the %s device command without a push token",
    (operation) => {
      expect(
        parseNotificationDeviceCommand({
          atMs: 1_000,
          expoPushToken: "ExpoPushToken[ignored]",
          nonceID: "nonce-1",
          operation,
          v: 1,
        }),
      ).toEqual({ atMs: 1_000, nonceID: "nonce-1", operation, v: 1 });
    },
  );

  it("parses a device token rotation", () => {
    expect(
      parseNotificationDeviceCommand({
        atMs: 0,
        expoPushToken: " ExponentPushToken[abc_-1] ",
        nonceID: "nonce-1",
        operation: "token",
        v: 1,
      }),
    ).toEqual({
      atMs: 0,
      expoPushToken: "ExponentPushToken[abc_-1]",
      nonceID: "nonce-1",
      operation: "token",
      v: 1,
    });
  });

  it.each([
    ["a non-object", "status"],
    ["an array", [{ atMs: 1_000, nonceID: "nonce-1", operation: "status", v: 1 }]],
    ["another version", { atMs: 1_000, nonceID: "nonce-1", operation: "status", v: 2 }],
    ["a missing operation", { atMs: 1_000, nonceID: "nonce-1", v: 1 }],
    ["an unknown operation", { atMs: 1_000, nonceID: "nonce-1", operation: "delete", v: 1 }],
    ["a negative time", { atMs: -1, nonceID: "nonce-1", operation: "status", v: 1 }],
    ["a fractional time", { atMs: 1.5, nonceID: "nonce-1", operation: "status", v: 1 }],
    ["a string time", { atMs: "1000", nonceID: "nonce-1", operation: "status", v: 1 }],
    ["a missing nonce", { atMs: 1_000, operation: "status", v: 1 }],
    ["an unsafe nonce", { atMs: 1_000, nonceID: "nonce/1", operation: "status", v: 1 }],
    ["a long nonce", { atMs: 1_000, nonceID: "n".repeat(129), operation: "status", v: 1 }],
    ["a missing push token", { atMs: 1_000, nonceID: "nonce-1", operation: "token", v: 1 }],
    [
      "a malformed push token",
      {
        atMs: 1_000,
        expoPushToken: "PushToken[abc]",
        nonceID: "nonce-1",
        operation: "token",
        v: 1,
      },
    ],
  ])("rejects a device command with %s", (_, value) => {
    expect(() => parseNotificationDeviceCommand(value)).toThrow("INVALID_DEVICE_COMMAND");
  });

  it("parses device pairing registrations", () => {
    const registration = {
      bindingID: "binding-1",
      deviceKey: encodeNotificationBytes(new Uint8Array(32).fill(3)),
      deviceName: " Phone ",
      expoPushToken: "ExpoPushToken[abc]",
      platform: "ios",
      v: 1,
    } as const;
    expect(parseNotificationPairingRegistration(registration)).toEqual({
      ...registration,
      deviceName: "Phone",
    });
    expect(
      parseNotificationPairingRegistration({ ...registration, platform: "android" }),
    ).toMatchObject({ platform: "android" });
    for (const value of [
      null,
      { ...registration, v: 2 },
      { ...registration, deviceKey: encodeNotificationBytes(new Uint8Array(16)) },
      { ...registration, platform: "web" },
      { ...registration, bindingID: "" },
      { ...registration, deviceName: "  " },
      { ...registration, expoPushToken: "ExpoPushToken[]" },
    ]) {
      expect(() => parseNotificationPairingRegistration(value)).toThrow(
        "INVALID_PAIRING_REGISTRATION",
      );
    }
  });
});
