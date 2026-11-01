import { beforeEach, expect, jest, test } from "@jest/globals";
import {
  getOpenCodeSession,
  listOpenCodeFormRequests,
  listOpenCodePermissionRequests,
} from "@opencode2-mobile/opencode-adapter";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { Text } from "react-native";

import { useConnections } from "../connections/connections-context";
import { rootNavigationRef } from "../navigation/navigation-ref";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { decryptNotificationRoute, sendNotificationDeviceCommand } from "./notification-client";
import {
  getNotificationPairingByBindingID,
  listNotificationPairings,
  readNotificationPairingSecret,
} from "./notification-pairing-repository";
import { getExistingOpenCodePushRegistration } from "./notification-registration";
import {
  markNotificationEventHandled,
  wasNotificationEventHandled,
} from "./notification-replay-repository";
import { NotificationRoutingProvider } from "./notification-routing-context";

const mockDb = {};
const mockQueryClient = { setQueryData: jest.fn() };
const removeSubscription = jest.fn();
const select = jest.fn(async (_profileId: string) => undefined);
const includeAttentionLocation = jest.fn();
const restClient = { id: "rest-client" };
const location = { directory: "/repo" };
const pairing = {
  bindingID: "binding-1",
  brokerOrigin: "https://broker.test",
  connectionId: "connection-1",
};
let responseListener: ((response: Notifications.NotificationResponse) => void) | undefined;

jest.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  getLastNotificationResponseAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
}));
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => mockQueryClient }));
jest.mock("@opencode2-mobile/notification-protocol", () => ({
  parseNotificationPushData: (data: { bindingID: string }) => ({ bindingID: data.bindingID }),
}));
jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  getOpenCodeSession: jest.fn(),
  listOpenCodeFormRequests: jest.fn(),
  listOpenCodePermissionRequests: jest.fn(),
}));
jest.mock("../connections/connections-context", () => ({ useConnections: jest.fn() }));
jest.mock("../navigation/navigation-ref", () => ({
  rootNavigationRef: { isReady: jest.fn(), navigate: jest.fn() },
}));
jest.mock("../state/connection-runtime-context", () => ({ useConnectionRuntime: jest.fn() }));
jest.mock("./notification-client", () => ({
  decryptNotificationRoute: jest.fn(),
  sendNotificationDeviceCommand: jest.fn(async () => undefined),
}));
jest.mock("./notification-pairing-repository", () => ({
  getNotificationPairingByBindingID: jest.fn(),
  listNotificationPairings: jest.fn(),
  readNotificationPairingSecret: jest.fn(),
}));
jest.mock("./notification-registration", () => ({
  getExistingOpenCodePushRegistration: jest.fn(),
}));
jest.mock("./notification-replay-repository", () => ({
  markNotificationEventHandled: jest.fn(async () => undefined),
  wasNotificationEventHandled: jest.fn(),
}));

const connections = { select, selectedProfileId: "connection-1" };

beforeEach(() => {
  jest.clearAllMocks();
  responseListener = undefined;
  jest
    .mocked(Notifications.addNotificationResponseReceivedListener)
    .mockImplementation((listener) => {
      responseListener = listener;
      return { remove: removeSubscription } as never;
    });
  jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(null);
  jest.mocked(useConnections).mockReturnValue(connections as never);
  mockRuntime();
  jest.mocked(rootNavigationRef.isReady).mockReturnValue(true);
  jest.mocked(getExistingOpenCodePushRegistration).mockResolvedValue(undefined as never);
  jest.mocked(listNotificationPairings).mockResolvedValue([pairing] as never);
  jest.mocked(getNotificationPairingByBindingID).mockResolvedValue(pairing as never);
  jest
    .mocked(readNotificationPairingSecret)
    .mockResolvedValue({ deviceKey: "device-key" } as never);
  jest.mocked(wasNotificationEventHandled).mockResolvedValue(false);
  jest.mocked(getOpenCodeSession).mockResolvedValue({ id: "session-1", location } as never);
  jest.mocked(listOpenCodePermissionRequests).mockResolvedValue({ data: [] } as never);
  jest.mocked(listOpenCodeFormRequests).mockResolvedValue({ data: [] } as never);
});

function mockRuntime(
  connectionId: string | undefined = "connection-1",
  client: unknown = restClient,
) {
  jest.mocked(useConnectionRuntime).mockReturnValue({
    connectionId,
    includeAttentionLocation,
    restClient: client,
  } as never);
}

function mockRoute(route: Record<string, unknown>) {
  jest.mocked(decryptNotificationRoute).mockReturnValue({
    bindingID: "binding-1",
    eventID: "evt-1",
    expiresAtMs: Date.now() + 60_000,
    ...route,
  } as never);
}

function notificationResponse(identifier: string) {
  return {
    notification: { request: { content: { data: { bindingID: "binding-1" } }, identifier } },
  } as unknown as Notifications.NotificationResponse;
}

async function renderProvider() {
  const view = await render(
    <NotificationRoutingProvider>
      <Text>Routed child</Text>
    </NotificationRoutingProvider>,
  );
  await act(async () => undefined);
  return view;
}

async function deliver(identifier = "response-1") {
  await act(async () => {
    responseListener?.(notificationResponse(identifier));
  });
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => undefined);
  }
}

test("renders children and removes the response listener on unmount", async () => {
  const view = await renderProvider();

  expect(screen.getByText("Routed child")).toBeTruthy();
  view.unmount();
  expect(removeSubscription).toHaveBeenCalledTimes(1);
});

test("sends the existing push token to every pairing", async () => {
  jest
    .mocked(getExistingOpenCodePushRegistration)
    .mockResolvedValue({ expoPushToken: "ExponentPushToken[1]" } as never);

  await renderProvider();

  await waitFor(() =>
    expect(sendNotificationDeviceCommand).toHaveBeenCalledWith({
      bindingID: "binding-1",
      brokerOrigin: "https://broker.test",
      deviceKey: "device-key",
      expoPushToken: "ExponentPushToken[1]",
      operation: "token",
    }),
  );
});

test("skips the token refresh without a registration or after unmount", async () => {
  await renderProvider();
  expect(listNotificationPairings).not.toHaveBeenCalled();

  let resolveRegistration: (value: unknown) => void = () => undefined;
  jest.mocked(getExistingOpenCodePushRegistration).mockReturnValue(
    new Promise((resolve) => {
      resolveRegistration = resolve;
    }) as never,
  );
  const view = await renderProvider();
  view.unmount();
  await act(async () => {
    resolveRegistration({ expoPushToken: "ExponentPushToken[1]" });
  });
  expect(listNotificationPairings).not.toHaveBeenCalled();
});

test("ignores a failed token refresh", async () => {
  jest
    .mocked(getExistingOpenCodePushRegistration)
    .mockResolvedValue({ expoPushToken: "ExponentPushToken[1]" } as never);
  jest.mocked(readNotificationPairingSecret).mockRejectedValue(new Error("SECRET_MISSING"));

  await renderProvider();
  await settle();

  expect(sendNotificationDeviceCommand).not.toHaveBeenCalled();
});

test("opens a finished session and records the event", async () => {
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  await renderProvider();

  await deliver();

  await waitFor(() =>
    expect(rootNavigationRef.navigate).toHaveBeenCalledWith("Session", {
      connectionId: "connection-1",
      location,
      sessionID: "session-1",
    }),
  );
  expect(getOpenCodeSession).toHaveBeenCalledWith(restClient, "session-1");
  expect(mockQueryClient.setQueryData).toHaveBeenCalledWith(
    openCodeQueryKeys.session("connection-1", location, "session-1"),
    { id: "session-1", location },
  );
  await waitFor(() =>
    expect(markNotificationEventHandled).toHaveBeenCalledWith(mockDb, "binding-1", "evt-1"),
  );
  expect(select).not.toHaveBeenCalled();
  expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
});

test("accepts the response that launched the app", async () => {
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  jest
    .mocked(Notifications.getLastNotificationResponseAsync)
    .mockResolvedValue(notificationResponse("launch-response"));

  await renderProvider();

  await waitFor(() => expect(rootNavigationRef.navigate).toHaveBeenCalledTimes(1));
  expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
});

test("ignores the launch response after unmount", async () => {
  let resolveLast: (value: Notifications.NotificationResponse) => void = () => undefined;
  jest.mocked(Notifications.getLastNotificationResponseAsync).mockReturnValue(
    new Promise((resolve) => {
      resolveLast = resolve;
    }),
  );
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  const view = await renderProvider();

  view.unmount();
  await act(async () => {
    resolveLast(notificationResponse("launch-response"));
  });

  expect(getNotificationPairingByBindingID).not.toHaveBeenCalled();
});

test("switches to the paired connection before opening the route", async () => {
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  jest.mocked(useConnections).mockReturnValue({ select, selectedProfileId: "other" } as never);
  mockRuntime("other");
  const view = await renderProvider();

  await deliver();

  await waitFor(() => expect(select).toHaveBeenCalledWith("connection-1"));
  expect(getOpenCodeSession).not.toHaveBeenCalled();

  mockRuntime("connection-1", null);
  await view.rerender(
    <NotificationRoutingProvider>
      <Text>Routed child</Text>
    </NotificationRoutingProvider>,
  );
  await settle();
  expect(getOpenCodeSession).not.toHaveBeenCalled();

  mockRuntime("connection-1");
  await view.rerender(
    <NotificationRoutingProvider>
      <Text>Routed child</Text>
    </NotificationRoutingProvider>,
  );
  await waitFor(() => expect(rootNavigationRef.navigate).toHaveBeenCalledTimes(1));
});

test("handles each notification response once", async () => {
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  await renderProvider();

  await deliver("response-1");
  await deliver("response-1");
  await settle();

  expect(getNotificationPairingByBindingID).toHaveBeenCalledTimes(1);
});

test("ignores test, expired, unpaired, replayed, and undecryptable notifications", async () => {
  await renderProvider();

  mockRoute({ kind: "test" });
  await deliver("test");
  mockRoute({ expiresAtMs: Date.now() - 1, kind: "session-done", sessionID: "session-1" });
  await deliver("expired");
  jest.mocked(getNotificationPairingByBindingID).mockResolvedValueOnce(undefined as never);
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  await deliver("unpaired");
  jest.mocked(wasNotificationEventHandled).mockResolvedValueOnce(true);
  await deliver("replayed");
  jest.mocked(decryptNotificationRoute).mockImplementationOnce(() => {
    throw new Error("NOTIFICATION_DECRYPT_FAILED");
  });
  await deliver("undecryptable");
  await settle();

  expect(wasNotificationEventHandled).toHaveBeenCalledTimes(1);
  expect(getOpenCodeSession).not.toHaveBeenCalled();
  expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(5);
});

test("ignores a second delivery of an event that is still opening", async () => {
  jest.mocked(getOpenCodeSession).mockReturnValue(new Promise(() => undefined) as never);
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  await renderProvider();

  await deliver("response-1");
  await deliver("response-2");
  await settle();

  expect(wasNotificationEventHandled).toHaveBeenCalledTimes(1);
  expect(getOpenCodeSession).toHaveBeenCalledTimes(1);
});

test("allows an event to route again after opening it fails", async () => {
  jest.mocked(getOpenCodeSession).mockRejectedValueOnce(new Error("NETWORK"));
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  await renderProvider();

  await deliver("response-1");
  await settle();
  expect(markNotificationEventHandled).not.toHaveBeenCalled();

  await deliver("response-2");
  await waitFor(() => expect(rootNavigationRef.navigate).toHaveBeenCalledTimes(1));
  expect(getOpenCodeSession).toHaveBeenCalledTimes(2);
});

test("waits for navigation to become ready", async () => {
  jest.mocked(rootNavigationRef.isReady).mockReturnValueOnce(false).mockReturnValue(true);
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  await renderProvider();

  await deliver();

  await waitFor(() => expect(rootNavigationRef.navigate).toHaveBeenCalledTimes(1));
  expect(rootNavigationRef.isReady).toHaveBeenCalledTimes(2);
});

test("drops the route when navigation never becomes ready", async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(rootNavigationRef.isReady).mockReturnValue(false);
    mockRoute({ kind: "session-done", sessionID: "session-1" });
    await renderProvider();
    await deliver();
    await settle();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_100);
    });

    expect(rootNavigationRef.navigate).not.toHaveBeenCalled();
    expect(markNotificationEventHandled).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("does not open a route after unmount", async () => {
  let resolveSession: (value: unknown) => void = () => undefined;
  jest.mocked(getOpenCodeSession).mockReturnValue(
    new Promise((resolve) => {
      resolveSession = resolve;
    }) as never,
  );
  mockRoute({ kind: "session-done", sessionID: "session-1" });
  const view = await renderProvider();
  await deliver();
  await settle();

  view.unmount();
  await act(async () => {
    resolveSession({ id: "session-1", location });
  });

  expect(mockQueryClient.setQueryData).not.toHaveBeenCalled();
  expect(rootNavigationRef.navigate).not.toHaveBeenCalled();
  expect(markNotificationEventHandled).not.toHaveBeenCalled();
});

test("opens pending requests for a global form", async () => {
  jest.mocked(listOpenCodeFormRequests).mockResolvedValue({ data: [{ id: "form-1" }] } as never);
  mockRoute({
    interaction: "form",
    kind: "interaction",
    location,
    requestID: "form-1",
    sessionID: "global",
  });
  await renderProvider();

  await deliver();

  await waitFor(() => expect(rootNavigationRef.navigate).toHaveBeenCalledWith("Pending"));
  expect(listOpenCodeFormRequests).toHaveBeenCalledWith(restClient, location);
  expect(includeAttentionLocation).toHaveBeenCalledWith(location);
  expect(mockQueryClient.setQueryData).toHaveBeenCalledWith(
    openCodeQueryKeys.forms("connection-1", location),
    { data: [{ id: "form-1" }] },
  );
  await waitFor(() => expect(markNotificationEventHandled).toHaveBeenCalledTimes(1));
});

test("records a global form that is no longer pending without navigating", async () => {
  mockRoute({
    interaction: "form",
    kind: "interaction",
    location,
    requestID: "form-1",
    sessionID: "global",
  });
  await renderProvider();

  await deliver();

  await waitFor(() => expect(markNotificationEventHandled).toHaveBeenCalledTimes(1));
  expect(includeAttentionLocation).not.toHaveBeenCalled();
  expect(rootNavigationRef.navigate).not.toHaveBeenCalled();
});

test("drops a global form route without a location", async () => {
  mockRoute({ interaction: "form", kind: "interaction", requestID: "form-1", sessionID: "global" });
  await renderProvider();

  await deliver();
  await settle();

  expect(listOpenCodeFormRequests).not.toHaveBeenCalled();
  expect(markNotificationEventHandled).not.toHaveBeenCalled();
});

test("opens the session for a pending permission request", async () => {
  jest
    .mocked(listOpenCodePermissionRequests)
    .mockResolvedValue({ data: [{ id: "permission-1" }] } as never);
  mockRoute({
    interaction: "permission",
    kind: "interaction",
    requestID: "permission-1",
    sessionID: "session-1",
  });
  await renderProvider();

  await deliver();

  await waitFor(() =>
    expect(rootNavigationRef.navigate).toHaveBeenCalledWith("Session", {
      connectionId: "connection-1",
      location,
      sessionID: "session-1",
    }),
  );
  expect(listOpenCodePermissionRequests).toHaveBeenCalledWith(restClient, location);
  expect(listOpenCodeFormRequests).toHaveBeenCalledWith(restClient, location);
  expect(mockQueryClient.setQueryData).toHaveBeenCalledWith(
    openCodeQueryKeys.permissions("connection-1", location),
    { data: [{ id: "permission-1" }] },
  );
  await waitFor(() => expect(markNotificationEventHandled).toHaveBeenCalledTimes(1));
});

test("records a session form that is no longer pending without navigating", async () => {
  jest
    .mocked(listOpenCodePermissionRequests)
    .mockResolvedValue({ data: [{ id: "form-1" }] } as never);
  mockRoute({
    interaction: "form",
    kind: "interaction",
    requestID: "form-1",
    sessionID: "session-1",
  });
  await renderProvider();

  await deliver();

  await waitFor(() => expect(markNotificationEventHandled).toHaveBeenCalledTimes(1));
  expect(rootNavigationRef.navigate).not.toHaveBeenCalled();
});

test("does not load interaction requests after unmount", async () => {
  let resolveSession: (value: unknown) => void = () => undefined;
  jest.mocked(getOpenCodeSession).mockReturnValue(
    new Promise((resolve) => {
      resolveSession = resolve;
    }) as never,
  );
  mockRoute({
    interaction: "permission",
    kind: "interaction",
    requestID: "permission-1",
    sessionID: "session-1",
  });
  const view = await renderProvider();
  await deliver();
  await settle();

  view.unmount();
  await act(async () => {
    resolveSession({ id: "session-1", location });
  });

  expect(listOpenCodePermissionRequests).not.toHaveBeenCalled();
  expect(markNotificationEventHandled).not.toHaveBeenCalled();
});
