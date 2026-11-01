import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import * as notificationClient from "../notifications/notification-client";
import { NotificationPairingScreen } from "./notification-pairing-screen";

const mockSave = jest.fn(async () => "connection-1");
const mockHealth = jest.fn(async (_options?: { signal?: AbortSignal }) => ({
  urls: [] as string[],
  pid: 42,
  version: "test",
}));
const mockCreateClient = jest.fn((..._args: unknown[]) => ({
  server: { status: mockHealth },
  session: { list: jest.fn(async () => ({ data: [] })) },
}));
const mockRegisterPush = jest.fn(
  async (): Promise<{ deviceName: string; expoPushToken: string; platform: string }> => {
    throw new Error("NOTIFICATION_PERMISSION_DENIED");
  },
);

let mockCameraPermission: { canAskAgain: boolean; granted: boolean } = {
  canAskAgain: true,
  granted: true,
};
const mockRequestCameraPermission = jest.fn(async () => mockCameraPermission);
let mockOnBarcodeScanned: ((result: { data: string }) => void) | undefined;

jest.mock("expo-camera", () => ({
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned: (result: { data: string }) => void }) => {
    mockOnBarcodeScanned = onBarcodeScanned;
    return null;
  },
  useCameraPermissions: () => [mockCameraPermission, mockRequestCameraPermission],
}));
jest.mock("react-native-keyboard-controller", () =>
  require("react-native-keyboard-controller/jest"),
);
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => ({}) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "test-id" }));
jest.mock("../connections/connections-context", () => ({
  useConnections: () => ({ save: mockSave }),
}));
jest.mock("../expo-open-code-fetch", () => ({ boundedOpenCodeFetch: jest.fn() }));
jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  createOpenCodeClient: (...args: unknown[]) => mockCreateClient(...args),
  normalizeOpenCodeBaseUrl: (value: string) => new URL(value).origin,
}));
jest.mock("../notifications/notification-registration", () => ({
  registerForOpenCodePushNotifications: () => mockRegisterPush(),
}));
jest.mock("../notifications/notification-pairing-repository", () => ({}));

beforeEach(() => {
  jest.clearAllMocks();
  mockHealth.mockResolvedValue({ urls: [], pid: 42, version: "test" });
  mockCameraPermission = { canAskAgain: true, granted: true };
  mockOnBarcodeScanned = undefined;
});

afterEach(() => {
  jest.useRealTimers();
});

function hangUntilAborted(options?: { signal?: AbortSignal }) {
  return new Promise<never>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

async function inspectCode(url = "https://server.test") {
  await fireEvent.changeText(
    screen.getByPlaceholderText("Pairing code"),
    JSON.stringify({ urls: [url], username: "opencode", password: "test-password" }),
  );
  await fireEvent.press(screen.getByText("Check code"));
}

test("pairs directly without push permission or a notification broker", async () => {
  const done = jest.fn();
  await render(<NotificationPairingScreen onDone={done} />);
  await inspectCode();
  await act(async () => {
    fireEvent.press(screen.getByText("Pair without notifications"));
  });
  expect(mockRegisterPush).not.toHaveBeenCalled();
  expect(mockCreateClient).toHaveBeenCalledWith(
    expect.objectContaining({
      baseUrl: "https://server.test",
      authorization: expect.stringMatching(/^Basic /),
    }),
  );
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({
      credential: {
        mode: "basic",
        username: "opencode",
        password: "test-password",
        schemaVersion: 1,
      },
      draft: expect.objectContaining({
        baseUrl: "https://server.test",
        allowDevelopmentHttp: false,
      }),
    }),
  );
  expect(done).toHaveBeenCalledTimes(1);
});

test("automatically pairs after notification registration fails", async () => {
  await render(<NotificationPairingScreen onDone={jest.fn()} />);
  await inspectCode();
  await act(async () => {
    fireEvent.press(screen.getByText("Pair and save"));
  });
  expect(mockSave).toHaveBeenCalledTimes(1);
});

test("automatically pairs when the broker is unreachable", async () => {
  mockRegisterPush.mockResolvedValueOnce({
    deviceName: "Phone",
    expoPushToken: "test-token",
    platform: "ios",
  });
  const fetch = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new TypeError("Network request failed"));
  const done = jest.fn();
  try {
    await render(<NotificationPairingScreen onDone={done} />);
    await inspectCode("http://server.test:4096");
    await act(async () => {
      fireEvent.press(screen.getByText("Approve HTTP and pair"));
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://server.test:37100/v1/pair/opencode",
      expect.anything(),
    );
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
  }
});

test("requires explicit HTTP approval and does not save a failed connection", async () => {
  mockHealth.mockRejectedValueOnce(new Error("unreachable"));
  const done = jest.fn();
  await render(<NotificationPairingScreen onDone={done} />);
  await inspectCode("http://server.test:4096");
  expect(screen.queryByText("Pair without notifications")).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByText("Approve HTTP and pair without notifications"));
  });
  expect(mockSave).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  expect(
    screen.getByText("The paired OpenCode address or credentials could not be validated."),
  ).toBeTruthy();
});

test("cancels a pairing attempt without saving", async () => {
  mockHealth.mockImplementation(hangUntilAborted);
  const done = jest.fn();
  await render(<NotificationPairingScreen onDone={done} />);
  await inspectCode();
  await act(async () => {
    fireEvent.press(screen.getByText("Pair without notifications"));
  });
  expect(mockHealth.mock.calls[0]?.[0]?.signal).toBeDefined();

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  });

  expect(mockSave).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(screen.queryByText(/could not be validated/)).toBeNull();
});

test("aborts a pairing attempt when the screen closes", async () => {
  mockHealth.mockImplementation(hangUntilAborted);
  const done = jest.fn();
  const view = await render(<NotificationPairingScreen onDone={done} />);
  await inspectCode();
  await act(async () => {
    fireEvent.press(screen.getByText("Pair without notifications"));
  });
  const signal = mockHealth.mock.calls[0]?.[0]?.signal;

  await act(async () => {
    view.unmount();
  });

  expect(signal?.aborted).toBe(true);
  expect(mockSave).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});

test("stops waiting for OpenCode after 10 seconds", async () => {
  jest.useFakeTimers();
  mockHealth.mockImplementation(hangUntilAborted);
  await render(<NotificationPairingScreen onDone={jest.fn()} />);
  await inspectCode();
  await act(async () => {
    fireEvent.press(screen.getByText("Pair without notifications"));
  });

  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });

  expect(
    screen.getByText(
      "The OpenCode server did not respond within 10 seconds. Check that it is running and reachable.",
    ),
  ).toBeOnTheScreen();
  expect(mockSave).not.toHaveBeenCalled();
});

test("offers system settings when camera access can no longer be requested", async () => {
  const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
  mockCameraPermission = { canAskAgain: false, granted: false };
  await render(<NotificationPairingScreen onDone={jest.fn()} />);

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Scan QR code" }));
  });
  expect(
    screen.getByText(
      "Camera access is off for this app. Turn it on in Settings, or paste the pairing code instead.",
    ),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
  expect(openSettings).toHaveBeenCalledTimes(1);
  openSettings.mockRestore();
});

test("shows scan errors by the camera, ignores repeats, and cancels the scan", async () => {
  const prepare = jest.spyOn(notificationClient, "prepareOpenCodeDevicePairing");
  await render(<NotificationPairingScreen onDone={jest.fn()} />);
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Scan QR code" }));
  });

  await act(async () => {
    mockOnBarcodeScanned?.({ data: "not a pairing code" });
    mockOnBarcodeScanned?.({ data: "not a pairing code" });
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(screen.getByText("The pairing code is malformed or was altered.")).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Cancel scan" }));
  expect(screen.getByRole("button", { name: "Scan QR code" })).toBeOnTheScreen();
  expect(screen.queryByText("The pairing code is malformed or was altered.")).toBeNull();
  prepare.mockRestore();
});

test("counts down a notification code and disables pairing once it expires", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
  await render(<NotificationPairingScreen onDone={jest.fn()} />);
  await fireEvent.changeText(
    screen.getByPlaceholderText("Pairing code"),
    JSON.stringify({
      allowDevelopmentHttp: false,
      authMode: "basic",
      brokerOrigin: "https://broker.test",
      challengeID: "challenge-1",
      expiresAtMs: 1_002_500,
      name: "Studio",
      openCodeOrigin: "https://server.test",
      pairingSecret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      v: 1,
    }),
  );
  await fireEvent.press(screen.getByText("Check code"));
  expect(screen.getByText(/Expires in 3 seconds/)).toBeOnTheScreen();

  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  expect(screen.getByText(/Expires in 2 seconds/)).toBeOnTheScreen();

  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });
  expect(screen.getByText(/This code expired/)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Pair and save" })).toBeDisabled();
});

test("closes from the Done action", async () => {
  const done = jest.fn();
  await render(<NotificationPairingScreen onDone={done} />);
  await fireEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(done).toHaveBeenCalledTimes(1);
});

test("scans a notification pairing code and offers only notification pairing", async () => {
  await render(<NotificationPairingScreen onDone={jest.fn()} />);
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Scan QR code" }));
  });
  expect(screen.getByText("Center the terminal QR code in the frame.")).toBeOnTheScreen();
  await act(async () => {
    mockOnBarcodeScanned?.({
      data: JSON.stringify({
        allowDevelopmentHttp: false,
        authMode: "bearer",
        brokerOrigin: "https://broker.test",
        challengeID: "challenge-1",
        expiresAtMs: Date.now() + 60_000,
        name: "Office server",
        openCodeOrigin: "https://office.test",
        pairingSecret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        v: 1,
      }),
    });
  });
  expect(screen.queryByText("Center the terminal QR code in the frame.")).toBeNull();
  expect(screen.getByText("Office server")).toBeOnTheScreen();
  expect(screen.getByText("https://office.test")).toBeOnTheScreen();
  expect(screen.getByText(/^Signs in with a token\. Expires in \d+ seconds\.$/)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Pair and save" })).toBeEnabled();
  expect(screen.queryByText("Pair without notifications")).toBeNull();
});

test("shows why a pasted code cannot be used", async () => {
  await render(<NotificationPairingScreen onDone={jest.fn()} />);
  await fireEvent.changeText(screen.getByPlaceholderText("Pairing code"), "not a code");
  await fireEvent.press(screen.getByText("Check code"));
  expect(screen.getByText("The pairing code is malformed or was altered.")).toBeOnTheScreen();
  expect(screen.queryByText("Ready to pair")).toBeNull();
});
