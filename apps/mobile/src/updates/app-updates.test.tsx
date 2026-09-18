import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { AppUpdateCard, AppUpdatesProvider } from "./app-updates";

const mockCheck = jest.fn<() => Promise<{ isAvailable: boolean }>>();
const mockDownload = jest.fn<() => Promise<{ isNew: boolean }>>();
const mockReload = jest.fn<() => Promise<void>>();
let mockNativePending = false;
let mockStartupRunning = false;
const initialAppState = Object.getOwnPropertyDescriptor(AppState, "currentState");

jest.mock("expo-updates", () => ({
  isEnabled: true,
  checkForUpdateAsync: () => mockCheck(),
  fetchUpdateAsync: () => mockDownload(),
  reloadAsync: () => mockReload(),
  useUpdates: () => ({
    isStartupProcedureRunning: mockStartupRunning,
    isUpdatePending: mockNativePending,
  }),
}));

beforeEach(() => {
  jest.replaceProperty(globalThis as typeof globalThis & { __DEV__: boolean }, "__DEV__", false);
  Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
  mockCheck.mockReset().mockResolvedValue({ isAvailable: false });
  mockDownload.mockReset().mockResolvedValue({ isNew: true });
  mockReload.mockReset().mockResolvedValue(undefined);
  mockNativePending = false;
  mockStartupRunning = false;
});

afterEach(() => {
  jest.restoreAllMocks();
  if (initialAppState) Object.defineProperty(AppState, "currentState", initialAppState);
});

test("can recover from update-service failure without any connection providers", async () => {
  mockCheck.mockRejectedValueOnce(new Error("offline"));
  const screen = render(
    <AppUpdatesProvider>
      <AppUpdateCard />
    </AppUpdatesProvider>,
  );
  await screen.findByText("Couldn't check or download an app update. Try again.");
  mockCheck.mockResolvedValueOnce({ isAvailable: true });
  fireEvent.press(screen.getByRole("button", { name: "Check for app updates" }));
  const restart = await screen.findByRole("button", { name: "Restart to apply update" });
  expect(mockReload).not.toHaveBeenCalled();
  fireEvent.press(restart);
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
});

test("waits for native startup, throttles foreground checks and removes the listener", async () => {
  let foreground: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
    foreground = callback;
    return { remove };
  });
  mockStartupRunning = true;
  const screen = render(
    <AppUpdatesProvider>
      <AppUpdateCard />
    </AppUpdatesProvider>,
  );
  expect(mockCheck).not.toHaveBeenCalled();
  mockStartupRunning = false;
  screen.rerender(
    <AppUpdatesProvider>
      <AppUpdateCard />
    </AppUpdatesProvider>,
  );
  await screen.findByText("No newer update is available for this app build.");
  await act(async () => {
    foreground?.("active");
  });
  expect(mockCheck).toHaveBeenCalledTimes(1);
  screen.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test("shows an update downloaded by native startup without downloading it twice", async () => {
  mockNativePending = true;
  const screen = render(
    <AppUpdatesProvider>
      <AppUpdateCard />
    </AppUpdatesProvider>,
  );
  await screen.findByRole("button", { name: "Restart to apply update" });
  expect(mockCheck).not.toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
});
