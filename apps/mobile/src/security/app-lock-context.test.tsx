import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus, Pressable, Text } from "react-native";

import { AppLockProvider, useAppLock } from "./app-lock-context";

const mockAuthenticate = jest.fn<() => Promise<"AUTHENTICATED" | "CANCELLED" | "UNAVAILABLE">>();
const mockGetPreference = jest.fn<() => Promise<{ app_lock_enabled: number } | null>>();
const mockRunAsync = jest.fn<(sql: string, value: number) => Promise<unknown>>();
const mockDatabase = {
  getFirstAsync: mockGetPreference,
  runAsync: mockRunAsync,
};

jest.mock("expo-sqlite", () => ({
  useSQLiteContext: () => mockDatabase,
}));

jest.mock("./device-authentication", () => ({
  authenticateDeviceOwner: () => mockAuthenticate(),
}));

let appStateListener: ((state: AppStateStatus) => void) | undefined;

beforeEach(() => {
  jest.restoreAllMocks();
  mockAuthenticate.mockReset();
  mockAuthenticate.mockResolvedValue("AUTHENTICATED");
  mockGetPreference.mockReset();
  mockRunAsync.mockReset();
  appStateListener = undefined;
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
});

test("prompts by itself at launch and after returning from the background", async () => {
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );

  expect(await screen.findByText("Private content")).toBeOnTheScreen();
  expect(mockAuthenticate).toHaveBeenCalledTimes(1);

  setAppState("background");
  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
  expect(mockAuthenticate).toHaveBeenCalledTimes(1);

  await act(async () => {
    setAppState("active");
    await Promise.resolve();
  });
  expect(await screen.findByText("Private content")).toBeOnTheScreen();
  expect(mockAuthenticate).toHaveBeenCalledTimes(2);
});

test("does not prompt again after a cancel until the user asks or the app returns", async () => {
  mockAuthenticate.mockResolvedValue("CANCELLED");
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );

  expect(
    await screen.findByText("Unlock was cancelled. Tap Unlock to try again."),
  ).toBeOnTheScreen();
  expect(mockAuthenticate).toHaveBeenCalledTimes(1);

  await act(async () => {
    setAppState("inactive");
    setAppState("active");
    await Promise.resolve();
  });
  expect(mockAuthenticate).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Unlock" }));
    await Promise.resolve();
  });
  expect(mockAuthenticate).toHaveBeenCalledTimes(2);

  await act(async () => {
    setAppState("background");
    setAppState("active");
    await Promise.resolve();
  });
  expect(mockAuthenticate).toHaveBeenCalledTimes(3);
  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
});

test("asks for a device passcode when none is set", async () => {
  mockAuthenticate.mockResolvedValue("UNAVAILABLE");
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );

  expect(
    await screen.findByText("Set a passcode or screen lock on this device first."),
  ).toBeOnTheScreen();
  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
});

test("authenticates before enabling the persisted app lock", async () => {
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 0 });
  render(
    <AppLockProvider>
      <AppLockToggle />
    </AppLockProvider>,
  );
  await act(async () => Promise.resolve());

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Enable lock" }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  expect(mockRunAsync).toHaveBeenCalledWith(
    "UPDATE app_preferences SET app_lock_enabled = ? WHERE singleton = 1",
    1,
  );
  expect(await screen.findByText("Lock enabled")).toBeOnTheScreen();
});

test("fails closed and retries when the lock preference cannot be read", async () => {
  mockGetPreference.mockRejectedValueOnce(new Error("private database detail"));
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );

  expect(await screen.findByText("Secure preferences could not be read.")).toBeOnTheScreen();
  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();

  mockGetPreference.mockResolvedValue({ app_lock_enabled: 0 });
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(await screen.findByText("Private content")).toBeOnTheScreen();
});

test("does not unlock after authentication finishes in the background", async () => {
  let resolveAuthentication: ((result: "AUTHENTICATED") => void) | undefined;
  mockAuthenticate.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveAuthentication = resolve;
      }),
  );
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  await screen.findByRole("button", { name: "Authenticating…" });
  expect(mockAuthenticate).toHaveBeenCalledTimes(1);

  Object.defineProperty(AppState, "currentState", { configurable: true, value: "background" });
  await act(async () => {
    resolveAuthentication?.("AUTHENTICATED");
    await Promise.resolve();
  });

  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
  expect(screen.getByText("OpenCode2 Mobile is locked.")).toBeOnTheScreen();
});

test("keeps unlock busy until a successful native prompt returns through inactive", async () => {
  let resolveAuthentication: ((result: "AUTHENTICATED") => void) | undefined;
  mockAuthenticate.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveAuthentication = resolve;
      }),
  );
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  await screen.findByRole("button", { name: "Authenticating…" });

  Object.defineProperty(AppState, "currentState", { configurable: true, value: "inactive" });
  act(() => appStateListener?.("inactive"));
  await act(async () => {
    resolveAuthentication?.("AUTHENTICATED");
    await Promise.resolve();
  });
  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Authenticating…" })).toBeDisabled();

  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
  act(() => appStateListener?.("active"));
  expect(screen.getByText("Private content")).toBeOnTheScreen();
});

function setAppState(state: AppStateStatus) {
  Object.defineProperty(AppState, "currentState", { configurable: true, value: state });
  act(() => appStateListener?.(state));
}

function AppLockToggle() {
  const appLock = useAppLock();
  return (
    <>
      <Text>{appLock.enabled ? "Lock enabled" : "Lock disabled"}</Text>
      <Pressable accessibilityRole="button" onPress={() => appLock.setEnabled(true)}>
        <Text>Enable lock</Text>
      </Pressable>
    </>
  );
}
