import {
  decodeNotificationBytes,
  encodeNotificationBytes,
  type NotificationDeviceCommand,
  type NotificationPairingCode,
  type NotificationPairingRegistration,
  notificationBootstrapAdditionalData,
  notificationDeviceAdditionalData,
  notificationDeviceKeyBytes,
  notificationNonceBytes,
  notificationPairingAdditionalData,
  notificationPairingResponseAdditionalData,
  notificationPushAdditionalData,
  openNotificationJson,
  parseNotificationConnectionBootstrap,
  parseNotificationPairingCode,
  parseNotificationPairingIssueRequest,
  parseNotificationPairingResponse,
  parseNotificationPushData,
  parseNotificationRoutingEnvelope,
  parseOpenCodeDevicePairingCode,
  sealNotificationJson,
} from "@opencode2-mobile/notification-protocol";
import * as Crypto from "expo-crypto";

export async function completeNotificationPairing(
  codeValue: unknown,
  registration: Omit<NotificationPairingRegistration, "deviceKey" | "v">,
  encodedDeviceKey?: string,
) {
  const code = parseNotificationPairingCode(codeValue);
  if (code.expiresAtMs < Date.now()) throw new Error("PAIRING_CODE_EXPIRED");
  assertUsableBroker(code);
  const pairingSecret = decodeNotificationBytes(code.pairingSecret, notificationDeviceKeyBytes);
  const deviceKey = encodedDeviceKey
    ? decodeNotificationBytes(encodedDeviceKey, notificationDeviceKeyBytes)
    : Crypto.getRandomBytes(notificationDeviceKeyBytes);
  const requestNonce = Crypto.getRandomBytes(notificationNonceBytes);
  const request = {
    challengeID: code.challengeID,
    ciphertext: sealNotificationJson(
      pairingSecret,
      requestNonce,
      {
        ...registration,
        deviceKey: encodeNotificationBytes(deviceKey),
        v: 1,
      } satisfies NotificationPairingRegistration,
      notificationPairingAdditionalData(code.challengeID),
    ),
    nonce: encodeNotificationBytes(requestNonce),
    v: 1,
  } as const;
  const response = await postJson(
    `${code.brokerOrigin}/v1/pair/complete`,
    request,
    parseNotificationPairingResponse,
  );
  const bootstrap = parseNotificationConnectionBootstrap(
    openNotificationJson(
      pairingSecret,
      decodeNotificationBytes(response.bootstrapNonce, notificationNonceBytes),
      response.bootstrapCiphertext,
      notificationBootstrapAdditionalData(code.challengeID),
    ),
  );
  const metadata = openNotificationJson(
    pairingSecret,
    decodeNotificationBytes(response.metadataNonce, notificationNonceBytes),
    response.metadataCiphertext,
    notificationPairingResponseAdditionalData(code.challengeID),
  );
  if (
    !isRecord(metadata) ||
    metadata.v !== 1 ||
    metadata.brokerID !== response.brokerID ||
    metadata.pairedAtMs !== response.pairedAtMs
  ) {
    throw new Error("PAIRING_RESPONSE_MISMATCH");
  }
  if (
    bootstrap.baseUrl !== code.openCodeOrigin ||
    bootstrap.name !== code.name ||
    bootstrap.auth.mode !== code.authMode ||
    bootstrap.allowDevelopmentHttp !== code.allowDevelopmentHttp
  ) {
    throw new Error("PAIRING_BOOTSTRAP_MISMATCH");
  }
  return {
    bindingID: registration.bindingID,
    bootstrap,
    brokerID: response.brokerID,
    brokerOrigin: code.brokerOrigin,
    deviceKey: encodeNotificationBytes(deviceKey),
  };
}

export function prepareOpenCodeDevicePairing(value: unknown) {
  const code = parseOpenCodeDevicePairingCode(value);
  const openCodeOrigin = code.urls.find((candidate) => {
    const hostname = new URL(candidate).hostname;
    return !isUnusableDeviceHost(hostname);
  });
  if (!openCodeOrigin) throw new Error("PAIRING_OPENCODE_IS_LOOPBACK");
  const openCodeUrl = new URL(openCodeOrigin);
  const brokerUrl = new URL(openCodeOrigin);
  brokerUrl.port = "37100";
  return {
    allowDevelopmentHttp: openCodeUrl.protocol === "http:",
    brokerOrigin: brokerUrl.origin,
    code,
    name: `OpenCode on ${openCodeUrl.hostname}`.slice(0, 80),
    openCodeOrigin,
  };
}

export async function issueNotificationPairingFromOpenCode(
  prepared: ReturnType<typeof prepareOpenCodeDevicePairing>,
) {
  const request = parseNotificationPairingIssueRequest({
    allowDevelopmentHttp: prepared.allowDevelopmentHttp,
    name: prepared.name,
    openCodeOrigin: prepared.openCodeOrigin,
    password: prepared.code.password,
    username: prepared.code.username,
    v: 1,
  });
  const code = await postJson(
    `${prepared.brokerOrigin}/v1/pair/opencode`,
    request,
    parseNotificationPairingCode,
    15_000,
  );
  if (
    code.allowDevelopmentHttp !== prepared.allowDevelopmentHttp ||
    code.authMode !== "basic" ||
    code.brokerOrigin !== prepared.brokerOrigin ||
    code.name !== prepared.name ||
    code.openCodeOrigin !== prepared.openCodeOrigin
  ) {
    throw new Error("PAIRING_ISSUE_MISMATCH");
  }
  return code;
}

export function createNotificationPairingMaterial() {
  return {
    bindingID: Crypto.randomUUID(),
    deviceKey: encodeNotificationBytes(Crypto.getRandomBytes(notificationDeviceKeyBytes)),
  };
}

export async function sendNotificationDeviceCommand(input: {
  bindingID: string;
  brokerOrigin: string;
  deviceKey: string;
  expoPushToken?: string;
  operation: NotificationDeviceCommand["operation"];
}) {
  const nonce = Crypto.getRandomBytes(notificationNonceBytes);
  const command: NotificationDeviceCommand = {
    atMs: Date.now(),
    ...(input.expoPushToken ? { expoPushToken: input.expoPushToken } : {}),
    nonceID: Crypto.randomUUID(),
    operation: input.operation,
    v: 1,
  };
  await postJson(
    `${input.brokerOrigin}/v1/device/${input.operation}`,
    {
      bindingID: input.bindingID,
      ciphertext: sealNotificationJson(
        decodeNotificationBytes(input.deviceKey, notificationDeviceKeyBytes),
        nonce,
        command,
        notificationDeviceAdditionalData(input.bindingID, input.operation),
      ),
      nonce: encodeNotificationBytes(nonce),
      v: 1,
    },
    parseOk,
  );
}

export function decryptNotificationRoute(data: unknown, deviceKey: string) {
  const push = parseNotificationPushData(data);
  const route = parseNotificationRoutingEnvelope(
    openNotificationJson(
      decodeNotificationBytes(deviceKey, notificationDeviceKeyBytes),
      decodeNotificationBytes(push.nonce, notificationNonceBytes),
      push.ciphertext,
      notificationPushAdditionalData(push.bindingID),
    ),
  );
  if (route.bindingID !== push.bindingID) throw new Error("NOTIFICATION_BINDING_MISMATCH");
  return route;
}

async function postJson<T>(
  url: string,
  body: unknown,
  parse: (value: unknown) => T,
  timeoutMs = 10_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const value = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = isRecord(value) && typeof value.error === "string" ? value.error : "BROKER_ERROR";
    throw new Error(code);
  }
  return parse(value);
}

function assertUsableBroker(code: NotificationPairingCode) {
  const broker = new URL(code.brokerOrigin);
  if (broker.protocol === "http:" && !code.allowDevelopmentHttp) {
    throw new Error("PAIRING_HTTP_NOT_APPROVED");
  }
  if (isUnusableDeviceHost(broker.hostname)) throw new Error("PAIRING_BROKER_IS_LOOPBACK");
  if (isUnusableDeviceHost(new URL(code.openCodeOrigin).hostname)) {
    throw new Error("PAIRING_OPENCODE_IS_LOOPBACK");
  }
}

function parseOk(value: unknown) {
  if (!isRecord(value) || value.ok !== true) throw new Error("INVALID_BROKER_RESPONSE");
  return value;
}

function isUnusableDeviceHost(hostname: string) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "0.0.0.0" || normalized === "::" || normalized === "::1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) return true;
  return normalized.startsWith("::ffff:7f");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
