import { useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { sendNotificationDeviceCommand } from "../notifications/notification-client";
import {
  cleanupPendingNotificationSecretOperations,
  finishPendingNotificationRevocation,
  listNotificationPairings,
  listPendingNotificationRevocations,
  readNotificationPairingSecret,
  readPendingNotificationRevocationSecret,
} from "../notifications/notification-pairing-repository";
import { deleteConnectionCacheMetadata } from "../state/connection-cache-metadata";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { cleanupPendingDraftKeyDeletions } from "../storage/draft-repository";
import type { ConnectionCredential, ConnectionProfile } from "./connection-profile";
import {
  getSelectedConnectionId,
  listConnectionProfiles,
  removeConnectionProfile,
  type SaveConnectionProfileInput,
  saveConnectionProfile,
  selectConnectionProfile,
} from "./connection-repository";
import { cleanupPendingCredentialOperations, readConnectionCredential } from "./credential-store";

type ConnectionsContextValue = {
  error?: string;
  profiles: ConnectionProfile[];
  readCredential: (profile: ConnectionProfile) => Promise<ConnectionCredential | undefined>;
  ready: boolean;
  reload: () => Promise<void>;
  remove: (profileId: string) => Promise<void>;
  save: (input: SaveConnectionProfileInput) => Promise<string>;
  select: (profileId: string) => Promise<void>;
  selectedProfileId?: string;
};

const ConnectionsContext = createContext<ConnectionsContextValue | undefined>(undefined);

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    Promise.all([
      cleanupPendingCredentialOperations(db),
      cleanupPendingDraftKeyDeletions(db),
      cleanupPendingNotificationSecretOperations(db),
    ])
      .then(() => retryPendingNotificationRevocations(db))
      .then(() => load())
      .catch(() => {
        if (active) setError("Saved connections could not be loaded securely.");
      })
      .finally(() => {
        if (active) setReady(true);
      });

    async function load() {
      const [nextProfiles, nextSelectedId] = await Promise.all([
        listConnectionProfiles(db),
        getSelectedConnectionId(db),
      ]);
      if (!active) return;
      setProfiles(nextProfiles);
      setSelectedProfileId(nextSelectedId);
    }

    return () => {
      active = false;
    };
  }, [db]);

  async function refresh() {
    const [nextProfiles, nextSelectedId] = await Promise.all([
      listConnectionProfiles(db),
      getSelectedConnectionId(db),
    ]);
    setProfiles(nextProfiles);
    setSelectedProfileId(nextSelectedId);
  }

  async function save(input: SaveConnectionProfileInput) {
    const existingProfile = input.draft.id
      ? profiles.find((profile) => profile.id === input.draft.id)
      : undefined;
    const originChanged =
      existingProfile !== undefined &&
      existingProfile.baseUrl !== validatedOriginRoot(input.draft.baseUrl);
    const previousPairing = originChanged
      ? (await listNotificationPairings(db)).find(
          (pairing) => pairing.connectionId === input.draft.id,
        )
      : undefined;
    if (previousPairing) {
      const previousSecret = await readNotificationPairingSecret(previousPairing);
      await sendNotificationDeviceCommand({
        bindingID: previousPairing.bindingID,
        brokerOrigin: previousPairing.brokerOrigin,
        deviceKey: previousSecret.deviceKey,
        operation: "revoke",
      });
    }
    const id = await saveConnectionProfile(db, input);
    if (input.draft.id) {
      queryClient.removeQueries({ queryKey: openCodeQueryKeys.connection(id) });
      await deleteConnectionCacheMetadata(id).catch(() => undefined);
    }
    await refresh();
    return id;
  }

  async function reload() {
    setError(undefined);
    try {
      await Promise.all([
        cleanupPendingCredentialOperations(db),
        cleanupPendingDraftKeyDeletions(db),
        cleanupPendingNotificationSecretOperations(db),
      ]);
      await retryPendingNotificationRevocations(db);
      await refresh();
    } catch {
      setError("Saved connections could not be loaded securely.");
    }
  }

  async function select(profileId: string) {
    await selectConnectionProfile(db, profileId);
    await refresh();
  }

  async function remove(profileId: string) {
    const pairing = (await listNotificationPairings(db)).find(
      (candidate) => candidate.connectionId === profileId,
    );
    if (pairing) {
      const secret = await readNotificationPairingSecret(pairing);
      await sendNotificationDeviceCommand({
        bindingID: pairing.bindingID,
        brokerOrigin: pairing.brokerOrigin,
        deviceKey: secret.deviceKey,
        operation: "revoke",
      });
    }
    await removeConnectionProfile(db, profileId);
    queryClient.removeQueries({ queryKey: openCodeQueryKeys.connection(profileId) });
    await deleteConnectionCacheMetadata(profileId).catch(() => undefined);
    await refresh();
  }

  async function readCredential(profile: ConnectionProfile) {
    if (!profile.credentialRef) return undefined;
    return readConnectionCredential(profile.credentialRef);
  }

  return (
    <ConnectionsContext
      value={{
        ...(error ? { error } : {}),
        profiles,
        readCredential,
        ready,
        reload,
        remove,
        save,
        select,
        ...(selectedProfileId ? { selectedProfileId } : {}),
      }}
    >
      {children}
    </ConnectionsContext>
  );
}

async function retryPendingNotificationRevocations(db: ReturnType<typeof useSQLiteContext>) {
  const pendingRevocations = await listPendingNotificationRevocations(db);
  for (const pending of pendingRevocations) {
    try {
      const secret = await readPendingNotificationRevocationSecret(pending);
      await sendNotificationDeviceCommand({
        bindingID: pending.bindingID,
        brokerOrigin: pending.brokerOrigin,
        deviceKey: secret.deviceKey,
        operation: "revoke",
      });
      await finishPendingNotificationRevocation(db, pending);
    } catch (error) {
      if (error instanceof Error && error.message === "DEVICE_NOT_FOUND") {
        await finishPendingNotificationRevocation(db, pending);
      }
    }
  }
}

function validatedOriginRoot(value: string) {
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("INVALID_CONNECTION_URL");
  }
  return url.origin;
}

export function useConnections() {
  const value = use(ConnectionsContext);
  if (!value) throw new Error("ConnectionsProvider is missing");
  return value;
}
