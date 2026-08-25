import { expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react-native";
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
jest.mock("../storage/draft-repository", () => ({
  cleanupPendingDraftKeyDeletions: async () => undefined,
}));
jest.mock("../notifications/notification-pairing-repository", () => ({
  cleanupPendingNotificationSecretOperations: async () => undefined,
  finishPendingNotificationRevocation: async () => undefined,
  listNotificationPairings: async () => [],
  listPendingNotificationRevocations: async () => [],
  readNotificationPairingSecret: async () => undefined,
  readPendingNotificationRevocationSecret: async () => undefined,
}));
jest.mock("../notifications/notification-client", () => ({
  sendNotificationDeviceCommand: async () => undefined,
}));
jest.mock("./connection-repository", () => ({
  getSelectedConnectionId: async () => "connection-1",
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
  saveConnectionProfile: jest.fn(async () => "connection-1"),
  selectConnectionProfile: async () => undefined,
}));
jest.mock("./credential-store", () => ({
  cleanupPendingCredentialOperations: async () => undefined,
  readConnectionCredential: async () => undefined,
}));

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
