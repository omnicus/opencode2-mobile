import { expect, jest, test } from "@jest/globals";

import { authenticateDeviceOwner } from "./device-authentication";

test("does not prompt when device authentication is unavailable", async () => {
  const authenticateAsync = jest.fn(async () => ({ success: true as const }));
  const result = await authenticateDeviceOwner({
    authenticateAsync,
    hasHardwareAsync: jest.fn(async () => false),
    isEnrolledAsync: jest.fn(async () => true),
  });

  expect(result).toBe("UNAVAILABLE");
  expect(authenticateAsync).not.toHaveBeenCalled();
});

test("authenticates with strong biometrics and device fallback", async () => {
  const authenticateAsync = jest.fn(async () => ({ success: true as const }));
  const result = await authenticateDeviceOwner({
    authenticateAsync,
    hasHardwareAsync: jest.fn(async () => true),
    isEnrolledAsync: jest.fn(async () => true),
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
    hasHardwareAsync: jest.fn(async () => true),
    isEnrolledAsync: jest.fn(async () => true),
  });

  expect(result).toBe("CANCELLED");
});
