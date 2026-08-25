import {
  type NotificationPairingCode,
  parseNotificationPairingCode,
} from "@opencode2-mobile/notification-protocol";
import { createOpenCodeClient, normalizeOpenCodeBaseUrl } from "@opencode2-mobile/opencode-adapter";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { palette, radius, space } from "../theme";

export function NotificationPairingScreen({ onDone }: { onDone: () => void }) {
  const db = useSQLiteContext();
  const connections = useConnections();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<PairingPreview>();
  const pairingMaterial = useRef<ReturnType<typeof createNotificationPairingMaterial> | undefined>(
    undefined,
  );

  function inspect(value = manualCode) {
    setError(undefined);
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
        setError(
          pairingErrorMessage(
            caught instanceof Error && caught.message === "PAIRING_CODE_EXPIRED"
              ? caught
              : openCodeError,
          ),
        );
      }
    }
  }

  async function openScanner() {
    setError(undefined);
    if (!cameraPermission?.granted) {
      const next = await requestCameraPermission();
      if (!next.granted) {
        setError("Camera access was denied. Paste the pairing code instead.");
        return;
      }
    }
    setScanning(true);
  }

  async function pair() {
    if (!preview || busy) return;
    setBusy(true);
    setError(undefined);
    let pendingRevocation:
      | Awaited<ReturnType<typeof stagePendingNotificationRevocation>>
      | undefined;
    let savedConnectionId: string | undefined;
    let stage: PairingStage = "push-registration";
    try {
      const push = await registerForOpenCodePushNotifications();
      stage = "broker-issue";
      const code =
        preview.kind === "notification"
          ? preview.code
          : await issueNotificationPairingFromOpenCode(preview.prepared);
      pairingMaterial.current ??= createNotificationPairingMaterial();
      stage = "secure-storage";
      pendingRevocation = await stagePendingNotificationRevocation(db, {
        bindingID: pairingMaterial.current.bindingID,
        brokerOrigin: code.brokerOrigin,
        deviceKey: pairingMaterial.current.deviceKey,
      });
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
      );
      const credential = bootstrapCredential(registered.bootstrap.auth);
      const baseUrl = normalizeOpenCodeBaseUrl(registered.bootstrap.baseUrl);
      const client = createOpenCodeClient({
        ...(credential ? { authorization: connectionAuthorizationHeader(credential) } : {}),
        baseUrl,
        fetch: boundedOpenCodeFetch,
      });
      stage = "opencode-validation";
      const [health] = await Promise.all([
        client.health.get(),
        client.server.get(),
        client.session.list({ limit: 1, order: "desc" }),
      ]);
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
      onDone();
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
      setError(
        connectionRollbackFailed
          ? "Pairing failed after saving the connection. Remove it from Connections before retrying."
          : pairingErrorMessage(caught, stage),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>SECURE SETUP</Text>
              <Text accessibilityRole="header" style={styles.title}>
                Pair this phone
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onDone} style={styles.closeButton}>
              <Text style={styles.closeLabel}>CLOSE</Text>
            </Pressable>
          </View>
          <Text style={styles.copy}>
            The code configures one OpenCode server and its notification broker. Credentials are
            decrypted on this phone and stored in the device keychain.
          </Text>

          {scanning ? (
            <View style={styles.cameraFrame}>
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => inspect(data)}
                style={styles.camera}
              />
              <Text style={styles.cameraHint}>Center the terminal QR code in the frame.</Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void openScanner()}
              style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}
            >
              <Text style={styles.scanLabel}>SCAN QR CODE</Text>
            </Pressable>
          )}

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerLabel}>OR PASTE</Text>
            <View style={styles.divider} />
          </View>
          <TextInput
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
          <Pressable
            accessibilityRole="button"
            disabled={busy || manualCode.trim().length === 0}
            onPress={() => inspect()}
            style={({ pressed }) => [styles.inspectButton, pressed && styles.pressed]}
          >
            <Text style={styles.inspectLabel}>CHECK CODE</Text>
          </Pressable>

          {preview ? (
            <View style={styles.previewCard}>
              <Text style={styles.previewEyebrow}>READY TO PAIR</Text>
              <Text style={styles.previewName}>{pairingPreviewName(preview)}</Text>
              <Text numberOfLines={2} style={styles.previewOrigin}>
                {pairingPreviewOrigin(preview)}
              </Text>
              <Text style={styles.previewMeta}>
                {preview.kind === "notification"
                  ? `Authentication: ${preview.code.authMode} | Expires in ${Math.max(
                      0,
                      Math.ceil((preview.code.expiresAtMs - Date.now()) / 1_000),
                    )} seconds`
                  : `OpenCode /pair | Authentication: basic${
                      preview.prepared.allowDevelopmentHttp ? " | Approves HTTP transport" : ""
                    }`}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void pair()}
                style={({ pressed }) => [styles.pairButton, pressed && styles.pressed]}
              >
                {busy ? (
                  <ActivityIndicator color={palette.background} />
                ) : (
                  <Text style={styles.pairLabel}>
                    {preview.kind === "opencode" && preview.prepared.allowDevelopmentHttp
                      ? "APPROVE HTTP + PAIR"
                      : "PAIR AND SAVE"}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}
          {error ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
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
  if (code.includes("INVALID_PAIRING")) return "The pairing code is malformed or was altered.";
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
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: space.lg,
    overflow: "hidden",
  },
  cameraHint: { color: palette.dim, fontSize: 13, padding: space.md, textAlign: "center" },
  closeButton: { justifyContent: "center", minHeight: 44, paddingLeft: space.md },
  closeLabel: { color: palette.dim, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  codeInput: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: palette.ink,
    fontFamily: Platform.select({ android: "monospace", ios: "Menlo" }),
    fontSize: 12,
    minHeight: 116,
    padding: space.md,
    textAlignVertical: "top",
  },
  content: { padding: space.lg, paddingBottom: 48 },
  copy: { color: palette.dim, fontSize: 16, lineHeight: 24, marginTop: space.md },
  divider: { backgroundColor: palette.border, flex: 1, height: 1 },
  dividerLabel: { color: palette.dim, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  dividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    marginVertical: space.lg,
  },
  error: { color: palette.danger, fontSize: 14, lineHeight: 20, marginTop: space.md },
  eyebrow: { color: palette.signal, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  flex: { flex: 1 },
  headerCopy: { flex: 1 },
  headerRow: { alignItems: "flex-start", flexDirection: "row" },
  inspectButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: space.sm,
    minHeight: 48,
    justifyContent: "center",
  },
  inspectLabel: { color: palette.ink, fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  pairButton: {
    alignItems: "center",
    backgroundColor: palette.signal,
    borderRadius: radius.sm,
    justifyContent: "center",
    marginTop: space.lg,
    minHeight: 52,
  },
  pairLabel: { color: palette.background, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  pressed: { opacity: 0.65 },
  previewCard: {
    backgroundColor: palette.signalDark,
    borderColor: palette.signal,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: space.lg,
    padding: space.lg,
  },
  previewEyebrow: { color: palette.signal, fontSize: 11, fontWeight: "800", letterSpacing: 1.3 },
  previewMeta: { color: palette.dim, fontSize: 13, lineHeight: 19, marginTop: space.sm },
  previewName: { color: palette.ink, fontSize: 23, fontWeight: "800", marginTop: space.xs },
  previewOrigin: { color: palette.ink, fontSize: 14, marginTop: space.xs },
  safeArea: { backgroundColor: palette.background, flex: 1 },
  scanButton: {
    alignItems: "center",
    backgroundColor: palette.signal,
    borderRadius: radius.md,
    justifyContent: "center",
    marginTop: space.lg,
    minHeight: 56,
  },
  scanLabel: { color: palette.background, fontSize: 14, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: palette.ink, fontSize: 32, fontWeight: "800", letterSpacing: -0.8, marginTop: 5 },
});
