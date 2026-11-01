import { CameraView, useCameraPermissions } from "expo-camera";
import { useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
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
import { useConnections } from "../connections/connections-context";
import type { createNotificationPairingMaterial } from "../notifications/notification-client";
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
import { notificationPairingActions } from "./notification-pairing-actions";
import {
  type PairingPreview,
  pairingExpiresAtMs,
  pairingPreviewApprovesHttp,
  pairingPreviewMeta,
  pairingPreviewName,
  pairingPreviewOrigin,
  pairingSecondsLeft,
} from "./notification-pairing-model";

export function NotificationPairingScreen({ onDone }: { onDone: () => void }) {
  const db = useSQLiteContext();
  const connections = useConnections();
  const state = useNotificationPairingState();
  const actions = notificationPairingActions(state, { connections, db, onDone });
  const { busy, error, manualCode, preview } = state;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <PairingHeader onDone={onDone} />
      <FormKeyboardAvoidingView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
            Run /pair in OpenCode on your computer, then scan the code it shows. Notifications are
            set up when available; otherwise the app connects without them. Credentials are stored
            in the device keychain.
          </Text>

          <PairingScanner
            busy={busy}
            cameraBlocked={state.cameraBlocked}
            onClose={actions.closeScanner}
            onOpen={() => void actions.openScanner()}
            onScanned={actions.scanned}
            scanError={state.scanError}
            scanning={state.scanning}
          />

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
            onChangeText={actions.editCode}
            placeholder="Pairing code"
            placeholderTextColor={palette.dim}
            style={styles.codeInput}
            value={manualCode}
          />
          <Button
            disabled={busy || manualCode.trim().length === 0}
            fullWidth
            label="Check code"
            onPress={() => actions.inspect()}
            style={styles.checkAction}
          />

          {preview ? (
            <PairingPreviewCard
              busy={busy}
              cancelling={state.cancelling}
              expired={state.expired}
              onCancel={actions.cancelAttempt}
              onPair={() => void actions.pair()}
              onPairWithoutNotifications={() => void actions.pairWithoutNotifications()}
              preview={preview}
              secondsLeft={state.secondsLeft}
            />
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

function useNotificationPairingState() {
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
  const expiresAtMs = pairingExpiresAtMs(preview);
  const secondsLeft = pairingSecondsLeft(expiresAtMs, now);
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

  return {
    attempt,
    busy,
    cameraBlocked,
    cameraPermission,
    cancelling,
    error,
    expired,
    lastScan,
    manualCode,
    mounted,
    pairingMaterial,
    preview,
    requestCameraPermission,
    scanError,
    scanning,
    secondsLeft,
    setBusy,
    setCameraBlocked,
    setCancelling,
    setError,
    setManualCode,
    setPreview,
    setScanError,
    setScanning,
  };
}

function PairingHeader({ onDone }: { onDone: () => void }) {
  return (
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
  );
}

function PairingScanner({
  busy,
  cameraBlocked,
  onClose,
  onOpen,
  onScanned,
  scanError,
  scanning,
}: {
  busy: boolean;
  cameraBlocked: boolean;
  onClose: () => void;
  onOpen: () => void;
  onScanned: (data: string) => void;
  scanError: string | undefined;
  scanning: boolean;
}) {
  return (
    <>
      {scanning ? (
        <View style={styles.cameraFrame}>
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => onScanned(data)}
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
            <Button fullWidth label="Cancel scan" onPress={onClose} />
          </View>
        </View>
      ) : (
        <Button
          disabled={busy}
          fullWidth
          icon="camera"
          label="Scan QR code"
          onPress={onOpen}
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
    </>
  );
}

function PairingPreviewCard({
  busy,
  cancelling,
  expired,
  onCancel,
  onPair,
  onPairWithoutNotifications,
  preview,
  secondsLeft,
}: {
  busy: boolean;
  cancelling: boolean;
  expired: boolean;
  onCancel: () => void;
  onPair: () => void;
  onPairWithoutNotifications: () => void;
  preview: PairingPreview;
  secondsLeft: number | undefined;
}) {
  const approvesHttp = pairingPreviewApprovesHttp(preview);
  return (
    <View style={styles.previewCard}>
      <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.previewEyebrow}>
        Ready to pair
      </Text>
      <Text dynamicTypeRamp={typeRamp.headline} style={styles.previewName}>
        {pairingPreviewName(preview)}
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} numberOfLines={2} style={styles.previewOrigin}>
        {pairingPreviewOrigin(preview)}
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.previewMeta}>
        {pairingPreviewMeta(preview, secondsLeft)}
      </Text>
      <View style={styles.previewActions}>
        <Button
          busy={busy}
          disabled={expired}
          fullWidth
          label={approvesHttp ? "Approve HTTP and pair" : "Pair and save"}
          onPress={onPair}
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
            onPress={onPairWithoutNotifications}
          />
        ) : null}
        {busy ? (
          <Button
            disabled={cancelling}
            fullWidth
            label={cancelling ? "Cancelling…" : "Cancel"}
            onPress={onCancel}
            variant="text"
            align="center"
          />
        ) : null}
      </View>
    </View>
  );
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
