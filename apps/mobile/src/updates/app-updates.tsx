import * as Updates from "expo-updates";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { ActivityIndicator, AppState, Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../components/button";
import { SettingsGroup } from "../components/management-layout";
import { useAnnouncement } from "../components/use-announcement";
import { cardSurface, palette, space, typeRamp, typography } from "../theme";
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
  useAnnouncement(state.phase === "restarting" && "Saving drafts and restarting…");
  return (
    <Modal
      animationType="none"
      onRequestClose={() => {}}
      transparent
      visible={state.phase === "restarting"}
    >
      <View accessibilityViewIsModal style={styles.restartOverlay}>
        <ActivityIndicator color={palette.signal} />
        <Text
          accessibilityLiveRegion="polite"
          dynamicTypeRamp={typeRamp.headline}
          style={styles.title}
        >
          Saving drafts and restarting…
        </Text>
      </View>
    </Modal>
  );
}

// Settings passes grouped, so updates sit in the same section style as every other setting.
export function AppUpdateCard({ grouped = false }: { grouped?: boolean }) {
  const controller = use(AppUpdateContext);
  if (!controller) return null;
  return grouped ? (
    <SettingsGroup title="App updates">
      <UpdateControls controller={controller} grouped />
    </SettingsGroup>
  ) : (
    <UpdateControls controller={controller} />
  );
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
  grouped = false,
}: {
  bottomInset?: number;
  compact?: boolean;
  controller: AppUpdateController;
  grouped?: boolean;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const ready = state.phase === "ready";
  const busy = ["checking", "downloading", "restarting"].includes(state.phase);
  if (compact && !ready && state.phase !== "restarting") return null;
  const copy = {
    disabled: "This build of the app doesn't receive updates.",
    idle: "Get compatibility fixes without connecting to your OpenCode server.",
    checking: "Checking for an app update…",
    downloading: "Downloading an app update…",
    current: "No newer update is available for this app build.",
    ready: "An app update is ready. Restart when you're ready to apply it.",
    restarting: "Saving drafts and restarting…",
  }[state.phase];

  return (
    <View
      style={[
        grouped ? styles.grouped : styles.card,
        compact && { paddingBottom: Math.max(bottomInset, space.sm) },
      ]}
    >
      {!compact && !grouped ? (
        <Text accessibilityRole="header" dynamicTypeRamp={typeRamp.headline} style={styles.title}>
          App updates
        </Text>
      ) : null}
      <Text
        accessibilityLiveRegion="polite"
        dynamicTypeRamp={typeRamp.subheadline}
        style={styles.copy}
      >
        {copy}
      </Text>
      {state.error ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
          {state.error}
        </Text>
      ) : null}
      {state.phase !== "disabled" ? (
        <Button
          busy={busy}
          label={ready ? "Restart to apply update" : "Check for app updates"}
          onPress={() => void (ready ? controller.restart() : controller.check(true))}
          variant={ready ? "primary" : "secondary"}
        />
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
  card: { ...cardSurface, borderWidth: StyleSheet.hairlineWidth, gap: space.sm },
  grouped: { alignItems: "flex-start", gap: space.sm, padding: space.md },
  title: { ...typography.headline, color: palette.ink },
  copy: { ...typography.subheadline, color: palette.dim },
  error: { ...typography.subheadline, color: palette.danger },
});
