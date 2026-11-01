import { beforeEach, expect, jest, test } from "@jest/globals";

import {
  getExistingOpenCodePushRegistration,
  registerForOpenCodePushNotifications,
} from "./notification-registration";

const mockState: {
  deviceName: string | null | undefined;
  easConfig: { projectId?: unknown } | undefined;
  expoConfig: { extra?: { eas?: { projectId?: unknown } } } | undefined;
  isDevice: boolean;
  os: string;
} = {
  deviceName: "Pixel",
  easConfig: undefined,
  expoConfig: { extra: { eas: { projectId: "project-1" } } },
  isDevice: true,
  os: "ios",
};
const mockGetPermissions = jest.fn<() => Promise<{ status: string }>>();
const mockRequestPermissions = jest.fn<() => Promise<{ status: string }>>();
const mockGetExpoPushToken =
  jest.fn<(options: { projectId: string }) => Promise<{ data: string }>>();
const mockSetNotificationChannel = jest.fn<(id: string, channel: unknown) => Promise<void>>();

jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockState.os;
    },
  },
}));
jest.mock("expo-device", () => ({
  get deviceName() {
    return mockState.deviceName;
  },
  get isDevice() {
    return mockState.isDevice;
  },
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get easConfig() {
      return mockState.easConfig;
    },
    get expoConfig() {
      return mockState.expoConfig;
    },
  },
}));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4 },
  getExpoPushTokenAsync: (options: { projectId: string }) => mockGetExpoPushToken(options),
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  setNotificationChannelAsync: (id: string, channel: unknown) =>
    mockSetNotificationChannel(id, channel),
}));

beforeEach(() => {
  mockState.deviceName = "Pixel";
  mockState.easConfig = undefined;
  mockState.expoConfig = { extra: { eas: { projectId: "project-1" } } };
  mockState.isDevice = true;
  mockState.os = "ios";
  mockGetPermissions.mockReset().mockResolvedValue({ status: "granted" });
  mockRequestPermissions.mockReset().mockResolvedValue({ status: "granted" });
  mockGetExpoPushToken.mockReset().mockResolvedValue({ data: "ExponentPushToken[token-1]" });
  mockSetNotificationChannel.mockReset().mockResolvedValue(undefined);
});

test("registers an iOS device that already granted permission", async () => {
  await expect(registerForOpenCodePushNotifications()).resolves.toEqual({
    deviceName: "Pixel",
    expoPushToken: "ExponentPushToken[token-1]",
    platform: "ios",
  });

  expect(mockGetExpoPushToken).toHaveBeenCalledWith({ projectId: "project-1" });
  expect(mockRequestPermissions).not.toHaveBeenCalled();
  expect(mockSetNotificationChannel).not.toHaveBeenCalled();
});

test("configures the Android channel and asks for permission when needed", async () => {
  mockState.os = "android";
  mockGetPermissions.mockResolvedValue({ status: "undetermined" });

  await expect(registerForOpenCodePushNotifications()).resolves.toMatchObject({
    platform: "android",
  });

  expect(mockSetNotificationChannel).toHaveBeenCalledWith("opencode-attention", {
    importance: 4,
    name: "OpenCode attention",
    sound: "default",
  });
  expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
  expect(mockSetNotificationChannel.mock.invocationCallOrder[0]).toBeLessThan(
    mockGetPermissions.mock.invocationCallOrder[0] ?? 0,
  );
});

test("rejects simulators before touching notification permissions", async () => {
  mockState.isDevice = false;

  await expect(registerForOpenCodePushNotifications()).rejects.toThrow(
    "PUSH_REQUIRES_PHYSICAL_DEVICE",
  );
  expect(mockGetPermissions).not.toHaveBeenCalled();
});

test("rejects platforms without push support", async () => {
  mockState.os = "web";

  await expect(registerForOpenCodePushNotifications()).rejects.toThrow("PUSH_PLATFORM_UNSUPPORTED");
  expect(mockGetPermissions).not.toHaveBeenCalled();
});

test("stops when the user denies the permission prompt", async () => {
  mockGetPermissions.mockResolvedValue({ status: "denied" });
  mockRequestPermissions.mockResolvedValue({ status: "denied" });

  await expect(registerForOpenCodePushNotifications()).rejects.toThrow(
    "NOTIFICATION_PERMISSION_DENIED",
  );
  expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
  expect(mockGetExpoPushToken).not.toHaveBeenCalled();
});

test("falls back to the EAS config project ID", async () => {
  mockState.expoConfig = undefined;
  mockState.easConfig = { projectId: "project-2" };

  await registerForOpenCodePushNotifications();

  expect(mockGetExpoPushToken).toHaveBeenCalledWith({ projectId: "project-2" });
});

test("prefers the Expo config project ID over the EAS config", async () => {
  mockState.easConfig = { projectId: "project-2" };

  await registerForOpenCodePushNotifications();

  expect(mockGetExpoPushToken).toHaveBeenCalledWith({ projectId: "project-1" });
});

test.each([
  ["no config", undefined, undefined],
  ["no extra", {}, undefined],
  ["no eas", { extra: {} }, {}],
  ["an empty project ID", { extra: { eas: { projectId: "" } } }, { projectId: "project-2" }],
  ["a non-string project ID", { extra: { eas: { projectId: 42 } } }, undefined],
])("rejects %s as the EAS project ID", async (_label, expoConfig, easConfig) => {
  mockState.expoConfig = expoConfig;
  mockState.easConfig = easConfig;

  await expect(registerForOpenCodePushNotifications()).rejects.toThrow("EAS_PROJECT_ID_MISSING");
  expect(mockGetExpoPushToken).not.toHaveBeenCalled();
});

test.each([
  ["missing", undefined],
  ["null", null],
  ["blank", "   "],
])("names the device after the platform when its name is %s", async (_label, deviceName) => {
  mockState.os = "android";
  mockState.deviceName = deviceName;

  await expect(registerForOpenCodePushNotifications()).resolves.toMatchObject({
    deviceName: "android device",
  });
});

test("trims the device name", async () => {
  mockState.deviceName = "  Test iPhone  ";

  await expect(registerForOpenCodePushNotifications()).resolves.toMatchObject({
    deviceName: "Test iPhone",
  });
});

test("reads an existing registration without prompting", async () => {
  mockState.os = "android";

  await expect(getExistingOpenCodePushRegistration()).resolves.toEqual({
    deviceName: "Pixel",
    expoPushToken: "ExponentPushToken[token-1]",
    platform: "android",
  });
  expect(mockRequestPermissions).not.toHaveBeenCalled();
  expect(mockSetNotificationChannel).toHaveBeenCalledTimes(1);
});

test.each([
  ["a simulator", { isDevice: false }, undefined],
  ["an unsupported platform", { os: "web" }, undefined],
  ["missing permission", {}, "undetermined"],
])("skips the existing registration on %s", async (_label, state, status) => {
  Object.assign(mockState, state);
  if (status) mockGetPermissions.mockResolvedValue({ status });

  await expect(getExistingOpenCodePushRegistration()).resolves.toBeUndefined();
  expect(mockRequestPermissions).not.toHaveBeenCalled();
  expect(mockGetExpoPushToken).not.toHaveBeenCalled();
});
