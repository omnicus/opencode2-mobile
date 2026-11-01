import {
  type NotificationPairingCode,
  parseNotificationPairingCode,
} from "@opencode2-mobile/notification-protocol";
import { createOpenCodeClient, normalizeOpenCodeBaseUrl } from "@opencode2-mobile/opencode-adapter";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/button";
import { useAnnouncement } from "../components/use-announcement";
import { connectionAuthorizationHeader } from "../connections/connection-authorization";
import type { ConnectionCredential } from "../connections/connection-profile";
import { useConnections } from "../connections/connections-context";
import { boundedOpenCodeFetch } from "../expo-open-code-fetch";
import {
  completeNotificationPairing,
  createNotificationPairingMaterial,
  issueNotificationPairingFromOpenCode,
  prepareOpenCodeDevicePairing,
  sendNotificationDeviceCommand,
} from "../notifications/notification-client";
import {
  finishPendingNotificationRevocation,
  installNotificationPairing,
  stagePendingNotificationRevocation,
} from "../notifications/notification-pairing-repository";
import { registerForOpenCodePushNotifications } from "../notifications/notification-registration";
import {
  cardSurface,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
} from "../theme";
import { FormKeyboardAvoidingView } from "./form-keyboard-avoiding-view";

const openCodeTimeoutMs = 10_000;

export function NotificationPairingScreen({ onDone }: { onDone: () => void }) {
  const db = useSQLiteContext();
  const connections = useConnections();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();
  const [scanError, setScanError] = useState<string>();
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [preview, setPreview] = useState<PairingPreview>();
  const [now, setNow] = useState(Date.now);
  const pairingMaterial = useRef<ReturnType<typeof createNotificationPairingMaterial> | undefined>(
    undefined,
  );
  const attempt = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const lastScan = useRef<string | undefined>(undefined);
  const expiresAtMs = preview?.kind === "notification" ? preview.code.expiresAtMs : undefined;
  const secondsLeft =
    expiresAtMs === undefined ? undefined : Math.max(0, Math.ceil((expiresAtMs - now) / 1_000));
  const expired = secondsLeft === 0;
  useAnnouncement(error);
  useAnnouncement(scanError);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (expiresAtMs === undefined) return;
    setNow(Date.now());
    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAtMs) clearInterval(interval);
    }, 1_000);
    return () => clearInterval(interval);
  }, [expiresAtMs]);

  function inspect(value = manualCode, source: "manual" | "scan" = "manual") {
    const report = source === "scan" ? setScanError : setError;
    setError(undefined);
    setScanError(undefined);
    pairingMaterial.current = undefined;
    try {
      const code = parseNotificationPairingCode(value.trim());
      if (code.expiresAtMs < Date.now()) throw new Error("PAIRING_CODE_EXPIRED");
      setManualCode("");
      setPreview({ code, kind: "notification" });
      setScanning(false);
    } catch (caught) {
      try {
        const prepared = prepareOpenCodeDevicePairing(value.trim());
        setManualCode("");
        setPreview({ kind: "opencode", prepared });
        setScanning(false);
      } catch (openCodeError) {
        setPreview(undefined);
        report(
          pairingErrorMessage(
            caught instanceof Error && caught.message === "PAIRING_CODE_EXPIRED"
              ? caught
              : openCodeError,
          ),
        );
      }
    }
  }

  function scanned(data: string) {
    if (busy || data === lastScan.current) return;
    lastScan.current = data;
    inspect(data, "scan");
  }

  async function openScanner() {
    setError(undefined);
    setScanError(undefined);
    lastScan.current = undefined;
    if (!cameraPermission?.granted) {
      const next = await requestCameraPermission();
      if (!next.granted) {
        setCameraBlocked(!next.canAskAgain);
        setError(
          next.canAskAgain
            ? "Camera access was denied. Paste the pairing code instead."
            : "Camera access is off for this app. Turn it on in Settings, or paste the pairing code instead.",
        );
        return;
      }
    }
    setCameraBlocked(false);
    setScanning(true);
  }

  function closeScanner() {
    setScanning(false);
    setScanError(undefined);
  }

  function beginAttempt() {
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setCancelling(false);
    setBusy(true);
    setError(undefined);
    return controller.signal;
  }

  function cancelAttempt() {
    setCancelling(true);
    attempt.current?.abort();
  }

  function finishAttempt(signal: AbortSignal) {
    if (attempt.current?.signal !== signal) return;
    attempt.current = undefined;
    setBusy(false);
    setCancelling(false);
  }

  async function pairWithoutNotifications() {
    if (preview?.kind !== "opencode" || busy) return;
    const signal = beginAttempt();
    try {
      await connectDirectly(preview.prepared, signal);
    } finally {
      finishAttempt(signal);
    }
  }

  async function connectDirectly(
    prepared: ReturnType<typeof prepareOpenCodeDevicePairing>,
    signal: AbortSignal,
    notificationFallback = false,
  ) {
    let stage: PairingStage = "opencode-validation";
    try {
      const credential: ConnectionCredential = {
        mode: "basic",
        password: prepared.code.password,
        schemaVersion: 1,
        username: prepared.code.username,
      };
      const baseUrl = normalizeOpenCodeBaseUrl(prepared.openCodeOrigin);
      const client = createOpenCodeClient({
        authorization: connectionAuthorizationHeader(credential),
        baseUrl,
        fetch: boundedOpenCodeFetch,
      });
      const health = await checkOpenCode(client, signal);
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
      if (mounted.current) onDone();
    } catch (caught) {
      if (!signal.aborted) setError(pairingErrorMessage(caught, stage));
    }
  }

  async function pair() {
    if (!preview || busy || expired) return;
    const signal = beginAttempt();
    let pendingRevocation:
      | Awaited<ReturnType<typeof stagePendingNotificationRevocation>>
      | undefined;
    let savedConnectionId: string | undefined;
    let stage: PairingStage = "push-registration";
    try {
      const push = await registerForOpenCodePushNotifications();
      throwIfCancelled(signal);
      stage = "broker-issue";
      const code =
        preview.kind === "notification"
          ? preview.code
          : await issueNotificationPairingFromOpenCode(preview.prepared, signal);
      throwIfCancelled(signal);
      pairingMaterial.current ??= createNotificationPairingMaterial();
      stage = "secure-storage";
      pendingRevocation = await stagePendingNotificationRevocation(db, {
        bindingID: pairingMaterial.current.bindingID,
        brokerOrigin: code.brokerOrigin,
        deviceKey: pairingMaterial.current.deviceKey,
      });
      throwIfCancelled(signal);
      stage = "broker-registration";
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
      const client = createOpenCodeClient({
        ...(credential ? { authorization: connectionAuthorizationHeader(credential) } : {}),
        baseUrl,
        fetch: boundedOpenCodeFetch,
      });
      stage = "opencode-validation";
      const health = await checkOpenCode(client, signal);
      throwIfCancelled(signal);
      stage = "connection-save";
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
      savedConnectionId = connectionId;
      stage = "pairing-save";
      await installNotificationPairing(db, {
        bindingID: registered.bindingID,
        brokerID: registered.brokerID,
        brokerOrigin: registered.brokerOrigin,
        connectionId,
        deviceKey: registered.deviceKey,
      });
      pairingMaterial.current = undefined;
      if (mounted.current) onDone();
    } catch (caught) {
      let connectionRollbackFailed = false;
      if (pendingRevocation && pairingMaterial.current) {
        try {
          await sendNotificationDeviceCommand({
            bindingID: pairingMaterial.current.bindingID,
            brokerOrigin: pendingRevocation.brokerOrigin,
            deviceKey: pairingMaterial.current.deviceKey,
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
      if (savedConnectionId) {
        try {
          await connections.remove(savedConnectionId);
        } catch {
          connectionRollbackFailed = true;
        }
      }
      if (signal.aborted && !connectionRollbackFailed) return;
      if (
        preview.kind === "opencode" &&
        !savedConnectionId &&
        (stage === "push-registration" ||
          stage === "broker-issue" ||
          stage === "secure-storage" ||
          stage === "broker-registration")
      ) {
        await connectDirectly(preview.prepared, signal, true);
        return;
      }
      setError(
        connectionRollbackFailed
          ? "Pairing failed after saving the connection. Remove it from Connections before retrying."
          : pairingErrorMessage(caught, stage),
      );
    } finally {
      finishAttempt(signal);
    }
  }

  const approvesHttp = preview?.kind === "opencode" && preview.prepared.allowDevelopmentHttp;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          dynamicTypeRamp={typeRamp.navTitle}
          numberOfLines={1}
          style={styles.headerTitle}
        >
          Pair this phone
        </Text>
        <Pressable
          accessibilityRole="button"
          android_ripple={
            Platform.OS === "android"
              ? { borderless: true, color: "rgba(255,255,255,0.12)" }
              : undefined
          }
          onPress={onDone}
          style={({ pressed }) => [
            styles.doneButton,
            pressed && Platform.OS === "ios" && styles.pressed,
          ]}
        >
          <Text dynamicTypeRamp={typeRamp.navTitle} style={styles.doneLabel}>
            Done
          </Text>
        </Pressable>
      </View>
      <FormKeyboardAvoidingView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
            Run /pair in OpenCode on your computer, then scan the code it shows. Notifications are
            set up when available; otherwise the app connects without them. Credentials are stored
            in the device keychain.
          </Text>

          {scanning ? (
            <View style={styles.cameraFrame}>
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => scanned(data)}
                style={styles.camera}
              />
              <View style={styles.cameraFooter}>
                <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.cameraHint}>
                  Center the terminal QR code in the frame.
                </Text>
                {scanError ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    dynamicTypeRamp={typeRamp.subheadline}
                    style={styles.scanError}
                  >
                    {scanError}
                  </Text>
                ) : null}
                <Button fullWidth label="Cancel scan" onPress={closeScanner} />
              </View>
            </View>
          ) : (
            <Button
              disabled={busy}
              fullWidth
              icon="camera"
              label="Scan QR code"
              onPress={() => void openScanner()}
              style={styles.scanAction}
              variant="primary"
            />
          )}
          {cameraBlocked ? (
            <Button
              fullWidth
              label="Open Settings"
              onPress={() => void Linking.openSettings()}
              style={styles.checkAction}
            />
          ) : null}

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text dynamicTypeRamp={typeRamp.footnote} style={styles.dividerLabel}>
              or paste
            </Text>
            <View style={styles.divider} />
          </View>
          <TextInput
            accessibilityLabel="Pairing code"
            keyboardAppearance="dark"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            multiline
            onChangeText={(value) => {
              setManualCode(value);
              setPreview(undefined);
            }}
            placeholder="Pairing code"
            placeholderTextColor={palette.dim}
            style={styles.codeInput}
            value={manualCode}
          />
          <Button
            disabled={busy || manualCode.trim().length === 0}
            fullWidth
            label="Check code"
            onPress={() => inspect()}
            style={styles.checkAction}
          />

          {preview ? (
            <View style={styles.previewCard}>
              <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.previewEyebrow}>
                Ready to pair
              </Text>
              <Text dynamicTypeRamp={typeRamp.headline} style={styles.previewName}>
                {pairingPreviewName(preview)}
              </Text>
              <Text
                dynamicTypeRamp={typeRamp.subheadline}
                numberOfLines={2}
                style={styles.previewOrigin}
              >
                {pairingPreviewOrigin(preview)}
              </Text>
              <Text dynamicTypeRamp={typeRamp.footnote} style={styles.previewMeta}>
                {preview.kind === "notification"
                  ? `${authModeDescription(preview.code.authMode)} ${
                      expired
                        ? "This code expired. Create a new one on the server."
                        : `Expires in ${secondsLeft} seconds.`
                    }`
                  : `${authModeDescription("basic")}${
                      preview.prepared.allowDevelopmentHttp
                        ? " Uses HTTP, which is not encrypted."
                        : ""
                    }`}
              </Text>
              <View style={styles.previewActions}>
                <Button
                  busy={busy}
                  disabled={expired}
                  fullWidth
                  label={approvesHttp ? "Approve HTTP and pair" : "Pair and save"}
                  onPress={() => void pair()}
                  variant="primary"
                />
                {preview.kind === "opencode" ? (
                  <Button
                    disabled={busy}
                    fullWidth
                    label={
                      approvesHttp
                        ? "Approve HTTP and pair without notifications"
                        : "Pair without notifications"
                    }
                    onPress={() => void pairWithoutNotifications()}
                  />
                ) : null}
                {busy ? (
                  <Button
                    disabled={cancelling}
                    fullWidth
                    label={cancelling ? "Cancelling…" : "Cancel"}
                    onPress={cancelAttempt}
                    variant="text"
                    align="center"
                  />
                ) : null}
              </View>
            </View>
          ) : null}
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              dynamicTypeRamp={typeRamp.subheadline}
              style={styles.error}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>
      </FormKeyboardAvoidingView>
    </SafeAreaView>
  );
}

async function checkOpenCode(client: ReturnType<typeof createOpenCodeClient>, signal: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, openCodeTimeoutMs);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  try {
    const options = { signal: controller.signal };
    const [health] = await Promise.all([
      client.server.status(options),
      client.session.list({ limit: 1, order: "desc" }, options),
    ]);
    return health;
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

function authModeDescription(mode: NotificationPairingCode["authMode"]) {
  if (mode === "basic") return "Signs in with a username and password.";
  if (mode === "bearer") return "Signs in with a token.";
  return "No sign-in needed.";
}

function bootstrapCredential(
  auth:
    | { mode: "basic"; password: string; username: string }
    | { mode: "bearer"; token: string }
    | { mode: "none" },
): ConnectionCredential | undefined {
  if (auth.mode === "basic") return { ...auth, schemaVersion: 1 };
  if (auth.mode === "bearer") return { ...auth, schemaVersion: 1 };
  return undefined;
}

type PairingStage =
  | "broker-issue"
  | "broker-registration"
  | "connection-save"
  | "opencode-validation"
  | "pairing-save"
  | "push-registration"
  | "secure-storage";

function pairingErrorMessage(error: unknown, stage?: PairingStage) {
  const code = error instanceof Error ? error.message : "PAIRING_FAILED";
  if (code === "NOTIFICATION_PERMISSION_DENIED") {
    return "Notifications are disabled. Allow notifications in system settings, then try again.";
  }
  if (code === "PUSH_REQUIRES_PHYSICAL_DEVICE") {
    return "Remote push pairing requires a physical iOS or Android device.";
  }
  if (code === "PAIRING_CODE_EXPIRED" || code === "PAIRING_UNAVAILABLE") {
    return "This pairing code expired or was already used. Create a new code on the server.";
  }
  if (code === "PAIRING_OPENCODE_TIMEOUT") {
    return "The OpenCode server did not respond within 10 seconds. Check that it is running and reachable.";
  }
  if (code === "PAIRING_OPENCODE_UNAUTHORIZED") {
    return "The OpenCode server rejected the credentials in this pairing code.";
  }
  if (code === "PAIRING_ORIGIN_HOST_MISMATCH") {
    return "OpenCode and the notification broker must use the same host for /pair setup.";
  }
  if (code === "PAIRING_OPENCODE_PORT_MISMATCH") {
    return "The notification broker does not allow pairing with this OpenCode port.";
  }
  if (code === "PAIRING_ISSUE_MISMATCH") {
    return "The notification broker returned a different server than the one you approved.";
  }
  if (code === "PAIRING_RATE_LIMITED") {
    return "Too many pairing attempts. Wait one minute, then create a new OpenCode code.";
  }
  if (code === "PAIRING_BROKER_IS_LOOPBACK") {
    return "The broker address points to this phone. Use the server's LAN or Tailscale address.";
  }
  if (code === "PAIRING_OPENCODE_IS_LOOPBACK") {
    return "The OpenCode address points to this phone. Use the server's LAN or Tailscale address.";
  }
  if (code.includes("HTTP")) return "The pairing code did not approve this unencrypted address.";
  if (/^INVALID_(OPENCODE_)?PAIRING/.test(code)) {
    return "The pairing code is malformed or was altered.";
  }
  if (stage === "push-registration") {
    if (code === "EAS_PROJECT_ID_MISSING") {
      return "Push registration requires an EAS project ID in the app deployment configuration.";
    }
    return "Push registration failed. Check this device's notification settings and try again.";
  }
  if (stage === "secure-storage" || stage === "pairing-save") {
    return "The notification key could not be saved securely on this device.";
  }
  if (stage === "broker-registration") {
    const brokerCode = /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? ` (${code})` : "";
    return `The notification broker rejected or could not complete this pairing code${brokerCode}.`;
  }
  if (stage === "broker-issue") {
    return "The notification broker could not verify this OpenCode pairing code.";
  }
  if (stage === "opencode-validation") {
    return "The paired OpenCode address or credentials could not be validated.";
  }
  if (stage === "connection-save") {
    return "The validated OpenCode connection could not be saved on this device.";
  }
  return "Pairing failed. Check that the OpenCode server and notification broker are reachable.";
}

type PairingPreview =
  | { code: NotificationPairingCode; kind: "notification" }
  | { kind: "opencode"; prepared: ReturnType<typeof prepareOpenCodeDevicePairing> };

function pairingPreviewName(preview: PairingPreview) {
  return preview.kind === "notification" ? preview.code.name : preview.prepared.name;
}

function pairingPreviewOrigin(preview: PairingPreview) {
  return preview.kind === "notification"
    ? preview.code.openCodeOrigin
    : preview.prepared.openCodeOrigin;
}

const styles = StyleSheet.create({
  camera: { aspectRatio: 1 },
  cameraFrame: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: space.lg,
    overflow: "hidden",
  },
  cameraFooter: { gap: space.sm, padding: space.md },
  cameraHint: { ...typography.subheadline, color: palette.dim, textAlign: "center" },
  checkAction: { marginTop: space.sm },
  codeInput: {
    ...typography.code,
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: palette.ink,
    minHeight: 116,
    padding: space.md,
    textAlignVertical: "top",
  },
  content: { padding: space.md, paddingBottom: space.xl },
  copy: { ...typography.subheadline, color: palette.dim },
  divider: { backgroundColor: palette.border, flex: 1, height: StyleSheet.hairlineWidth },
  dividerLabel: { ...typography.footnote, color: palette.dim },
  dividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    marginVertical: space.lg,
  },
  doneButton: {
    alignItems: "flex-end",
    justifyContent: "center",
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingLeft: space.sm,
  },
  doneLabel: { ...typography.navTitle, color: palette.signal },
  error: { ...typography.subheadline, color: palette.danger, marginTop: space.md },
  flex: { flex: 1 },
  header: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: space.md,
  },
  headerTitle: { ...typography.navTitle, color: palette.ink, flex: 1 },
  pressed: { opacity: pressedOpacity },
  previewActions: { gap: space.sm, marginTop: space.lg },
  previewCard: { ...cardSurface, marginTop: space.lg },
  previewEyebrow: { ...typography.sectionLabel, color: palette.success },
  previewMeta: { ...typography.footnote, color: palette.dim, marginTop: space.sm },
  previewName: { ...typography.headline, color: palette.ink, marginTop: space.xs },
  previewOrigin: { ...typography.subheadline, color: palette.ink, marginTop: space.xs },
  safeArea: { backgroundColor: palette.background, flex: 1 },
  scanAction: { marginTop: space.lg },
  scanError: { ...typography.subheadline, color: palette.danger, textAlign: "center" },
});
