import { beforeEach, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import type { SaveConnectionProfileInput } from "./connection-repository";
import { ConnectionsProvider, useConnections } from "./connections-context";

jest.mock("expo-sqlite", () => {
  const database = {};
  return { useSQLiteContext: () => database };
});
jest.mock("../state/connection-cache-metadata", () => ({
  deleteConnectionCacheMetadata: jest.fn(async () => undefined),
}));
type MockPairing = { bindingID: string; brokerOrigin: string; connectionId: string };

const mockCleanupCredentials = jest.fn(async () => undefined);
const mockListPairings = jest.fn<() => Promise<MockPairing[]>>(async () => []);
const mockListPendingRevocations = jest.fn<() => Promise<MockPairing[]>>(async () => []);
const mockFinishPendingRevocation = jest.fn<(db: unknown, pending: MockPairing) => Promise<void>>(
  async () => undefined,
);
const mockReadPairingSecret = jest.fn<(pairing: MockPairing) => Promise<unknown>>(
  async () => undefined,
);
const mockReadPendingRevocationSecret = jest.fn<(pending: MockPairing) => Promise<unknown>>(
  async () => undefined,
);
const mockSendDeviceCommand = jest.fn<(command: unknown) => Promise<void>>(async () => undefined);
const mockReadCredential = jest.fn<(reference: string) => Promise<unknown>>(async () => undefined);
const mockSelectProfile = jest.fn<(db: unknown, profileId: string) => Promise<void>>(
  async () => undefined,
);
const mockSaveProfile = jest.fn<(db: unknown, input: unknown) => Promise<string>>(
  async () => "connection-1",
);
const mockGetSelectedId = jest.fn<() => Promise<string | undefined>>(async () => "connection-1");

jest.mock("../storage/draft-repository", () => ({
  cleanupPendingDraftKeyDeletions: async () => undefined,
}));
jest.mock("../notifications/notification-pairing-repository", () => ({
  cleanupPendingNotificationSecretOperations: async () => undefined,
  finishPendingNotificationRevocation: (db: unknown, pending: MockPairing) =>
    mockFinishPendingRevocation(db, pending),
  listNotificationPairings: () => mockListPairings(),
  listPendingNotificationRevocations: () => mockListPendingRevocations(),
  readNotificationPairingSecret: (pairing: MockPairing) => mockReadPairingSecret(pairing),
  readPendingNotificationRevocationSecret: (pending: MockPairing) =>
    mockReadPendingRevocationSecret(pending),
}));
jest.mock("../notifications/notification-client", () => ({
  sendNotificationDeviceCommand: (command: unknown) => mockSendDeviceCommand(command),
}));
jest.mock("./connection-repository", () => ({
  getSelectedConnectionId: () => mockGetSelectedId(),
  listConnectionProfiles: async () => [
    {
      allowDevelopmentHttp: false,
      authMode: "none",
      baseUrl: "https://server.test",
      createdAtMs: 1,
      id: "connection-1",
      name: "Server",
      schemaVersion: 1,
      updatedAtMs: 1,
    },
  ],
  removeConnectionProfile: jest.fn(async () => undefined),
  saveConnectionProfile: (db: unknown, input: unknown) => mockSaveProfile(db, input),
  selectConnectionProfile: (db: unknown, profileId: string) => mockSelectProfile(db, profileId),
}));
jest.mock("./credential-store", () => ({
  cleanupPendingCredentialOperations: () => mockCleanupCredentials(),
  readConnectionCredential: (reference: string) => mockReadCredential(reference),
}));

beforeEach(() => {
  for (const mock of [
    mockCleanupCredentials,
    mockListPairings,
    mockListPendingRevocations,
    mockFinishPendingRevocation,
    mockReadPairingSecret,
    mockReadPendingRevocationSecret,
    mockSendDeviceCommand,
    mockReadCredential,
    mockSelectProfile,
    mockSaveProfile,
    mockGetSelectedId,
  ]) {
    mock.mockClear();
  }
  mockCleanupCredentials.mockImplementation(async () => undefined);
  mockListPairings.mockImplementation(async () => []);
  mockListPendingRevocations.mockImplementation(async () => []);
  mockSendDeviceCommand.mockImplementation(async () => undefined);
  mockSaveProfile.mockImplementation(async () => "connection-1");
  mockGetSelectedId.mockImplementation(async () => "connection-1");
});

test("clears connection-owned query and cache state after edit or deletion", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  let save: ((input: SaveConnectionProfileInput) => Promise<string>) | undefined;
  let remove: ((profileId: string) => Promise<void>) | undefined;

  const view = render(
    <QueryClientProvider client={queryClient}>
      <ConnectionsProvider>
        <Capture
          onReady={(next) => {
            save = next.save;
            remove = next.remove;
          }}
        />
      </ConnectionsProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(save).toBeDefined());

  const healthKey = openCodeQueryKeys.health("connection-1");
  queryClient.setQueryData(healthKey, { healthy: true, pid: 1, version: "old" });
  await act(async () => {
    await save?.({
      draft: {
        allowDevelopmentHttp: false,
        authMode: "none",
        baseUrl: "https://replacement.test",
        id: "connection-1",
        name: "Replacement",
      },
      health: { checkedAtMs: 2, pid: 2, version: "test" },
    });
  });
  expect(queryClient.getQueryData(healthKey)).toBeUndefined();

  queryClient.setQueryData(healthKey, { healthy: true, pid: 2, version: "test" });
  await act(async () => {
    await remove?.("connection-1");
  });
  expect(queryClient.getQueryData(healthKey)).toBeUndefined();

  view.unmount();
  queryClient.clear();
});

function Capture({
  onReady,
}: {
  onReady: (value: {
    remove: (profileId: string) => Promise<void>;
    save: (input: SaveConnectionProfileInput) => Promise<string>;
  }) => void;
}) {
  const connections = useConnections();
  onReady({ remove: connections.remove, save: connections.save });
  return null;
}

type ConnectionsValue = ReturnType<typeof useConnections>;

const serverPairing = {
  bindingID: "binding-1",
  brokerOrigin: "https://broker.test",
  connectionId: "connection-1",
};

function renderConnections() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const latest: { current?: ConnectionsValue } = {};
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ConnectionsProvider>
        <Status
          onRender={(value) => {
            latest.current = value;
          }}
        />
      </ConnectionsProvider>
    </QueryClientProvider>,
  );
  return {
    connections: () => {
      if (!latest.current) throw new Error("connections not rendered");
      return latest.current;
    },
    queryClient,
    view,
  };
}

function Status({ onRender }: { onRender: (value: ConnectionsValue) => void }) {
  const connections = useConnections();
  onRender(connections);
  return (
    <>
      <Text>{connections.ready ? "ready" : "loading"}</Text>
      {connections.error ? <Text>{connections.error}</Text> : null}
      <Text>{`selected:${connections.selectedProfileId ?? "none"}`}</Text>
      <Text>{`profiles:${connections.profiles.length}`}</Text>
    </>
  );
}

test("loads saved profiles and the selected profile", async () => {
  const { view } = renderConnections();
  expect(screen.getByText("loading")).toBeOnTheScreen();
  expect(await screen.findByText("ready")).toBeOnTheScreen();
  expect(screen.getByText("selected:connection-1")).toBeOnTheScreen();
  expect(screen.getByText("profiles:1")).toBeOnTheScreen();
  view.unmount();
});

test("omits the selected profile when none is stored", async () => {
  mockGetSelectedId.mockImplementation(async () => undefined);
  const { view } = renderConnections();
  expect(await screen.findByText("ready")).toBeOnTheScreen();
  expect(screen.getByText("selected:none")).toBeOnTheScreen();
  view.unmount();
});

test("fails closed when pending secure cleanup fails and recovers on reload", async () => {
  mockCleanupCredentials.mockRejectedValueOnce(new Error("private secure store detail"));
  const { connections, view } = renderConnections();

  expect(await screen.findByText("ready")).toBeOnTheScreen();
  expect(screen.getByText("Saved connections could not be loaded securely.")).toBeOnTheScreen();
  expect(screen.getByText("profiles:0")).toBeOnTheScreen();

  await act(async () => {
    await connections().reload();
  });
  expect(screen.queryByText("Saved connections could not be loaded securely.")).toBeNull();
  expect(screen.getByText("profiles:1")).toBeOnTheScreen();

  mockCleanupCredentials.mockRejectedValueOnce(new Error("private secure store detail"));
  await act(async () => {
    await connections().reload();
  });
  expect(screen.getByText("Saved connections could not be loaded securely.")).toBeOnTheScreen();
  view.unmount();
});

test("does not update state after unmounting during the initial load", async () => {
  let finishCleanup: (() => void) | undefined;
  mockCleanupCredentials.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishCleanup = () => resolve(undefined);
      }),
  );
  const { view } = renderConnections();
  view.unmount();
  await act(async () => {
    finishCleanup?.();
    await Promise.resolve();
  });

  let failCleanup: (() => void) | undefined;
  mockCleanupCredentials.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failCleanup = () => reject(new Error("late"));
      }),
  );
  const failed = renderConnections();
  failed.view.unmount();
  await act(async () => {
    failCleanup?.();
    await Promise.resolve();
  });
  expect(mockCleanupCredentials).toHaveBeenCalledTimes(2);
});

test("retries pending notification revocations before loading profiles", async () => {
  const delivered = { ...serverPairing, bindingID: "delivered" };
  const missing = { ...serverPairing, bindingID: "missing" };
  const offline = { ...serverPairing, bindingID: "offline" };
  mockListPendingRevocations.mockImplementation(async () => [delivered, missing, offline]);
  mockReadPendingRevocationSecret.mockImplementation(async (pending) => ({
    deviceKey: `key-${pending.bindingID}`,
  }));
  mockSendDeviceCommand.mockImplementation(async (command) => {
    const { bindingID } = command as { bindingID: string };
    if (bindingID === "missing") throw new Error("DEVICE_NOT_FOUND");
    if (bindingID === "offline") throw new Error("NETWORK");
  });

  const { view } = renderConnections();
  expect(await screen.findByText("ready")).toBeOnTheScreen();

  expect(mockSendDeviceCommand).toHaveBeenCalledWith({
    bindingID: "delivered",
    brokerOrigin: "https://broker.test",
    deviceKey: "key-delivered",
    operation: "revoke",
  });
  expect(mockFinishPendingRevocation.mock.calls.map(([, pending]) => pending.bindingID)).toEqual([
    "delivered",
    "missing",
  ]);
  expect(screen.queryByText("Saved connections could not be loaded securely.")).toBeNull();
  view.unmount();
});

test("keeps a pending revocation when its secret cannot be read", async () => {
  mockListPendingRevocations.mockImplementation(async () => [serverPairing]);
  mockReadPendingRevocationSecret.mockRejectedValueOnce("unreadable");
  const { view } = renderConnections();
  expect(await screen.findByText("ready")).toBeOnTheScreen();
  expect(mockSendDeviceCommand).not.toHaveBeenCalled();
  expect(mockFinishPendingRevocation).not.toHaveBeenCalled();
  view.unmount();
});

test("revokes the notification pairing before saving a profile with a new origin", async () => {
  mockListPairings.mockImplementation(async () => [
    { ...serverPairing, bindingID: "other", connectionId: "connection-2" },
    serverPairing,
  ]);
  mockReadPairingSecret.mockImplementation(async () => ({ deviceKey: "device-key" }));
  const order: string[] = [];
  mockSendDeviceCommand.mockImplementation(async () => {
    order.push("revoke");
  });
  mockSaveProfile.mockImplementation(async () => {
    order.push("save");
    return "connection-1";
  });
  const { connections, view } = renderConnections();
  await screen.findByText("ready");

  await act(async () => {
    await connections().save({
      draft: {
        allowDevelopmentHttp: false,
        authMode: "none",
        baseUrl: " https://replacement.test/ ",
        id: "connection-1",
        name: "Replacement",
      },
      health: { checkedAtMs: 2, pid: 2, version: "test" },
    });
  });

  expect(mockSendDeviceCommand).toHaveBeenCalledWith({
    bindingID: "binding-1",
    brokerOrigin: "https://broker.test",
    deviceKey: "device-key",
    operation: "revoke",
  });
  expect(order).toEqual(["revoke", "save"]);
  view.unmount();
});

test("does not save when revoking the previous origin's pairing fails", async () => {
  mockListPairings.mockImplementation(async () => [serverPairing]);
  mockReadPairingSecret.mockImplementation(async () => ({ deviceKey: "device-key" }));
  mockSendDeviceCommand.mockRejectedValue(new Error("NETWORK"));
  const { connections, view } = renderConnections();
  await screen.findByText("ready");

  await expect(
    connections().save({
      draft: {
        allowDevelopmentHttp: false,
        authMode: "none",
        baseUrl: "https://replacement.test",
        id: "connection-1",
        name: "Replacement",
      },
      health: { checkedAtMs: 2, pid: 2, version: "test" },
    }),
  ).rejects.toThrow("NETWORK");
  expect(mockSaveProfile).not.toHaveBeenCalled();
  view.unmount();
});

test("rejects an invalid origin when editing a saved profile", async () => {
  const { connections, view } = renderConnections();
  await screen.findByText("ready");
  for (const baseUrl of [
    "ftp://server.test",
    "https://user@server.test",
    "https://:secret@server.test",
    "https://server.test/path",
    "https://server.test/?query",
    "https://server.test/#hash",
  ]) {
    await expect(
      connections().save({
        draft: {
          allowDevelopmentHttp: false,
          authMode: "none",
          baseUrl,
          id: "connection-1",
          name: "Server",
        },
        health: { checkedAtMs: 2, pid: 2, version: "test" },
      }),
    ).rejects.toThrow("INVALID_CONNECTION_URL");
  }
  expect(mockSaveProfile).not.toHaveBeenCalled();
  view.unmount();
});

test("saves without revocation when the origin is unchanged or the profile is new", async () => {
  mockSaveProfile.mockImplementation(async () => "connection-2");
  const { connections, queryClient, view } = renderConnections();
  await screen.findByText("ready");
  const healthKey = openCodeQueryKeys.health("connection-2");
  queryClient.setQueryData(healthKey, { healthy: true, pid: 1, version: "old" });

  let id: string | undefined;
  await act(async () => {
    id = await connections().save({
      draft: {
        allowDevelopmentHttp: false,
        authMode: "none",
        baseUrl: "https://new.test",
        name: "New server",
      },
      health: { checkedAtMs: 2, pid: 2, version: "test" },
    });
  });
  expect(id).toBe("connection-2");
  expect(queryClient.getQueryData(healthKey)).toBeDefined();

  await act(async () => {
    await connections().save({
      draft: {
        allowDevelopmentHttp: false,
        authMode: "none",
        baseUrl: "https://server.test",
        id: "connection-1",
        name: "Renamed",
      },
      health: { checkedAtMs: 2, pid: 2, version: "test" },
    });
  });
  await act(async () => {
    await connections().save({
      draft: {
        allowDevelopmentHttp: false,
        authMode: "none",
        baseUrl: "https://elsewhere.test",
        id: "unknown-profile",
        name: "Unknown",
      },
      health: { checkedAtMs: 2, pid: 2, version: "test" },
    });
  });

  expect(mockListPairings).not.toHaveBeenCalled();
  expect(mockSendDeviceCommand).not.toHaveBeenCalled();
  expect(mockSaveProfile).toHaveBeenCalledTimes(3);
  view.unmount();
  queryClient.clear();
});

test("revokes the notification pairing before removing a profile", async () => {
  mockListPairings.mockImplementation(async () => [serverPairing]);
  mockReadPairingSecret.mockImplementation(async () => ({ deviceKey: "device-key" }));
  const { connections, view } = renderConnections();
  await screen.findByText("ready");

  await act(async () => {
    await connections().remove("connection-1");
  });

  expect(mockSendDeviceCommand).toHaveBeenCalledWith({
    bindingID: "binding-1",
    brokerOrigin: "https://broker.test",
    deviceKey: "device-key",
    operation: "revoke",
  });
  view.unmount();
});

test("selects a profile and refreshes the selection", async () => {
  const { connections, view } = renderConnections();
  await screen.findByText("ready");
  mockGetSelectedId.mockImplementation(async () => "connection-2");

  await act(async () => {
    await connections().select("connection-2");
  });

  expect(mockSelectProfile).toHaveBeenCalledWith(expect.anything(), "connection-2");
  expect(screen.getByText("selected:connection-2")).toBeOnTheScreen();
  view.unmount();
});

test("reads credentials only for profiles with a credential reference", async () => {
  mockReadCredential.mockImplementation(async () => ({ mode: "bearer", token: "t" }));
  const { connections, view } = renderConnections();
  await screen.findByText("ready");
  const profile = connections().profiles[0];
  if (!profile) throw new Error("profile missing");

  await expect(connections().readCredential(profile)).resolves.toBeUndefined();
  expect(mockReadCredential).not.toHaveBeenCalled();

  await expect(
    connections().readCredential({ ...profile, authMode: "bearer", credentialRef: "ref-1" }),
  ).resolves.toEqual({ mode: "bearer", token: "t" });
  expect(mockReadCredential).toHaveBeenCalledWith("ref-1");
  view.unmount();
});

test("requires the provider", () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  expect(() => render(<Status onRender={() => undefined} />)).toThrow(
    "ConnectionsProvider is missing",
  );
  jest.mocked(console.error).mockRestore();
});
