import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils";
import { Base64 } from "js-base64";

export const notificationProtocolVersion = 1 as const;
export const notificationDeviceKeyBytes = 32;
export const notificationNonceBytes = 24;
export const notificationPairingLifetimeMs = 2 * 60_000;

export type NotificationAuthMode = "basic" | "bearer" | "none";
export type NotificationInteraction = "form" | "permission";
export type NotificationCategory =
  | "form"
  | "permission-edit"
  | "permission-execute"
  | "permission-external-directory"
  | "permission-glob"
  | "permission-grep"
  | "permission-other"
  | "permission-question"
  | "permission-read"
  | "permission-shell"
  | "permission-skill"
  | "permission-subagent"
  | "permission-webfetch"
  | "permission-websearch"
  | "session-done"
  | "test";

export type NotificationPairingCode = {
  allowDevelopmentHttp: boolean;
  authMode: NotificationAuthMode;
  brokerOrigin: string;
  challengeID: string;
  expiresAtMs: number;
  name: string;
  openCodeOrigin: string;
  pairingSecret: string;
  v: 1;
};

export type OpenCodeDevicePairingCode = {
  password: string;
  urls: string[];
  username: string;
};

export type NotificationPairingIssueRequest = {
  allowDevelopmentHttp: boolean;
  name: string;
  openCodeOrigin: string;
  password: string;
  username: string;
  v: 1;
};

export type NotificationConnectionBootstrap = {
  allowDevelopmentHttp: boolean;
  auth:
    | { mode: "basic"; password: string; username: string }
    | { mode: "bearer"; token: string }
    | { mode: "none" };
  baseUrl: string;
  name: string;
  v: 1;
};

export type NotificationPairingRegistration = {
  bindingID: string;
  deviceKey: string;
  deviceName: string;
  expoPushToken: string;
  platform: "android" | "ios";
  v: 1;
};

export type NotificationPairingRequest = {
  challengeID: string;
  ciphertext: string;
  nonce: string;
  v: 1;
};

export type NotificationPairingResponse = {
  bootstrapCiphertext: string;
  bootstrapNonce: string;
  brokerID: string;
  metadataCiphertext: string;
  metadataNonce: string;
  pairedAtMs: number;
  v: 1;
};

export type NotificationPushData = {
  bindingID: string;
  ciphertext: string;
  nonce: string;
  v: 1;
};

export type NotificationRoutingEnvelope =
  | {
      bindingID: string;
      eventID: string;
      expiresAtMs: number;
      interaction: NotificationInteraction;
      issuedAtMs: number;
      kind: "interaction";
      location?: { directory: string; workspaceID?: string };
      requestID: string;
      sessionID: string;
      v: 1;
    }
  | {
      bindingID: string;
      eventID: string;
      expiresAtMs: number;
      issuedAtMs: number;
      kind: "session-done";
      sessionID: string;
      v: 1;
    }
  | {
      bindingID: string;
      expiresAtMs: number;
      issuedAtMs: number;
      kind: "test";
      v: 1;
    };

export type NotificationPluginEvent =
  | {
      category: Exclude<NotificationCategory, "session-done" | "test">;
      eventID: string;
      interaction: NotificationInteraction;
      kind: "interaction";
      location?: { directory: string; workspaceID?: string };
      observedAtMs: number;
      requestID: string;
      sessionID: string;
      state: "pending" | "resolved";
      v: 1;
    }
  | {
      category: "session-done";
      eventID: string;
      kind: "session-done";
      observedAtMs: number;
      sessionID: string;
      v: 1;
    };

export type NotificationDeviceRequest = {
  bindingID: string;
  ciphertext: string;
  nonce: string;
  v: 1;
};

export type NotificationDeviceCommand = {
  atMs: number;
  expoPushToken?: string;
  nonceID: string;
  operation: "enable" | "pause" | "revoke" | "status" | "test" | "token";
  v: 1;
};

export type NotificationDeliveryState = {
  enabled: boolean;
  updatedAtMs: number;
  v: 1;
};

export function encodeNotificationPairingCode(value: NotificationPairingCode) {
  return JSON.stringify(parseNotificationPairingCode(value));
}

export function parseNotificationPairingCode(value: unknown): NotificationPairingCode {
  const input = typeof value === "string" ? parseJson(value, "INVALID_PAIRING_CODE") : value;
  if (!isRecord(input) || input.v !== 1) throw new Error("INVALID_PAIRING_CODE");
  const brokerOrigin = parseOrigin(input.brokerOrigin, "INVALID_PAIRING_CODE");
  const openCodeOrigin = parseOrigin(input.openCodeOrigin, "INVALID_PAIRING_CODE");
  const authMode = parseAuthMode(input.authMode, "INVALID_PAIRING_CODE");
  const pairingSecret = parseBase64Bytes(
    input.pairingSecret,
    notificationDeviceKeyBytes,
    "INVALID_PAIRING_CODE",
  );
  void pairingSecret;
  return {
    allowDevelopmentHttp: parseBoolean(input.allowDevelopmentHttp, "INVALID_PAIRING_CODE"),
    authMode,
    brokerOrigin,
    challengeID: parseIdentifier(input.challengeID, 128, "INVALID_PAIRING_CODE"),
    expiresAtMs: parseTimestamp(input.expiresAtMs, "INVALID_PAIRING_CODE"),
    name: parseText(input.name, 80, "INVALID_PAIRING_CODE"),
    openCodeOrigin,
    pairingSecret: String(input.pairingSecret),
    v: 1,
  };
}

export function parseOpenCodeDevicePairingCode(value: unknown): OpenCodeDevicePairingCode {
  const input =
    typeof value === "string" ? parseJson(value, "INVALID_OPENCODE_PAIRING_CODE") : value;
  if (
    !isRecord(input) ||
    !Array.isArray(input.urls) ||
    input.urls.length === 0 ||
    input.urls.length > 16
  ) {
    throw new Error("INVALID_OPENCODE_PAIRING_CODE");
  }
  const username = parseBasicUsername(input.username, "INVALID_OPENCODE_PAIRING_CODE");
  return {
    password: parseCredentialText(input.password, 2_048, "INVALID_OPENCODE_PAIRING_CODE"),
    urls: input.urls.map((url) => parseOrigin(url, "INVALID_OPENCODE_PAIRING_CODE")),
    username,
  };
}

export function parseNotificationPairingIssueRequest(
  value: unknown,
): NotificationPairingIssueRequest {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_PAIRING_ISSUE_REQUEST");
  const openCodeOrigin = parseOrigin(value.openCodeOrigin, "INVALID_PAIRING_ISSUE_REQUEST");
  const allowDevelopmentHttp = parseBoolean(
    value.allowDevelopmentHttp,
    "INVALID_PAIRING_ISSUE_REQUEST",
  );
  if (openCodeOrigin.startsWith("http:") && !allowDevelopmentHttp) {
    throw new Error("INVALID_PAIRING_ISSUE_REQUEST");
  }
  return {
    allowDevelopmentHttp,
    name: parseText(value.name, 80, "INVALID_PAIRING_ISSUE_REQUEST"),
    openCodeOrigin,
    password: parseCredentialText(value.password, 2_048, "INVALID_PAIRING_ISSUE_REQUEST"),
    username: parseBasicUsername(value.username, "INVALID_PAIRING_ISSUE_REQUEST"),
    v: 1,
  };
}

export function parseNotificationConnectionBootstrap(
  value: unknown,
): NotificationConnectionBootstrap {
  if (!isRecord(value) || value.v !== 1 || !isRecord(value.auth)) {
    throw new Error("INVALID_CONNECTION_BOOTSTRAP");
  }
  const baseUrl = parseOrigin(value.baseUrl, "INVALID_CONNECTION_BOOTSTRAP");
  const allowDevelopmentHttp = parseBoolean(
    value.allowDevelopmentHttp,
    "INVALID_CONNECTION_BOOTSTRAP",
  );
  if (baseUrl.startsWith("http:") && !allowDevelopmentHttp) {
    throw new Error("INVALID_CONNECTION_BOOTSTRAP");
  }
  const mode = parseAuthMode(value.auth.mode, "INVALID_CONNECTION_BOOTSTRAP");
  const auth =
    mode === "basic"
      ? {
          mode,
          password: parseCredentialText(value.auth.password, 2_048, "INVALID_CONNECTION_BOOTSTRAP"),
          username: parseBasicUsername(value.auth.username, "INVALID_CONNECTION_BOOTSTRAP"),
        }
      : mode === "bearer"
        ? {
            mode,
            token: parseCredentialText(value.auth.token, 2_048, "INVALID_CONNECTION_BOOTSTRAP"),
          }
        : { mode };
  return {
    allowDevelopmentHttp,
    auth,
    baseUrl,
    name: parseText(value.name, 80, "INVALID_CONNECTION_BOOTSTRAP"),
    v: 1,
  };
}

export function parseNotificationPairingRegistration(
  value: unknown,
): NotificationPairingRegistration {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_PAIRING_REGISTRATION");
  parseBase64Bytes(value.deviceKey, notificationDeviceKeyBytes, "INVALID_PAIRING_REGISTRATION");
  const platform = value.platform;
  if (platform !== "android" && platform !== "ios") {
    throw new Error("INVALID_PAIRING_REGISTRATION");
  }
  return {
    bindingID: parseIdentifier(value.bindingID, 128, "INVALID_PAIRING_REGISTRATION"),
    deviceKey: String(value.deviceKey),
    deviceName: parseText(value.deviceName, 80, "INVALID_PAIRING_REGISTRATION"),
    expoPushToken: parseExpoPushToken(value.expoPushToken, "INVALID_PAIRING_REGISTRATION"),
    platform,
    v: 1,
  };
}

export function parseNotificationPairingRequest(value: unknown): NotificationPairingRequest {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_PAIRING_REQUEST");
  parseBase64Bytes(value.nonce, notificationNonceBytes, "INVALID_PAIRING_REQUEST");
  parseCiphertext(value.ciphertext, "INVALID_PAIRING_REQUEST");
  return {
    challengeID: parseIdentifier(value.challengeID, 128, "INVALID_PAIRING_REQUEST"),
    ciphertext: String(value.ciphertext),
    nonce: String(value.nonce),
    v: 1,
  };
}

export function parseNotificationPairingResponse(value: unknown): NotificationPairingResponse {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_PAIRING_RESPONSE");
  parseBase64Bytes(value.bootstrapNonce, notificationNonceBytes, "INVALID_PAIRING_RESPONSE");
  parseCiphertext(value.bootstrapCiphertext, "INVALID_PAIRING_RESPONSE");
  parseBase64Bytes(value.metadataNonce, notificationNonceBytes, "INVALID_PAIRING_RESPONSE");
  parseCiphertext(value.metadataCiphertext, "INVALID_PAIRING_RESPONSE");
  return {
    bootstrapCiphertext: String(value.bootstrapCiphertext),
    bootstrapNonce: String(value.bootstrapNonce),
    brokerID: parseIdentifier(value.brokerID, 128, "INVALID_PAIRING_RESPONSE"),
    metadataCiphertext: String(value.metadataCiphertext),
    metadataNonce: String(value.metadataNonce),
    pairedAtMs: parseTimestamp(value.pairedAtMs, "INVALID_PAIRING_RESPONSE"),
    v: 1,
  };
}

export function parseNotificationPushData(value: unknown): NotificationPushData {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_NOTIFICATION_DATA");
  parseBase64Bytes(value.nonce, notificationNonceBytes, "INVALID_NOTIFICATION_DATA");
  parseCiphertext(value.ciphertext, "INVALID_NOTIFICATION_DATA");
  return {
    bindingID: parseIdentifier(value.bindingID, 128, "INVALID_NOTIFICATION_DATA"),
    ciphertext: String(value.ciphertext),
    nonce: String(value.nonce),
    v: 1,
  };
}

export function parseNotificationRoutingEnvelope(value: unknown): NotificationRoutingEnvelope {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_NOTIFICATION_ROUTE");
  const base = {
    bindingID: parseIdentifier(value.bindingID, 128, "INVALID_NOTIFICATION_ROUTE"),
    expiresAtMs: parseTimestamp(value.expiresAtMs, "INVALID_NOTIFICATION_ROUTE"),
    issuedAtMs: parseTimestamp(value.issuedAtMs, "INVALID_NOTIFICATION_ROUTE"),
    v: 1 as const,
  };
  if (value.kind === "test") return { ...base, kind: "test" };
  if (value.kind === "session-done") {
    return {
      ...base,
      eventID: parseIdentifier(value.eventID, 160, "INVALID_NOTIFICATION_ROUTE"),
      kind: "session-done",
      sessionID: parseSessionID(value.sessionID, "INVALID_NOTIFICATION_ROUTE"),
    };
  }
  if (value.kind !== "interaction") throw new Error("INVALID_NOTIFICATION_ROUTE");
  const interaction = parseInteraction(value.interaction, "INVALID_NOTIFICATION_ROUTE");
  const sessionID = parseSessionOwner(value.sessionID, "INVALID_NOTIFICATION_ROUTE");
  const location = value.location === undefined ? undefined : parseLocation(value.location);
  if (sessionID === "global" && (!location || interaction !== "form")) {
    throw new Error("INVALID_NOTIFICATION_ROUTE");
  }
  return {
    ...base,
    eventID: parseIdentifier(value.eventID, 160, "INVALID_NOTIFICATION_ROUTE"),
    interaction,
    kind: "interaction",
    ...(location ? { location } : {}),
    requestID: parseRequestID(value.requestID, interaction, "INVALID_NOTIFICATION_ROUTE"),
    sessionID,
  };
}

export function parseNotificationPluginEvent(value: unknown): NotificationPluginEvent {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_PLUGIN_EVENT");
  if (value.kind === "session-done") {
    if (value.category !== undefined && value.category !== "session-done") {
      throw new Error("INVALID_PLUGIN_EVENT");
    }
    return {
      category: "session-done",
      eventID: parseIdentifier(value.eventID, 160, "INVALID_PLUGIN_EVENT"),
      kind: "session-done",
      observedAtMs: parseTimestamp(value.observedAtMs, "INVALID_PLUGIN_EVENT"),
      sessionID: parseSessionID(value.sessionID, "INVALID_PLUGIN_EVENT"),
      v: 1,
    };
  }
  const interaction = parseInteraction(value.interaction, "INVALID_PLUGIN_EVENT");
  const state = value.state;
  if (state !== "pending" && state !== "resolved") throw new Error("INVALID_PLUGIN_EVENT");
  const location = value.location === undefined ? undefined : parseLocation(value.location);
  const sessionID = parseSessionOwner(value.sessionID, "INVALID_PLUGIN_EVENT");
  if (sessionID === "global" && (!location || interaction !== "form")) {
    throw new Error("INVALID_PLUGIN_EVENT");
  }
  return {
    category: parseInteractionCategory(value.category, interaction, "INVALID_PLUGIN_EVENT"),
    eventID: parseIdentifier(value.eventID, 160, "INVALID_PLUGIN_EVENT"),
    interaction,
    kind: "interaction",
    ...(location ? { location } : {}),
    observedAtMs: parseTimestamp(value.observedAtMs, "INVALID_PLUGIN_EVENT"),
    requestID: parseRequestID(value.requestID, interaction, "INVALID_PLUGIN_EVENT"),
    sessionID,
    state,
    v: 1,
  };
}

export function parseNotificationDeviceRequest(value: unknown): NotificationDeviceRequest {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_DEVICE_REQUEST");
  parseBase64Bytes(value.nonce, notificationNonceBytes, "INVALID_DEVICE_REQUEST");
  parseCiphertext(value.ciphertext, "INVALID_DEVICE_REQUEST");
  return {
    bindingID: parseIdentifier(value.bindingID, 128, "INVALID_DEVICE_REQUEST"),
    ciphertext: String(value.ciphertext),
    nonce: String(value.nonce),
    v: 1,
  };
}

export function parseNotificationDeviceCommand(value: unknown): NotificationDeviceCommand {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_DEVICE_COMMAND");
  const operation = value.operation;
  if (
    operation !== "enable" &&
    operation !== "pause" &&
    operation !== "revoke" &&
    operation !== "status" &&
    operation !== "test" &&
    operation !== "token"
  ) {
    throw new Error("INVALID_DEVICE_COMMAND");
  }
  return {
    atMs: parseTimestamp(value.atMs, "INVALID_DEVICE_COMMAND"),
    ...(operation === "token"
      ? { expoPushToken: parseExpoPushToken(value.expoPushToken, "INVALID_DEVICE_COMMAND") }
      : {}),
    nonceID: parseIdentifier(value.nonceID, 128, "INVALID_DEVICE_COMMAND"),
    operation,
    v: 1,
  };
}

export function parseNotificationDeliveryState(value: unknown): NotificationDeliveryState {
  if (!isRecord(value) || value.v !== 1) throw new Error("INVALID_NOTIFICATION_STATE");
  return {
    enabled: parseBoolean(value.enabled, "INVALID_NOTIFICATION_STATE"),
    updatedAtMs: parseTimestamp(value.updatedAtMs, "INVALID_NOTIFICATION_STATE"),
    v: 1,
  };
}

export function sealNotificationJson(
  key: Uint8Array,
  nonce: Uint8Array,
  value: unknown,
  additionalData: string,
) {
  assertBytes(key, notificationDeviceKeyBytes, "INVALID_NOTIFICATION_KEY");
  assertBytes(nonce, notificationNonceBytes, "INVALID_NOTIFICATION_NONCE");
  const plaintext = utf8ToBytes(JSON.stringify(value));
  if (plaintext.byteLength > 8_192) throw new Error("NOTIFICATION_PAYLOAD_TOO_LARGE");
  return Base64.fromUint8Array(
    xchacha20poly1305(key, nonce, utf8ToBytes(additionalData)).encrypt(plaintext),
    true,
  );
}

export function openNotificationJson(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: string,
  additionalData: string,
): unknown {
  assertBytes(key, notificationDeviceKeyBytes, "INVALID_NOTIFICATION_KEY");
  assertBytes(nonce, notificationNonceBytes, "INVALID_NOTIFICATION_NONCE");
  const encrypted = parseBase64Bytes(ciphertext, undefined, "INVALID_NOTIFICATION_CIPHERTEXT");
  if (encrypted.byteLength < 17 || encrypted.byteLength > 8_208) {
    throw new Error("INVALID_NOTIFICATION_CIPHERTEXT");
  }
  try {
    const plaintext = xchacha20poly1305(key, nonce, utf8ToBytes(additionalData)).decrypt(encrypted);
    return parseJson(bytesToUtf8(plaintext), "INVALID_NOTIFICATION_CIPHERTEXT");
  } catch {
    throw new Error("INVALID_NOTIFICATION_CIPHERTEXT");
  }
}

export function encodeNotificationBytes(bytes: Uint8Array) {
  return Base64.fromUint8Array(bytes, true);
}

export function decodeNotificationBytes(value: string, expectedBytes?: number) {
  return parseBase64Bytes(value, expectedBytes, "INVALID_NOTIFICATION_BYTES");
}

export function notificationPairingAdditionalData(challengeID: string) {
  return `opencode-mobile:pairing:v1:${challengeID}`;
}

export function notificationBootstrapAdditionalData(challengeID: string) {
  return `opencode-mobile:bootstrap:v1:${challengeID}`;
}

export function notificationPairingResponseAdditionalData(challengeID: string) {
  return `opencode-mobile:pairing-response:v1:${challengeID}`;
}

export function notificationPushAdditionalData(bindingID: string) {
  return `opencode-mobile:push:v1:${bindingID}`;
}

export function notificationDeviceAdditionalData(bindingID: string, operation: string) {
  return `opencode-mobile:device:v1:${bindingID}:${operation}`;
}

function parseLocation(value: unknown) {
  if (!isRecord(value)) throw new Error("INVALID_NOTIFICATION_LOCATION");
  const directory = parseText(value.directory, 4_096, "INVALID_NOTIFICATION_LOCATION");
  const workspaceID =
    value.workspaceID === undefined
      ? undefined
      : parseIdentifier(value.workspaceID, 160, "INVALID_NOTIFICATION_LOCATION");
  return { directory, ...(workspaceID ? { workspaceID } : {}) };
}

function parseRequestID(value: unknown, interaction: NotificationInteraction, error: string) {
  const id = parseIdentifier(value, 160, error);
  if (interaction === "form" ? !id.startsWith("frm_") : !id.startsWith("per_")) {
    throw new Error(error);
  }
  return id;
}

function parseSessionOwner(value: unknown, error: string) {
  const id = parseIdentifier(value, 160, error);
  if (id !== "global" && !id.startsWith("ses")) throw new Error(error);
  return id;
}

function parseSessionID(value: unknown, error: string) {
  const id = parseIdentifier(value, 160, error);
  if (!id.startsWith("ses")) throw new Error(error);
  return id;
}

function parseInteractionCategory(
  value: unknown,
  interaction: NotificationInteraction,
  error: string,
): Exclude<NotificationCategory, "session-done" | "test"> {
  if (interaction === "form") {
    if (value !== undefined && value !== "form") throw new Error(error);
    return "form";
  }
  if (value === undefined) return "permission-other";
  if (
    value !== "permission-edit" &&
    value !== "permission-execute" &&
    value !== "permission-external-directory" &&
    value !== "permission-glob" &&
    value !== "permission-grep" &&
    value !== "permission-other" &&
    value !== "permission-question" &&
    value !== "permission-read" &&
    value !== "permission-shell" &&
    value !== "permission-skill" &&
    value !== "permission-subagent" &&
    value !== "permission-webfetch" &&
    value !== "permission-websearch"
  ) {
    throw new Error(error);
  }
  return value;
}

function parseExpoPushToken(value: unknown, error: string) {
  const token = parseText(value, 512, error);
  if (!/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(token)) throw new Error(error);
  return token;
}

function parseCiphertext(value: unknown, error: string) {
  const bytes = parseBase64Bytes(value, undefined, error);
  if (bytes.byteLength < 17 || bytes.byteLength > 8_208) throw new Error(error);
}

function parseBase64Bytes(value: unknown, expectedBytes: number | undefined, error: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 12_000) {
    throw new Error(error);
  }
  let bytes: Uint8Array;
  try {
    bytes = Base64.toUint8Array(value);
  } catch {
    throw new Error(error);
  }
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) throw new Error(error);
  if (Base64.fromUint8Array(bytes, true).replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error(error);
  }
  return bytes;
}

function parseInteraction(value: unknown, error: string): NotificationInteraction {
  if (value !== "form" && value !== "permission") throw new Error(error);
  return value;
}

function parseAuthMode(value: unknown, error: string): NotificationAuthMode {
  if (value !== "basic" && value !== "bearer" && value !== "none") throw new Error(error);
  return value;
}

function parseOrigin(value: unknown, error: string) {
  if (typeof value !== "string") throw new Error(error);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(error);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(error);
  }
  return url.origin;
}

function parseIdentifier(value: unknown, maxLength: number, error: string) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error(error);
  }
  return value;
}

function parseText(value: unknown, maxLength: number, error: string) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(error);
  }
  return value.trim();
}

function parseCredentialText(value: unknown, maxLength: number, error: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(error);
  }
  return value;
}

function parseBasicUsername(value: unknown, error: string) {
  const username = parseCredentialText(value, 256, error);
  if (username.includes(":")) throw new Error(error);
  return username;
}

function parseTimestamp(value: unknown, error: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(error);
  return Number(value);
}

function parseBoolean(value: unknown, error: string) {
  if (typeof value !== "boolean") throw new Error(error);
  return value;
}

function parseJson(value: string, error: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(error);
  }
}

function assertBytes(value: Uint8Array, length: number, error: string) {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) throw new Error(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
