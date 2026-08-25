import * as LocalAuthentication from "expo-local-authentication";

import { applicationName } from "../application-name";

type LocalAuthenticationApi = Pick<
  typeof LocalAuthentication,
  "authenticateAsync" | "hasHardwareAsync" | "isEnrolledAsync"
>;

export type DeviceAuthenticationResult = "AUTHENTICATED" | "CANCELLED" | "UNAVAILABLE";

export async function authenticateDeviceOwner(
  api: LocalAuthenticationApi = LocalAuthentication,
): Promise<DeviceAuthenticationResult> {
  const [hasHardware, isEnrolled] = await Promise.all([
    api.hasHardwareAsync(),
    api.isEnrolledAsync(),
  ]);
  if (!hasHardware || !isEnrolled) return "UNAVAILABLE";

  const result = await api.authenticateAsync({
    biometricsSecurityLevel: "strong",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
    fallbackLabel: "Use Device Passcode",
    promptMessage: `Unlock ${applicationName}`,
  });
  return result.success ? "AUTHENTICATED" : "CANCELLED";
}
