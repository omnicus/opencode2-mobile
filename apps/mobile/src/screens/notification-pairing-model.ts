import {
  type NotificationPairingCode,
  parseNotificationPairingCode,
} from "@opencode2-mobile/notification-protocol";
import type { ConnectionCredential } from "../connections/connection-profile";
import { prepareOpenCodeDevicePairing } from "../notifications/notification-client";

export type PreparedOpenCodePairing = ReturnType<typeof prepareOpenCodeDevicePairing>;

export type PairingPreview =
  | { code: NotificationPairingCode; kind: "notification" }
  | { kind: "opencode"; prepared: PreparedOpenCodePairing };

export type PairingStage =
  | "broker-issue"
  | "broker-registration"
  | "connection-save"
  | "opencode-validation"
  | "pairing-save"
  | "push-registration"
  | "secure-storage";

const codeErrorMessages = new Map<string, string>([
  [
    "NOTIFICATION_PERMISSION_DENIED",
    "Notifications are disabled. Allow notifications in system settings, then try again.",
  ],
  [
    "PUSH_REQUIRES_PHYSICAL_DEVICE",
    "Remote push pairing requires a physical iOS or Android device.",
  ],
  [
    "PAIRING_CODE_EXPIRED",
    "This pairing code expired or was already used. Create a new code on the server.",
  ],
  [
    "PAIRING_UNAVAILABLE",
    "This pairing code expired or was already used. Create a new code on the server.",
  ],
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
]);

const stageErrorMessages = new Map<PairingStage, string>([
  ["broker-issue", "The notification broker could not verify this OpenCode pairing code."],
  ["connection-save", "The validated OpenCode connection could not be saved on this device."],
  ["opencode-validation", "The paired OpenCode address or credentials could not be validated."],
  ["pairing-save", "The notification key could not be saved securely on this device."],
  [
    "push-registration",
    "Push registration failed. Check this device's notification settings and try again.",
  ],
  ["secure-storage", "The notification key could not be saved securely on this device."],
]);

const fallbackStages = new Set<PairingStage>([
  "broker-issue",
  "broker-registration",
  "push-registration",
  "secure-storage",
]);

export function pairingErrorMessage(error: unknown, stage?: PairingStage) {
  const code = error instanceof Error ? error.message : "PAIRING_FAILED";
  const known = codeErrorMessages.get(code);
  if (known) return known;
  if (code.includes("HTTP")) return "The pairing code did not approve this unencrypted address.";
  if (/^INVALID_(OPENCODE_)?PAIRING/.test(code)) {
    return "The pairing code is malformed or was altered.";
  }
  return stageErrorMessage(code, stage);
}

function stageErrorMessage(code: string, stage?: PairingStage) {
  if (stage === "push-registration" && code === "EAS_PROJECT_ID_MISSING") {
    return "Push registration requires an EAS project ID in the app deployment configuration.";
  }
  if (stage === "broker-registration") {
    const brokerCode = /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? ` (${code})` : "";
    return `The notification broker rejected or could not complete this pairing code${brokerCode}.`;
  }
  return (
    (stage && stageErrorMessages.get(stage)) ??
    "Pairing failed. Check that the OpenCode server and notification broker are reachable."
  );
}

export function inspectPairingCode(value: string): { preview: PairingPreview } | { error: string } {
  try {
    const code = parseNotificationPairingCode(value.trim());
    if (code.expiresAtMs < Date.now()) throw new Error("PAIRING_CODE_EXPIRED");
    return { preview: { code, kind: "notification" } };
  } catch (caught) {
    try {
      return {
        preview: { kind: "opencode", prepared: prepareOpenCodeDevicePairing(value.trim()) },
      };
    } catch (openCodeError) {
      return {
        error: pairingErrorMessage(
          caught instanceof Error && caught.message === "PAIRING_CODE_EXPIRED"
            ? caught
            : openCodeError,
        ),
      };
    }
  }
}

export function cameraDeniedMessage(canAskAgain: boolean) {
  return canAskAgain
    ? "Camera access was denied. Paste the pairing code instead."
    : "Camera access is off for this app. Turn it on in Settings, or paste the pairing code instead.";
}

export function directPairingFallback(
  preview: PairingPreview,
  stage: PairingStage,
  savedConnectionId: string | undefined,
) {
  if (preview.kind !== "opencode" || savedConnectionId || !fallbackStages.has(stage)) return;
  return preview.prepared;
}

export function directPairingCredential(prepared: PreparedOpenCodePairing): ConnectionCredential {
  return {
    mode: "basic",
    password: prepared.code.password,
    schemaVersion: 1,
    username: prepared.code.username,
  };
}

export function bootstrapCredential(
  auth:
    | { mode: "basic"; password: string; username: string }
    | { mode: "bearer"; token: string }
    | { mode: "none" },
): ConnectionCredential | undefined {
  if (auth.mode === "basic") return { ...auth, schemaVersion: 1 };
  if (auth.mode === "bearer") return { ...auth, schemaVersion: 1 };
  return undefined;
}

export function pairingExpiresAtMs(preview: PairingPreview | undefined) {
  return preview?.kind === "notification" ? preview.code.expiresAtMs : undefined;
}

export function pairingSecondsLeft(expiresAtMs: number | undefined, nowMs: number) {
  return expiresAtMs === undefined
    ? undefined
    : Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1_000));
}

export function pairingPreviewName(preview: PairingPreview) {
  return preview.kind === "notification" ? preview.code.name : preview.prepared.name;
}

export function pairingPreviewOrigin(preview: PairingPreview) {
  return preview.kind === "notification"
    ? preview.code.openCodeOrigin
    : preview.prepared.openCodeOrigin;
}

export function pairingPreviewMeta(preview: PairingPreview, secondsLeft: number | undefined) {
  if (preview.kind === "notification") {
    return `${authModeDescription(preview.code.authMode)} ${
      secondsLeft === 0
        ? "This code expired. Create a new one on the server."
        : `Expires in ${secondsLeft} seconds.`
    }`;
  }
  return `${authModeDescription("basic")}${
    preview.prepared.allowDevelopmentHttp ? " Uses HTTP, which is not encrypted." : ""
  }`;
}

export function pairingPreviewApprovesHttp(preview: PairingPreview | undefined) {
  return preview?.kind === "opencode" && preview.prepared.allowDevelopmentHttp;
}

function authModeDescription(mode: NotificationPairingCode["authMode"]) {
  if (mode === "basic") return "Signs in with a username and password.";
  if (mode === "bearer") return "Signs in with a token.";
  return "No sign-in needed.";
}
