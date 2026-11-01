import * as LocalAuthentication from "expo-local-authentication";

import { applicationName } from "../application-name";

type LocalAuthenticationApi = Pick<
  typeof LocalAuthentication,
  "authenticateAsync" | "getEnrolledLevelAsync"
>;

export type DeviceAuthenticationResult = "AUTHENTICATED" | "CANCELLED" | "UNAVAILABLE";

// Biometrics are optional: a device with only a passcode, PIN, or pattern can still unlock.
export async function authenticateDeviceOwner(
  api: LocalAuthenticationApi = LocalAuthentication,
): Promise<DeviceAuthenticationResult> {
  const level = await api.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) return "UNAVAILABLE";

  const result = await api.authenticateAsync({
    biometricsSecurityLevel: "strong",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
    fallbackLabel: "Use Device Passcode",
    promptMessage: `Unlock ${applicationName}`,
  });
  if (result.success) return "AUTHENTICATED";
  return result.error === "not_enrolled" || result.error === "passcode_not_set"
    ? "UNAVAILABLE"
    : "CANCELLED";
}
