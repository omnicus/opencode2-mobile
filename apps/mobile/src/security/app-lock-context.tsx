import { useSQLiteContext } from "expo-sqlite";
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, AppState, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { applicationName } from "../application-name";
import { Button } from "../components/button";
import { palette, space, typeRamp, typography } from "../theme";
import { authenticateDeviceOwner } from "./device-authentication";

type AppLockContextValue = {
  busy: boolean;
  enabled: boolean;
  error?: string;
  setEnabled: (enabled: boolean) => Promise<void>;
};

const AppLockContext = createContext<AppLockContextValue | undefined>(undefined);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [ready, setReady] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [preferenceLoadFailed, setPreferenceLoadFailed] = useState(false);
  const pendingUnlockRef = useRef(false);
  const unlockBackgroundedRef = useRef(false);
  const unlockInProgressRef = useRef(false);
  // One automatic prompt per foreground visit, so cancelling it does not prompt again.
  const autoPromptedRef = useRef(false);
  const [foregroundVisit, setForegroundVisit] = useState(0);

  useEffect(() => {
    void loadAttempt;
    let active = true;
    db.getFirstAsync<{ app_lock_enabled: number }>(
      "SELECT app_lock_enabled FROM app_preferences WHERE singleton = 1",
    )
      .then((row) => {
        if (!active) return;
        const nextEnabled = row?.app_lock_enabled === 1;
        setPreferenceLoadFailed(false);
        setEnabledState(nextEnabled);
        setLocked(nextEnabled);
      })
      .catch(() => {
        if (active) {
          setPreferenceLoadFailed(true);
          setError("The app-lock preference could not be loaded.");
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [db, loadAttempt]);

  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background") {
        if (unlockInProgressRef.current) unlockBackgroundedRef.current = true;
        else autoPromptedRef.current = false;
        if (pendingUnlockRef.current) setBusy(false);
        pendingUnlockRef.current = false;
      }
      if (nextState !== "active") {
        setLocked(true);
      } else if (pendingUnlockRef.current && !unlockBackgroundedRef.current) {
        pendingUnlockRef.current = false;
        setLocked(false);
        setBusy(false);
      } else {
        setForegroundVisit((visit) => visit + 1);
      }
    });
    return () => subscription.remove();
  }, [enabled]);

  useEffect(() => {
    if (!ready || preferenceLoadFailed || (enabled && locked)) {
      AccessibilityInfo.announceForAccessibility(
        preferenceLoadFailed
          ? "App lock unavailable"
          : enabled && locked
            ? `${applicationName} is locked`
            : "Loading app lock",
      );
    }
  }, [enabled, locked, preferenceLoadFailed, ready]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: unlock is recreated every render
  useEffect(() => {
    void foregroundVisit;
    if (!locked) autoPromptedRef.current = false;
    if (!ready || preferenceLoadFailed || !enabled || !locked) return;
    if (autoPromptedRef.current || unlockInProgressRef.current) return;
    if (AppState.currentState !== "active") return;
    autoPromptedRef.current = true;
    void unlock();
  }, [enabled, foregroundVisit, locked, preferenceLoadFailed, ready]);

  async function authenticate() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await authenticateDeviceOwner();
      if (result === "UNAVAILABLE") {
        setError("Set a passcode or screen lock on this device first.");
        return false;
      }
      if (result === "CANCELLED") {
        setError("Unlock was cancelled. Tap Unlock to try again.");
        return false;
      }
      return true;
    } catch {
      setError("Device authentication is unavailable right now.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(nextEnabled: boolean) {
    if (nextEnabled === enabled || !(await authenticate())) return;
    try {
      await db.runAsync(
        "UPDATE app_preferences SET app_lock_enabled = ? WHERE singleton = 1",
        nextEnabled ? 1 : 0,
      );
      setEnabledState(nextEnabled);
      setLocked(nextEnabled && AppState.currentState !== "active");
      setError(undefined);
    } catch {
      setError("The app-lock preference could not be saved.");
    }
  }

  async function unlock() {
    unlockInProgressRef.current = true;
    unlockBackgroundedRef.current = false;
    pendingUnlockRef.current = false;
    const authenticated = await authenticate();
    unlockInProgressRef.current = false;
    if (!authenticated || unlockBackgroundedRef.current || AppState.currentState === "background") {
      return;
    }
    if (AppState.currentState === "active") setLocked(false);
    else {
      pendingUnlockRef.current = true;
      setBusy(true);
    }
  }

  function retryPreferenceLoad() {
    setReady(false);
    setError(undefined);
    setPreferenceLoadFailed(false);
    setLoadAttempt((attempt) => attempt + 1);
  }

  const value = {
    busy,
    enabled,
    ...(error ? { error } : {}),
    setEnabled,
  };

  return (
    <AppLockContext value={value}>
      {!ready ? (
        <SafeAreaView style={styles.shell}>
          <ActivityIndicator accessibilityLabel="Loading app lock" color={palette.signal} />
        </SafeAreaView>
      ) : preferenceLoadFailed ? (
        <SafeAreaView style={styles.shell}>
          <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.errorEyebrow}>
            Device lock unavailable
          </Text>
          <Text
            accessibilityRole="header"
            dynamicTypeRamp={typeRamp.largeTitle}
            style={styles.title}
          >
            Secure preferences could not be read.
          </Text>
          <Text
            accessibilityRole="alert"
            dynamicTypeRamp={typeRamp.subheadline}
            style={styles.error}
          >
            {error}
          </Text>
          <Button
            label="Retry"
            onPress={retryPreferenceLoad}
            style={styles.action}
            variant="primary"
          />
        </SafeAreaView>
      ) : enabled && locked ? (
        <SafeAreaView style={styles.shell}>
          <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.eyebrow}>
            Device lock
          </Text>
          <Text
            accessibilityRole="header"
            dynamicTypeRamp={typeRamp.largeTitle}
            style={styles.title}
          >
            {applicationName} is locked.
          </Text>
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
            Unlock with Face ID, fingerprint, or your device passcode to see your servers and
            sessions.
          </Text>
          {error ? (
            <Text
              accessibilityRole="alert"
              dynamicTypeRamp={typeRamp.subheadline}
              style={styles.error}
            >
              {error}
            </Text>
          ) : null}
          <Button
            busy={busy}
            label={busy ? "Authenticating…" : "Unlock"}
            onPress={() => void unlock()}
            style={styles.action}
            variant="primary"
          />
        </SafeAreaView>
      ) : (
        children
      )}
    </AppLockContext>
  );
}

export function useAppLock() {
  const value = use(AppLockContext);
  if (!value) throw new Error("AppLockProvider is missing");
  return value;
}

const styles = StyleSheet.create({
  action: { marginTop: space.lg },
  copy: {
    ...typography.subheadline,
    color: palette.dim,
    marginTop: space.md,
    maxWidth: 440,
  },
  error: {
    ...typography.subheadline,
    color: palette.danger,
    marginTop: space.md,
  },
  errorEyebrow: {
    ...typography.sectionLabel,
    color: palette.danger,
  },
  eyebrow: {
    ...typography.sectionLabel,
    color: palette.dim,
  },
  shell: {
    backgroundColor: palette.background,
    flex: 1,
    justifyContent: "center",
    padding: space.lg,
  },
  title: {
    ...typography.largeTitle,
    color: palette.ink,
    marginTop: space.sm,
  },
});
