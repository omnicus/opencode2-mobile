import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export async function registerForOpenCodePushNotifications() {
  if (!Device.isDevice) throw new Error("PUSH_REQUIRES_PHYSICAL_DEVICE");
  const platform = Platform.OS;
  if (platform !== "ios" && platform !== "android") {
    throw new Error("PUSH_PLATFORM_UNSUPPORTED");
  }
  await configureAndroidChannel();
  let permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== "granted") permissions = await Notifications.requestPermissionsAsync();
  if (permissions.status !== "granted") throw new Error("NOTIFICATION_PERMISSION_DENIED");
  return getExpoRegistration(platform);
}

export async function getExistingOpenCodePushRegistration() {
  if (!Device.isDevice || (Platform.OS !== "ios" && Platform.OS !== "android")) return undefined;
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== "granted") return undefined;
  await configureAndroidChannel();
  return getExpoRegistration(Platform.OS);
}

async function getExpoRegistration(platform: "android" | "ios") {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== "string" || !projectId) throw new Error("EAS_PROJECT_ID_MISSING");
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return {
    deviceName: Device.deviceName?.trim() || `${Platform.OS} device`,
    expoPushToken: token.data,
    platform,
  } as const;
}

async function configureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("opencode-attention", {
    importance: Notifications.AndroidImportance.HIGH,
    name: "OpenCode attention",
    sound: "default",
  });
}
