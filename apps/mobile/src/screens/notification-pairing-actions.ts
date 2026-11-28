import {
  classifyOpenCodeError,
  createOpenCodeClient,
  normalizeOpenCodeBaseUrl,
  redeemOpenCodePairingLink,
} from "@opencode2-mobile/opencode-adapter";
import type { PermissionResponse } from "expo-camera";
import type { SQLiteDatabase } from "expo-sqlite";
import type { RefObject } from "react";
import { Alert } from "react-native";
import { connectionAuthorizationHeader } from "../connections/connection-authorization";
import type { ConnectionCredential } from "../connections/connection-profile";
import type { useConnections } from "../connections/connections-context";
import { boundedOpenCodeFetch } from "../expo-open-code-fetch";
import {
  completeNotificationPairing,
  createNotificationPairingMaterial,
  issueNotificationPairingFromOpenCode,
  redeemedOpenCodeDevicePairing,
  sendNotificationDeviceCommand,
} from "../notifications/notification-client";
import {
  finishPendingNotificationRevocation,
  installNotificationPairing,
  stagePendingNotificationRevocation,
} from "../notifications/notification-pairing-repository";
import { registerForOpenCodePushNotifications } from "../notifications/notification-registration";
import {
  bootstrapCredential,
  cameraDeniedMessage,
  directPairingCredential,
  directPairingFallback,
  inspectPairingCode,
  type PairingPreview,
  type PairingStage,
  type PreparedOpenCodePairing,
  type PreparedOpenCodePairingLink,
  pairingErrorMessage,
} from "./notification-pairing-model";

const openCodeTimeoutMs = 10_000;

type RedeemedPairingPreview = Exclude<PairingPreview, { kind: "link" }>;

type Connections = ReturnType<typeof useConnections>;
type PairingMaterial = ReturnType<typeof createNotificationPairingMaterial>;
type PendingRevocation = Awaited<ReturnType<typeof stagePendingNotificationRevocation>>;

type PairingContext = {
  connections: Connections;
  db: SQLiteDatabase;
  pairingMaterial: RefObject<PairingMaterial | undefined>;
};

type PairingProgress = {
  pendingRevocation?: PendingRevocation;
  savedConnectionId?: string;
  stage: PairingStage;
};

export type NotificationPairingState = {
  attempt: RefObject<AbortController | undefined>;
  busy: boolean;
  cameraPermission: PermissionResponse | null;
  expired: boolean;
  lastScan: RefObject<string | undefined>;
  manualCode: string;
  mounted: RefObject<boolean>;
  pairingMaterial: RefObject<PairingMaterial | undefined>;
  preview: PairingPreview | undefined;
  requestCameraPermission: () => Promise<PermissionResponse>;
  setBusy: (busy: boolean) => void;
  setCameraBlocked: (blocked: boolean) => void;
  setCancelling: (cancelling: boolean) => void;
  setError: (error: string | undefined) => void;
  setManualCode: (code: string) => void;
  setPreview: (preview: PairingPreview | undefined) => void;
  setScanError: (error: string | undefined) => void;
  setScanning: (scanning: boolean) => void;
};

export type NotificationPairingDependencies = {
  connections: Connections;
  db: SQLiteDatabase;
  onDone: () => void;
};

export function notificationPairingActions(
  state: NotificationPairingState,
  dependencies: NotificationPairingDependencies,
) {
  return { ...pairingCodeActions(state), ...pairingConnectionActions(state, dependencies) };
}

function pairingCodeActions(state: NotificationPairingState) {
  function inspect(value = state.manualCode, source: "manual" | "scan" = "manual") {
    const report = source === "scan" ? state.setScanError : state.setError;
    state.setError(undefined);
    state.setScanError(undefined);
    state.pairingMaterial.current = undefined;
    const result = inspectPairingCode(value);
    if ("error" in result) {
      state.setPreview(undefined);
      report(result.error);
      return;
    }
    state.setManualCode("");
    state.setPreview(result.preview);
    state.setScanning(false);
  }

  function scanned(data: string) {
    if (state.busy || data === state.lastScan.current) return;
    state.lastScan.current = data;
    inspect(data, "scan");
  }

  function editCode(value: string) {
    state.setManualCode(value);
    state.setPreview(undefined);
  }

  async function openScanner() {
    state.setError(undefined);
    state.setScanError(undefined);
    state.lastScan.current = undefined;
    if (!state.cameraPermission?.granted) {
      const next = await state.requestCameraPermission();
      if (!next.granted) {
        state.setCameraBlocked(!next.canAskAgain);
        state.setError(cameraDeniedMessage(next.canAskAgain));
        return;
      }
    }
    state.setCameraBlocked(false);
    state.setScanning(true);
  }

  function closeScanner() {
    state.setScanning(false);
    state.setScanError(undefined);
  }

  return { closeScanner, editCode, inspect, openScanner, scanned };
}

function pairingAttempt(state: NotificationPairingState) {
  function beginAttempt() {
    state.attempt.current?.abort();
    const controller = new AbortController();
    state.attempt.current = controller;
    state.setCancelling(false);
    state.setBusy(true);
    state.setError(undefined);
    return controller.signal;
  }

  function cancelAttempt() {
    state.setCancelling(true);
    state.attempt.current?.abort();
  }

  function finishAttempt(signal: AbortSignal) {
    if (state.attempt.current?.signal !== signal) return;
    state.attempt.current = undefined;
    state.setBusy(false);
    state.setCancelling(false);
  }

  return { beginAttempt, cancelAttempt, finishAttempt };
}

function pairingConnectionActions(
  state: NotificationPairingState,
  { connections, db, onDone }: NotificationPairingDependencies,
) {
  const context: PairingContext = { connections, db, pairingMaterial: state.pairingMaterial };
  const { beginAttempt, cancelAttempt, finishAttempt } = pairingAttempt(state);

  async function pairWithoutNotifications() {
    if (!state.preview || state.preview.kind === "notification" || state.busy) return;
    const signal = beginAttempt();
    try {
      const preview =
        state.preview.kind === "link"
          ? await redeemLink(state.preview.prepared, signal)
          : state.preview;
      if (preview?.kind === "opencode") await connectDirectly(preview.prepared, signal);
    } finally {
      finishAttempt(signal);
    }
  }

  // Spends a pairing link's code and keeps the result, so a retry never redeems it twice.
  async function redeemLink(
    prepared: PreparedOpenCodePairingLink,
    signal: AbortSignal,
  ): Promise<RedeemedPairingPreview | undefined> {
    try {
      const redeemed = await redeemPairingLink(prepared, signal);
      // The code is spent now, so keep the result even if the person cancelled meanwhile.
      if (state.mounted.current) state.setPreview(redeemed);
      throwIfCancelled(signal);
      return redeemed;
    } catch (caught) {
      if (!signal.aborted) state.setError(pairingErrorMessage(caught, "link-redeem"));
      return undefined;
    }
  }

  async function connectDirectly(
    prepared: PreparedOpenCodePairing,
    signal: AbortSignal,
    notificationFallback = false,
  ) {
    let stage: PairingStage = "opencode-validation";
    try {
      const credential = directPairingCredential(prepared);
      const baseUrl = normalizeOpenCodeBaseUrl(prepared.openCodeOrigin);
      const health = await checkOpenCode(openCodeClient(baseUrl, credential), signal);
      throwIfCancelled(signal);
      stage = "connection-save";
      await connections.save({
        credential,
        draft: {
          allowDevelopmentHttp: prepared.allowDevelopmentHttp,
          authMode: "basic",
          baseUrl,
          name: prepared.name,
        },
        health: { checkedAtMs: Date.now(), pid: health.pid, version: health.version },
      });
      if (notificationFallback) {
        Alert.alert(
          "Server connected",
          "Notification setup was unavailable. Connected without notifications.",
        );
      }
      if (state.mounted.current) onDone();
    } catch (caught) {
      if (!signal.aborted) state.setError(pairingErrorMessage(caught, stage));
    }
  }

  async function pair() {
    const initial = state.preview;
    if (!initial || state.busy || state.expired) return;
    const signal = beginAttempt();
    const progress: PairingProgress = { stage: "push-registration" };
    let preview: PairingPreview = initial;
    try {
      const redeemed =
        initial.kind === "link" ? await redeemLink(initial.prepared, signal) : initial;
      if (!redeemed) return;
      preview = redeemed;
      await completePairing(context, redeemed, progress, signal);
      state.pairingMaterial.current = undefined;
      if (state.mounted.current) onDone();
    } catch (caught) {
      await recoverFailedPairing(caught, preview, progress, signal);
    } finally {
      finishAttempt(signal);
    }
  }

  async function recoverFailedPairing(
    caught: unknown,
    preview: PairingPreview,
    progress: PairingProgress,
    signal: AbortSignal,
  ) {
    if (progress.pendingRevocation && state.pairingMaterial.current) {
      await revokePendingPairing(
        context,
        progress.pendingRevocation,
        state.pairingMaterial.current,
      );
    }
    const connectionRollbackFailed = await rollBackSavedConnection(
      connections,
      progress.savedConnectionId,
    );
    if (signal.aborted && !connectionRollbackFailed) return;
    const fallback = directPairingFallback(preview, progress.stage, progress.savedConnectionId);
    if (fallback) {
      await connectDirectly(fallback, signal, true);
      return;
    }
    state.setError(
      connectionRollbackFailed
        ? "Pairing failed after saving the connection. Remove it from Connections before retrying."
        : pairingErrorMessage(caught, progress.stage),
    );
  }

  return { cancelAttempt, pair, pairWithoutNotifications };
}

async function redeemPairingLink(
  prepared: PreparedOpenCodePairingLink,
  signal: AbortSignal,
): Promise<RedeemedPairingPreview> {
  try {
    const credential = await withOpenCodeTimeout(signal, (timeoutSignal) =>
      redeemOpenCodePairingLink(prepared.link, {
        fetch: boundedOpenCodeFetch,
        signal: timeoutSignal,
      }),
    );
    return { kind: "opencode", prepared: redeemedOpenCodeDevicePairing(prepared, credential) };
  } catch (caught) {
    throw pairingLinkError(caught);
  }
}

function pairingLinkError(caught: unknown) {
  if (caught instanceof Error && caught.message === "PAIRING_OPENCODE_TIMEOUT") return caught;
  const kind = classifyOpenCodeError(caught);
  if (kind === "UNAUTHORIZED") return new Error("PAIRING_LINK_SPENT");
  if (kind === "INCOMPATIBLE") return new Error("PAIRING_LINK_UNSUPPORTED");
  // Transport messages can mention HTTP; keep them from reading as an unapproved address.
  return new Error("PAIRING_LINK_FAILED");
}

async function completePairing(
  { connections, db, pairingMaterial }: PairingContext,
  preview: RedeemedPairingPreview,
  progress: PairingProgress,
  signal: AbortSignal,
) {
  const push = await registerForOpenCodePushNotifications();
  throwIfCancelled(signal);
  progress.stage = "broker-issue";
  const code =
    preview.kind === "notification"
      ? preview.code
      : await issueNotificationPairingFromOpenCode(preview.prepared, signal);
  throwIfCancelled(signal);
  pairingMaterial.current ??= createNotificationPairingMaterial();
  progress.stage = "secure-storage";
  progress.pendingRevocation = await stagePendingNotificationRevocation(db, {
    bindingID: pairingMaterial.current.bindingID,
    brokerOrigin: code.brokerOrigin,
    deviceKey: pairingMaterial.current.deviceKey,
  });
  throwIfCancelled(signal);
  progress.stage = "broker-registration";
  const registered = await completeNotificationPairing(
    code,
    {
      bindingID: pairingMaterial.current.bindingID,
      deviceName: push.deviceName,
      expoPushToken: push.expoPushToken,
      platform: push.platform,
    },
    pairingMaterial.current.deviceKey,
    signal,
  );
  throwIfCancelled(signal);
  const credential = bootstrapCredential(registered.bootstrap.auth);
  const baseUrl = normalizeOpenCodeBaseUrl(registered.bootstrap.baseUrl);
  const client = openCodeClient(baseUrl, credential);
  progress.stage = "opencode-validation";
  const health = await checkOpenCode(client, signal);
  throwIfCancelled(signal);
  progress.stage = "connection-save";
  const connectionId = await connections.save({
    ...(credential ? { credential } : {}),
    draft: {
      allowDevelopmentHttp: registered.bootstrap.allowDevelopmentHttp,
      authMode: registered.bootstrap.auth.mode,
      baseUrl,
      name: registered.bootstrap.name,
    },
    health: {
      checkedAtMs: Date.now(),
      pid: health.pid,
      version: health.version,
    },
  });
  progress.savedConnectionId = connectionId;
  progress.stage = "pairing-save";
  await installNotificationPairing(db, {
    bindingID: registered.bindingID,
    brokerID: registered.brokerID,
    brokerOrigin: registered.brokerOrigin,
    connectionId,
    deviceKey: registered.deviceKey,
  });
}

async function revokePendingPairing(
  { db, pairingMaterial }: PairingContext,
  pendingRevocation: PendingRevocation,
  material: PairingMaterial,
) {
  try {
    await sendNotificationDeviceCommand({
      bindingID: material.bindingID,
      brokerOrigin: pendingRevocation.brokerOrigin,
      deviceKey: material.deviceKey,
      operation: "revoke",
    });
    await finishPendingNotificationRevocation(db, pendingRevocation);
    pairingMaterial.current = undefined;
  } catch (revocationError) {
    if (revocationError instanceof Error && revocationError.message === "DEVICE_NOT_FOUND") {
      await finishPendingNotificationRevocation(db, pendingRevocation);
      pairingMaterial.current = undefined;
    }
  }
}

async function rollBackSavedConnection(connections: Connections, connectionId: string | undefined) {
  if (!connectionId) return false;
  try {
    await connections.remove(connectionId);
    return false;
  } catch {
    return true;
  }
}

function openCodeClient(baseUrl: string, credential: ConnectionCredential | undefined) {
  return createOpenCodeClient({
    ...(credential ? { authorization: connectionAuthorizationHeader(credential) } : {}),
    baseUrl,
    fetch: boundedOpenCodeFetch,
  });
}

async function checkOpenCode(client: ReturnType<typeof createOpenCodeClient>, signal: AbortSignal) {
  return withOpenCodeTimeout(signal, async (timeoutSignal) => {
    const options = { signal: timeoutSignal };
    const [health] = await Promise.all([
      client.server.status(options),
      client.session.list({ limit: 1, order: "desc" }, options),
    ]);
    return health;
  });
}

async function withOpenCodeTimeout<T>(
  signal: AbortSignal,
  run: (timeoutSignal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, openCodeTimeoutMs);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  try {
    return await run(controller.signal);
  } catch (caught) {
    throw timedOut ? new Error("PAIRING_OPENCODE_TIMEOUT") : caught;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

function throwIfCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error("PAIRING_CANCELLED");
}
