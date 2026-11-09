import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, AppState, type AppStateStatus, Pressable, Text } from "react-native";

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

  expect(await screen.findByText("Secure preferences could not be read")).toBeOnTheScreen();
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
  expect(screen.getByText("OpenCode2 Mobile is locked")).toBeOnTheScreen();
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

test.each([
  ["UNAVAILABLE", "Set a passcode or screen lock on this device first."],
  ["CANCELLED", "Unlock was cancelled. Tap Unlock to try again."],
] satisfies ["CANCELLED" | "UNAVAILABLE", string][])(
  "stays locked when device authentication returns %s",
  async (result, message) => {
    mockAuthenticate.mockResolvedValue(result);
    mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
    render(
      <AppLockProvider>
        <Text>Private content</Text>
      </AppLockProvider>,
    );

    await pressAndSettle(await screen.findByRole("button", { name: "Unlock" }));

    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
  },
);

test("stays locked when device authentication throws", async () => {
  mockAuthenticate.mockRejectedValue(new Error("private native detail"));
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );

  await pressAndSettle(await screen.findByRole("button", { name: "Unlock" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Device authentication is unavailable right now.",
  );
  expect(screen.queryByText("private native detail")).not.toBeOnTheScreen();
  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
});

test("stays locked when authentication finishes after a background round trip", async () => {
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

  setAppState("background");
  setAppState("active");
  await act(async () => {
    resolveAuthentication?.("AUTHENTICATED");
    await Promise.resolve();
  });

  expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Unlock" })).toBeEnabled();
});

test("drops a pending unlock when the app backgrounds before it returns", async () => {
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
  await act(async () => {
    resolveAuthentication?.("AUTHENTICATED");
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: "Authenticating…" })).toBeDisabled();

  setAppState("background");
  expect(screen.getByRole("button", { name: "Unlock" })).toBeEnabled();
  setAppState("active");

  expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
});

test("locks when the app becomes inactive and prompts again when it returns", async () => {
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  expect(await screen.findByText("Private content")).toBeOnTheScreen();

  setAppState("inactive");
  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
  expect(screen.getByText("OpenCode2 Mobile is locked")).toBeOnTheScreen();
  expect(mockAuthenticate).toHaveBeenCalledTimes(1);

  await act(async () => {
    setAppState("active");
    await Promise.resolve();
  });
  expect(await screen.findByText("Private content")).toBeOnTheScreen();
  expect(mockAuthenticate).toHaveBeenCalledTimes(2);
});

test("does not prompt by itself while the lock is disabled or unreadable", async () => {
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 0 });
  const view = render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  expect(await screen.findByText("Private content")).toBeOnTheScreen();
  view.unmount();

  mockGetPreference.mockRejectedValue(new Error("private database detail"));
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  expect(await screen.findByText("Secure preferences could not be read")).toBeOnTheScreen();
  expect(mockAuthenticate).not.toHaveBeenCalled();
});

test("does not prompt by itself when the app launches in the background", async () => {
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "background" });
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );

  expect(await screen.findByRole("button", { name: "Unlock" })).toBeEnabled();
  expect(mockAuthenticate).not.toHaveBeenCalled();
});

test("does not listen for app state while the lock is disabled", async () => {
  jest.mocked(AppState.addEventListener).mockClear();
  mockGetPreference.mockResolvedValue(null);
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  expect(await screen.findByText("Private content")).toBeOnTheScreen();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
});

test("skips authentication when the lock already has the requested state", async () => {
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
      <AppLockToggle />
    </AppLockProvider>,
  );
  const enable = await screen.findByRole("button", { name: "Enable lock" });
  mockAuthenticate.mockClear();

  await pressAndSettle(enable);

  expect(mockAuthenticate).not.toHaveBeenCalled();
  expect(mockRunAsync).not.toHaveBeenCalled();
});

test("does not change the preference when authentication fails", async () => {
  mockAuthenticate.mockResolvedValue("CANCELLED");
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 0 });
  render(
    <AppLockProvider>
      <AppLockSwitch nextEnabled />
    </AppLockProvider>,
  );

  await pressAndSettle(await screen.findByRole("button", { name: "Enable lock" }));

  expect(mockRunAsync).not.toHaveBeenCalled();
  expect(screen.getByText("Lock disabled")).toBeOnTheScreen();
  expect(screen.getByText("Unlock was cancelled. Tap Unlock to try again.")).toBeOnTheScreen();
});

test("reports a preference that could not be saved", async () => {
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 0 });
  mockRunAsync.mockRejectedValue(new Error("private database detail"));
  render(
    <AppLockProvider>
      <AppLockSwitch nextEnabled />
    </AppLockProvider>,
  );

  await pressAndSettle(await screen.findByRole("button", { name: "Enable lock" }));

  expect(screen.getByText("Lock disabled")).toBeOnTheScreen();
  expect(screen.getByText("The app-lock preference could not be saved.")).toBeOnTheScreen();
});

test("locks immediately when enabled while the app is not active", async () => {
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 0 });
  render(
    <AppLockProvider>
      <Text>Private content</Text>
      <AppLockToggle />
    </AppLockProvider>,
  );
  const enable = await screen.findByRole("button", { name: "Enable lock" });
  mockAuthenticate.mockImplementation(async () => {
    Object.defineProperty(AppState, "currentState", { configurable: true, value: "inactive" });
    return "AUTHENTICATED";
  });

  await pressAndSettle(enable);

  expect(screen.queryByText("Private content")).not.toBeOnTheScreen();
  expect(screen.getByText("OpenCode2 Mobile is locked")).toBeOnTheScreen();
  expect(mockAuthenticate).toHaveBeenCalledTimes(1);
});

test("authenticates before disabling the persisted app lock", async () => {
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  render(
    <AppLockProvider>
      <AppLockSwitch nextEnabled={false} />
    </AppLockProvider>,
  );
  const disable = await screen.findByRole("button", { name: "Disable lock" });

  await pressAndSettle(disable);

  expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  expect(mockRunAsync).toHaveBeenCalledWith(
    "UPDATE app_preferences SET app_lock_enabled = ? WHERE singleton = 1",
    0,
  );
  expect(screen.getByText("Lock disabled")).toBeOnTheScreen();
  act(() => appStateListener?.("background"));
  expect(screen.getByText("Lock disabled")).toBeOnTheScreen();
});

test("announces loading, locked, and unavailable states", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  announce.mockClear();
  mockAuthenticate.mockResolvedValue("CANCELLED");
  mockGetPreference.mockResolvedValue({ app_lock_enabled: 1 });
  const view = render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  await screen.findByRole("button", { name: "Unlock" });
  expect(announce.mock.calls.map(([message]) => message)).toEqual([
    "Loading app lock",
    "OpenCode2 Mobile is locked",
  ]);
  view.unmount();

  announce.mockClear();
  mockGetPreference.mockRejectedValue(new Error("private database detail"));
  render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  await screen.findByText("Secure preferences could not be read");
  expect(announce).toHaveBeenLastCalledWith("App lock unavailable");
});

test("ignores a preference load that finishes after unmount", async () => {
  let resolvePreference: ((row: { app_lock_enabled: number }) => void) | undefined;
  mockGetPreference.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePreference = resolve;
      }),
  );
  const view = render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  view.unmount();
  await act(async () => {
    resolvePreference?.({ app_lock_enabled: 1 });
    await Promise.resolve();
  });

  let rejectPreference: ((error: Error) => void) | undefined;
  mockGetPreference.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectPreference = reject;
      }),
  );
  const failed = render(
    <AppLockProvider>
      <Text>Private content</Text>
    </AppLockProvider>,
  );
  failed.unmount();
  await act(async () => {
    rejectPreference?.(new Error("late"));
    await Promise.resolve();
  });
  expect(mockGetPreference).toHaveBeenCalledTimes(2);
  expect(mockAuthenticate).not.toHaveBeenCalled();
});

test("requires the provider", () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  expect(() => render(<AppLockToggle />)).toThrow("AppLockProvider is missing");
});

async function pressAndSettle(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setAppState(state: AppStateStatus) {
  Object.defineProperty(AppState, "currentState", { configurable: true, value: state });
  act(() => appStateListener?.(state));
}

function AppLockSwitch({ nextEnabled }: { nextEnabled: boolean }) {
  const appLock = useAppLock();
  return (
    <>
      <Text>{appLock.enabled ? "Lock enabled" : "Lock disabled"}</Text>
      {appLock.error ? <Text>{appLock.error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => appLock.setEnabled(nextEnabled)}>
        <Text>{nextEnabled ? "Enable lock" : "Disable lock"}</Text>
      </Pressable>
    </>
  );
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
