import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus, StyleSheet, View } from "react-native";
import { SettingsRow } from "../components/management-layout";
import { palette, space, typography } from "../theme";

import { AppUpdateCard, AppUpdatesProvider } from "./app-updates";

const mockCheck = jest.fn<() => Promise<{ isAvailable: boolean }>>();
const mockDownload = jest.fn<() => Promise<{ isNew: boolean }>>();
const mockReload = jest.fn<() => Promise<void>>();
let mockNativePending = false;
let mockStartupRunning = false;
let mockUpdatesEnabled = true;
const initialAppState = Object.getOwnPropertyDescriptor(AppState, "currentState");

jest.mock("expo-updates", () => ({
  get isEnabled() {
    return mockUpdatesEnabled;
  },
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
  mockUpdatesEnabled = true;
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
  expect(screen.getByText("Couldn't check or download an app update. Try again.")).toHaveStyle({
    ...typography.subheadline,
    color: palette.danger,
  });
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

test("explains a build without updates in plain words and offers no check", () => {
  mockUpdatesEnabled = false;
  const screen = render(
    <AppUpdatesProvider>
      <AppUpdateCard />
    </AppUpdatesProvider>,
  );

  expect(screen.getByText("This build of the app doesn't receive updates.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Check for app updates" })).toBeNull();
});

test("in Settings, updates use the setting row with its action under the text", async () => {
  const screen = render(
    <AppUpdatesProvider>
      <AppUpdateCard grouped />
    </AppUpdatesProvider>,
  );
  await screen.findByText("No newer update is available for this app build.");
  expect(screen.getByText("App updates")).toHaveStyle({ ...typography.body, color: palette.ink });
  expect(screen.getByText("No newer update is available for this app build.")).toHaveStyle({
    ...typography.footnote,
    color: palette.dim,
  });
  expect(screen.getByTestId("icon-tile-blue", { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Check for app updates" })).toHaveStyle({
    marginTop: space.sm,
  });
});

test("the update row drops its separator when it is last in the group", async () => {
  const screen = render(
    <AppUpdatesProvider>
      <AppUpdateCard grouped last />
    </AppUpdatesProvider>,
  );
  await screen.findByText("No newer update is available for this app build.");
  const row = screen.UNSAFE_getByType(SettingsRow).findByType(View);
  expect(StyleSheet.flatten(row.props.style).borderBottomWidth).toBeUndefined();
});
