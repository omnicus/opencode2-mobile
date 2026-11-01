import { expect, jest, test } from "@jest/globals";
import { SecurityLevel } from "expo-local-authentication";

import { authenticateDeviceOwner } from "./device-authentication";

test("does not prompt when the device has no passcode or biometrics", async () => {
  const authenticateAsync = jest.fn(async () => ({ success: true as const }));
  const result = await authenticateDeviceOwner({
    authenticateAsync,
    getEnrolledLevelAsync: jest.fn(async () => SecurityLevel.NONE),
  });

  expect(result).toBe("UNAVAILABLE");
  expect(authenticateAsync).not.toHaveBeenCalled();
});

test.each([
  ["a passcode only", SecurityLevel.SECRET],
  ["strong biometrics", SecurityLevel.BIOMETRIC_STRONG],
])("authenticates with %s and keeps the passcode fallback", async (_label, level) => {
  const authenticateAsync = jest.fn(async () => ({ success: true as const }));
  const result = await authenticateDeviceOwner({
    authenticateAsync,
    getEnrolledLevelAsync: jest.fn(async () => level),
  });

  expect(result).toBe("AUTHENTICATED");
  expect(authenticateAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      biometricsSecurityLevel: "strong",
      disableDeviceFallback: false,
    }),
  );
});

test("keeps the app locked after a cancelled prompt", async () => {
  const result = await authenticateDeviceOwner({
    authenticateAsync: jest.fn(async () => ({ error: "user_cancel" as const, success: false })),
    getEnrolledLevelAsync: jest.fn(async () => SecurityLevel.BIOMETRIC_STRONG),
  });

  expect(result).toBe("CANCELLED");
});

test("reports a passcode removed while the prompt was open as unavailable", async () => {
  const result = await authenticateDeviceOwner({
    authenticateAsync: jest.fn(async () => ({
      error: "passcode_not_set" as const,
      success: false,
    })),
    getEnrolledLevelAsync: jest.fn(async () => SecurityLevel.SECRET),
  });

  expect(result).toBe("UNAVAILABLE");
});
