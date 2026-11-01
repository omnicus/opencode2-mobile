import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";

// accessibilityLiveRegion only works on Android, so iOS needs an explicit announcement.
// Android keeps relying on live regions to avoid reading the same text twice.
export function announceOnIOS(message: string | undefined) {
  if (Platform.OS !== "ios" || !message) return;
  AccessibilityInfo.announceForAccessibility(message);
}

export function useAnnouncement(message: string | undefined | false) {
  const text = message || undefined;
  useEffect(() => {
    announceOnIOS(text);
  }, [text]);
}
