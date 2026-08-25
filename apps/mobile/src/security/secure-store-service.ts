import Constants from "expo-constants";
import { Platform } from "react-native";

const fallbackApplicationIdentifier = "dev.opencode2.mobile";

export function secureStoreService(suffix: "connections" | "drafts" | "notifications") {
  const applicationIdentifier =
    (Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.bundleIdentifier
      : Constants.expoConfig?.android?.package) ?? fallbackApplicationIdentifier;
  return `${applicationIdentifier}.${suffix}`;
}
