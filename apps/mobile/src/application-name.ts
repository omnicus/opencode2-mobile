import Constants from "expo-constants";
import { Platform } from "react-native";

export const applicationName = Constants.expoConfig?.name ?? "OpenCode2 Mobile";
export const applicationVersion = Constants.expoConfig?.version ?? "unknown";
export const applicationBuild =
  Platform.OS === "ios"
    ? (Constants.expoConfig?.ios?.buildNumber ?? "unknown")
    : String(Constants.expoConfig?.android?.versionCode ?? "unknown");
