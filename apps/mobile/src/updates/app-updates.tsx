import * as Updates from "expo-updates";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { palette, radius, space } from "../theme";
import { AppUpdateController } from "./app-update-controller";
import { prepareAppReload } from "./prepare-app-reload";

const AppUpdateContext = createContext<AppUpdateController | undefined>(undefined);

export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  const native = Updates.useUpdates();
  const [controller] = useState(
    () =>
      new AppUpdateController({
        enabled: !__DEV__ && Updates.isEnabled,
        check: Updates.checkForUpdateAsync,
        download: Updates.fetchUpdateAsync,
        prepare: prepareAppReload,
        reload: Updates.reloadAsync,
      }),
  );

  useEffect(() => {
    if (native.isUpdatePending) controller.markDownloaded();
    if (native.isStartupProcedureRunning) return;
    if (AppState.currentState === "active") void controller.check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void controller.check();
    });
    return () => subscription.remove();
  }, [controller, native.isStartupProcedureRunning, native.isUpdatePending]);

  return (
    <AppUpdateContext value={controller}>
      {children}
      <RestartOverlay controller={controller} />
    </AppUpdateContext>
  );
}

function RestartOverlay({ controller }: { controller: AppUpdateController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return (
    <Modal
      animationType="none"
      onRequestClose={() => {}}
      transparent
      visible={state.phase === "restarting"}
    >
      <View accessibilityViewIsModal style={styles.restartOverlay}>
        <ActivityIndicator color={palette.signal} />
        <Text accessibilityLiveRegion="polite" style={styles.title}>
          Saving drafts and restarting…
        </Text>
      </View>
    </Modal>
  );
}

export function AppUpdateCard() {
  const controller = use(AppUpdateContext);
  return controller ? <UpdateControls controller={controller} /> : null;
}

export function AppUpdateBanner() {
  const controller = use(AppUpdateContext);
  const insets = useSafeAreaInsets();
  return controller ? (
    <UpdateControls bottomInset={insets.bottom} compact controller={controller} />
  ) : null;
}

function UpdateControls({
  bottomInset = 0,
  compact = false,
  controller,
}: {
  bottomInset?: number;
  compact?: boolean;
  controller: AppUpdateController;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const ready = state.phase === "ready";
  const busy = ["checking", "downloading", "restarting"].includes(state.phase);
  if (compact && !ready && state.phase !== "restarting") return null;
  const copy = {
    disabled: "App updates are available in a signed build with EAS Update enabled.",
    idle: "Get compatibility fixes without connecting to your OpenCode server.",
    checking: "Checking for an app update…",
    downloading: "Downloading an app update…",
    current: "No newer update is available for this app build.",
    ready: "An app update is ready. Restart when you're ready to apply it.",
    restarting: "Saving drafts and restarting…",
  }[state.phase];

  return (
    <View style={[styles.card, compact && { paddingBottom: Math.max(bottomInset, space.sm) }]}>
      {!compact ? (
        <Text accessibilityRole="header" style={styles.title}>
          App updates
        </Text>
      ) : null}
      <Text accessibilityLiveRegion="polite" style={styles.copy}>
        {copy}
      </Text>
      {state.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {state.error}
        </Text>
      ) : null}
      {state.phase !== "disabled" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void (ready ? controller.restart() : controller.check(true))}
          style={({ pressed }) => [styles.button, (busy || pressed) && styles.dimmed]}
        >
          <Text style={styles.label}>
            {ready ? "Restart to apply update" : "Check for app updates"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  restartOverlay: {
    flex: 1,
    backgroundColor: palette.background,
    alignItems: "center",
    justifyContent: "center",
    padding: space.lg,
    gap: space.md,
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  title: { color: palette.ink, fontSize: 17, fontWeight: "700" },
  copy: { color: palette.dim, fontSize: 14, lineHeight: 20 },
  error: { color: palette.danger, fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingVertical: space.sm,
  },
  label: { color: palette.signal, fontSize: 15, fontWeight: "700" },
  dimmed: { opacity: 0.5 },
});
