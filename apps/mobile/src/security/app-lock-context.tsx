import { useSQLiteContext } from "expo-sqlite";
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { applicationName } from "../application-name";
import { palette, radius, space } from "../theme";
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
        pendingUnlockRef.current = false;
      }
      if (nextState !== "active") {
        setLocked(true);
      } else if (pendingUnlockRef.current && !unlockBackgroundedRef.current) {
        pendingUnlockRef.current = false;
        setLocked(false);
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

  async function authenticate() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await authenticateDeviceOwner();
      if (result === "UNAVAILABLE") {
        setError("Set up Face ID, Touch ID, or fingerprint authentication on this device first.");
        return false;
      }
      if (result === "CANCELLED") {
        setError("Device authentication was not completed.");
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
    else pendingUnlockRef.current = true;
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
        <View style={styles.shell}>
          <ActivityIndicator accessibilityLabel="Loading app lock" color={palette.signal} />
        </View>
      ) : preferenceLoadFailed ? (
        <View style={styles.shell}>
          <Text style={styles.errorEyebrow}>DEVICE LOCK UNAVAILABLE</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Secure preferences could not be read.
          </Text>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={retryPreferenceLoad}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonLabel}>RETRY</Text>
          </Pressable>
        </View>
      ) : enabled && locked ? (
        <View style={styles.shell}>
          <Text style={styles.eyebrow}>DEVICE LOCK</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {applicationName} is locked.
          </Text>
          <Text style={styles.copy}>Authenticate on this device to reveal saved connections.</Text>
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={unlock}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            {busy ? <ActivityIndicator color={palette.background} /> : null}
            <Text style={styles.buttonLabel}>{busy ? "AUTHENTICATING" : "UNLOCK"}</Text>
          </Pressable>
        </View>
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
  button: {
    alignItems: "center",
    backgroundColor: palette.signal,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "center",
    marginTop: space.lg,
    minHeight: 52,
    paddingHorizontal: space.lg,
  },
  buttonLabel: {
    color: palette.background,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  buttonPressed: { backgroundColor: "#9BD955" },
  copy: {
    color: palette.dim,
    fontSize: 16,
    lineHeight: 24,
    marginTop: space.md,
    maxWidth: 440,
  },
  error: {
    color: palette.danger,
    fontSize: 14,
    lineHeight: 20,
    marginTop: space.md,
  },
  errorEyebrow: {
    color: palette.danger,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  eyebrow: {
    color: palette.signal,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  shell: {
    backgroundColor: palette.background,
    flex: 1,
    justifyContent: "center",
    padding: 28,
  },
  title: {
    color: palette.ink,
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.8,
    lineHeight: 38,
    marginTop: space.sm,
  },
});
