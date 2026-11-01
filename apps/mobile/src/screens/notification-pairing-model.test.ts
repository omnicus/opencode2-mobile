import { expect, jest, test } from "@jest/globals";
import { encodeNotificationBytes } from "@opencode2-mobile/notification-protocol";
import {
  bootstrapCredential,
  cameraDeniedMessage,
  directPairingCredential,
  directPairingFallback,
  inspectPairingCode,
  type PairingPreview,
  type PairingStage,
  pairingErrorMessage,
  pairingExpiresAtMs,
  pairingPreviewApprovesHttp,
  pairingPreviewMeta,
  pairingPreviewName,
  pairingPreviewOrigin,
  pairingSecondsLeft,
} from "./notification-pairing-model";

jest.mock("expo-crypto", () => ({ randomUUID: () => "test-id" }));

const unreachable =
  "Pairing failed. Check that the OpenCode server and notification broker are reachable.";

function notificationCode(
  expiresAtMs = Date.now() + 60_000,
  authMode: "basic" | "bearer" | "none" = "bearer",
) {
  return {
    allowDevelopmentHttp: false,
    authMode,
    brokerOrigin: "https://broker.test",
    challengeID: "challenge-1",
    expiresAtMs,
    name: "Office server",
    openCodeOrigin: "https://server.test",
    pairingSecret: encodeNotificationBytes(new Uint8Array(32)),
    v: 1 as const,
  };
}

function openCodePreview(url = "https://server.test"): PairingPreview {
  const result = inspectPairingCode(
    JSON.stringify({ password: "test-password", urls: [url], username: "opencode" }),
  );
  if (!("preview" in result)) throw new Error("expected a preview");
  return result.preview;
}

test("maps known error codes to messages", () => {
  const expired = "This pairing code expired or was already used. Create a new code on the server.";
  const cases: Array<[string, string]> = [
    [
      "NOTIFICATION_PERMISSION_DENIED",
      "Notifications are disabled. Allow notifications in system settings, then try again.",
    ],
    [
      "PUSH_REQUIRES_PHYSICAL_DEVICE",
      "Remote push pairing requires a physical iOS or Android device.",
    ],
    ["PAIRING_CODE_EXPIRED", expired],
    ["PAIRING_UNAVAILABLE", expired],
    [
      "PAIRING_OPENCODE_TIMEOUT",
      "The OpenCode server did not respond within 10 seconds. Check that it is running and reachable.",
    ],
    [
      "PAIRING_OPENCODE_UNAUTHORIZED",
      "The OpenCode server rejected the credentials in this pairing code.",
    ],
    [
      "PAIRING_ORIGIN_HOST_MISMATCH",
      "OpenCode and the notification broker must use the same host for /pair setup.",
    ],
    [
      "PAIRING_OPENCODE_PORT_MISMATCH",
      "The notification broker does not allow pairing with this OpenCode port.",
    ],
    [
      "PAIRING_ISSUE_MISMATCH",
      "The notification broker returned a different server than the one you approved.",
    ],
    [
      "PAIRING_RATE_LIMITED",
      "Too many pairing attempts. Wait one minute, then create a new OpenCode code.",
    ],
    [
      "PAIRING_BROKER_IS_LOOPBACK",
      "The broker address points to this phone. Use the server's LAN or Tailscale address.",
    ],
    [
      "PAIRING_OPENCODE_IS_LOOPBACK",
      "The OpenCode address points to this phone. Use the server's LAN or Tailscale address.",
    ],
    ["PAIRING_HTTP_NOT_APPROVED", "The pairing code did not approve this unencrypted address."],
    ["INVALID_PAIRING_CODE", "The pairing code is malformed or was altered."],
    ["INVALID_OPENCODE_PAIRING_CODE", "The pairing code is malformed or was altered."],
  ];
  for (const [code, message] of cases) {
    expect(pairingErrorMessage(new Error(code), "broker-registration")).toBe(message);
  }
});

test("treats only a leading INVALID_ pairing prefix as a malformed code", () => {
  expect(pairingErrorMessage(new Error("NOT_INVALID_PAIRING"), "broker-issue")).toBe(
    "The notification broker could not verify this OpenCode pairing code.",
  );
  expect(pairingErrorMessage(new Error("INVALID_OTHER_PAIRING"))).toBe(unreachable);
});

test("maps unknown errors by pairing stage", () => {
  const cases: Array<[PairingStage | undefined, string]> = [
    [
      "push-registration",
      "Push registration failed. Check this device's notification settings and try again.",
    ],
    ["secure-storage", "The notification key could not be saved securely on this device."],
    ["pairing-save", "The notification key could not be saved securely on this device."],
    ["broker-issue", "The notification broker could not verify this OpenCode pairing code."],
    ["opencode-validation", "The paired OpenCode address or credentials could not be validated."],
    ["connection-save", "The validated OpenCode connection could not be saved on this device."],
    [undefined, unreachable],
  ];
  for (const [stage, message] of cases) {
    expect(pairingErrorMessage(new Error("unreachable"), stage)).toBe(message);
  }
  expect(pairingErrorMessage("not an error")).toBe(unreachable);
  expect(pairingErrorMessage(new Error("constructor"))).toBe(unreachable);
});

test("explains a missing EAS project ID only during push registration", () => {
  expect(pairingErrorMessage(new Error("EAS_PROJECT_ID_MISSING"), "push-registration")).toBe(
    "Push registration requires an EAS project ID in the app deployment configuration.",
  );
  expect(pairingErrorMessage(new Error("EAS_PROJECT_ID_MISSING"), "broker-issue")).toBe(
    "The notification broker could not verify this OpenCode pairing code.",
  );
});

test("includes well-formed broker error codes in broker registration failures", () => {
  expect(pairingErrorMessage(new Error("DEVICE_LIMIT"), "broker-registration")).toBe(
    "The notification broker rejected or could not complete this pairing code (DEVICE_LIMIT).",
  );
  expect(pairingErrorMessage(new Error("network down"), "broker-registration")).toBe(
    "The notification broker rejected or could not complete this pairing code.",
  );
});

test("inspects notification pairing codes", () => {
  const code = notificationCode();
  expect(inspectPairingCode(`  ${JSON.stringify(code)}\n`)).toEqual({
    preview: { code, kind: "notification" },
  });
});

test("reports an expired notification pairing code", () => {
  expect(inspectPairingCode(JSON.stringify(notificationCode(Date.now() - 1)))).toEqual({
    error: "This pairing code expired or was already used. Create a new code on the server.",
  });
});

test("inspects OpenCode /pair codes", () => {
  expect(openCodePreview("http://server.test:4096")).toEqual({
    kind: "opencode",
    prepared: {
      allowDevelopmentHttp: true,
      brokerOrigin: "http://server.test:37100",
      code: {
        password: "test-password",
        urls: ["http://server.test:4096"],
        username: "opencode",
      },
      name: "OpenCode on server.test",
      openCodeOrigin: "http://server.test:4096",
    },
  });
});

test("reports the OpenCode error when neither code format parses", () => {
  expect(
    inspectPairingCode(
      JSON.stringify({ password: "secret", urls: ["https://localhost"], username: "opencode" }),
    ),
  ).toEqual({
    error: "The OpenCode address points to this phone. Use the server's LAN or Tailscale address.",
  });
  expect(inspectPairingCode("not a pairing code")).toEqual({
    error: "The pairing code is malformed or was altered.",
  });
});

test("explains denied camera access", () => {
  expect(cameraDeniedMessage(true)).toBe(
    "Camera access was denied. Paste the pairing code instead.",
  );
  expect(cameraDeniedMessage(false)).toBe(
    "Camera access is off for this app. Turn it on in Settings, or paste the pairing code instead.",
  );
});

test("falls back to a direct connection only before the connection is saved", () => {
  const preview = openCodePreview();
  if (preview.kind !== "opencode") throw new Error("expected an OpenCode preview");
  for (const stage of [
    "push-registration",
    "broker-issue",
    "secure-storage",
    "broker-registration",
  ] as const) {
    expect(directPairingFallback(preview, stage, undefined)).toBe(preview.prepared);
  }
  for (const stage of ["opencode-validation", "connection-save", "pairing-save"] as const) {
    expect(directPairingFallback(preview, stage, undefined)).toBeUndefined();
  }
  expect(directPairingFallback(preview, "broker-issue", "connection-1")).toBeUndefined();
  expect(
    directPairingFallback(
      { code: notificationCode(), kind: "notification" },
      "broker-issue",
      undefined,
    ),
  ).toBeUndefined();
});

test("builds connection credentials", () => {
  const preview = openCodePreview();
  if (preview.kind !== "opencode") throw new Error("expected an OpenCode preview");
  expect(directPairingCredential(preview.prepared)).toEqual({
    mode: "basic",
    password: "test-password",
    schemaVersion: 1,
    username: "opencode",
  });
  expect(bootstrapCredential({ mode: "basic", password: "pw", username: "user" })).toEqual({
    mode: "basic",
    password: "pw",
    schemaVersion: 1,
    username: "user",
  });
  expect(bootstrapCredential({ mode: "bearer", token: "token" })).toEqual({
    mode: "bearer",
    schemaVersion: 1,
    token: "token",
  });
  expect(bootstrapCredential({ mode: "none" })).toBeUndefined();
});

test("counts down to a notification code's expiry", () => {
  const notification: PairingPreview = { code: notificationCode(10_500), kind: "notification" };
  expect(pairingExpiresAtMs(notification)).toBe(10_500);
  expect(pairingExpiresAtMs(openCodePreview())).toBeUndefined();
  expect(pairingExpiresAtMs(undefined)).toBeUndefined();
  expect(pairingSecondsLeft(10_500, 0)).toBe(11);
  expect(pairingSecondsLeft(10_500, 10_499)).toBe(1);
  expect(pairingSecondsLeft(10_500, 20_000)).toBe(0);
  expect(pairingSecondsLeft(undefined, 0)).toBeUndefined();
});

test("describes pairing previews", () => {
  const notification: PairingPreview = { code: notificationCode(10_500), kind: "notification" };
  expect(pairingPreviewName(notification)).toBe("Office server");
  expect(pairingPreviewOrigin(notification)).toBe("https://server.test");
  expect(pairingPreviewMeta(notification, 11)).toBe(
    "Signs in with a token. Expires in 11 seconds.",
  );
  expect(pairingPreviewMeta(notification, 0)).toBe(
    "Signs in with a token. This code expired. Create a new one on the server.",
  );
  expect(
    pairingPreviewMeta({ code: notificationCode(10_500, "basic"), kind: "notification" }, 5),
  ).toBe("Signs in with a username and password. Expires in 5 seconds.");
  expect(
    pairingPreviewMeta({ code: notificationCode(10_500, "none"), kind: "notification" }, 5),
  ).toBe("No sign-in needed. Expires in 5 seconds.");
  expect(pairingPreviewApprovesHttp(notification)).toBe(false);
  expect(pairingPreviewApprovesHttp(undefined)).toBe(false);

  const https = openCodePreview();
  expect(pairingPreviewName(https)).toBe("OpenCode on server.test");
  expect(pairingPreviewOrigin(https)).toBe("https://server.test");
  expect(pairingPreviewMeta(https, undefined)).toBe("Signs in with a username and password.");
  expect(pairingPreviewApprovesHttp(https)).toBe(false);

  const http = openCodePreview("http://server.test:4096");
  expect(pairingPreviewMeta(http, undefined)).toBe(
    "Signs in with a username and password. Uses HTTP, which is not encrypted.",
  );
  expect(pairingPreviewApprovesHttp(http)).toBe(true);
});
