import type { NotificationDeliveryState } from "@opencode2-mobile/notification-protocol";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { SQLiteDatabase } from "expo-sqlite";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useAnnouncement } from "../components/use-announcement";
import type { RootStackParamList } from "../navigation/root-navigation";
import { sendNotificationDeviceCommand } from "../notifications/notification-client";
import {
  getNotificationPairingByConnectionID,
  type NotificationPairing,
  readNotificationPairingSecret,
} from "../notifications/notification-pairing-repository";

export function useNotificationSetting(
  db: SQLiteDatabase,
  connectionID: string | undefined,
  navigation: Pick<NativeStackNavigationProp<RootStackParamList, "Settings">, "addListener">,
) {
  const [pairing, setPairing] = useState<NotificationPairing>();
  const [state, setState] = useState<NotificationDeliveryState>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useAnnouncement(error && "Notification settings could not be loaded or saved.");

  useEffect(() => {
    let active = true;
    async function refresh() {
      setLoading(true);
      setError(false);
      try {
        const current = connectionID
          ? await getNotificationPairingByConnectionID(db, connectionID)
          : undefined;
        if (!active) return;
        setPairing(current);
        if (!current) {
          setState(undefined);
          return;
        }
        const secret = await readNotificationPairingSecret(current);
        const status = await sendNotificationDeviceCommand({
          bindingID: current.bindingID,
          brokerOrigin: current.brokerOrigin,
          deviceKey: secret.deviceKey,
          operation: "status",
        });
        if (active) setState(status);
      } catch {
        if (active) {
          setState(undefined);
          setError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") void refresh();
    });
    // Pairing opens over Settings, so read the pairing again when Settings returns.
    const removeFocusListener = navigation.addListener("focus", () => void refresh());
    return () => {
      active = false;
      subscription.remove();
      removeFocusListener();
    };
  }, [connectionID, db, navigation]);

  async function setEnabled(enabled: boolean) {
    if (!pairing) return;
    setBusy(true);
    setError(false);
    try {
      const secret = await readNotificationPairingSecret(pairing);
      const next = await sendNotificationDeviceCommand({
        bindingID: pairing.bindingID,
        brokerOrigin: pairing.brokerOrigin,
        deviceKey: secret.deviceKey,
        operation: enabled ? "enable" : "pause",
      });
      setState(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, loading, pairing, setEnabled, state };
}
