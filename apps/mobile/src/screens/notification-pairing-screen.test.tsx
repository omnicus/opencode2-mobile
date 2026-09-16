import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { NotificationPairingScreen } from "./notification-pairing-screen";

const mockSave = jest.fn(async () => "connection-1");
const mockHealth = jest.fn(async () => ({ urls: [], pid: 42, version: "test" }));
const mockCreateClient = jest.fn((..._args: unknown[]) => ({
  server: { status: mockHealth },
  session: { list: jest.fn(async () => ({ data: [] })) },
}));
const mockRegisterPush = jest.fn(
  async (): Promise<{ deviceName: string; expoPushToken: string; platform: string }> => {
    throw new Error("NOTIFICATION_PERMISSION_DENIED");
  },
);

jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
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
});

async function inspectCode(url = "https://server.test") {
  await fireEvent.changeText(
    screen.getByPlaceholderText("Pairing code"),
    JSON.stringify({ urls: [url], username: "opencode", password: "test-password" }),
  );
  await fireEvent.press(screen.getByText("CHECK CODE"));
}

test("pairs directly without push permission or a notification broker", async () => {
  const done = jest.fn();
  await render(<NotificationPairingScreen onDone={done} />);
  await inspectCode();
  await act(async () => {
    fireEvent.press(screen.getByText("PAIR WITHOUT NOTIFICATIONS"));
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
    fireEvent.press(screen.getByText("PAIR AND SAVE"));
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
      fireEvent.press(screen.getByText("APPROVE HTTP + PAIR"));
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
  expect(screen.queryByText("PAIR WITHOUT NOTIFICATIONS")).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByText("APPROVE HTTP + PAIR WITHOUT NOTIFICATIONS"));
  });
  expect(mockSave).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  expect(
    screen.getByText("The paired OpenCode address or credentials could not be validated."),
  ).toBeTruthy();
});
