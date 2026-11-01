import {
  type LocationRef,
  type OpenCodeClient,
  removeOpenCodeSession,
  type SessionInfo,
} from "@opencode2-mobile/opencode-adapter";
import { type QueryClient, useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import type { SQLiteDatabase } from "expo-sqlite";
import type { RefObject } from "react";
import { Alert } from "react-native";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { deleteSessionLocalState } from "../storage/prompt-admission-repository";
import { loadOpenCodeSessionTreeIds } from "./session-deletion";

export function useRemoveSessionMutation({
  client,
  connectionId,
  db,
  queryClient,
  removeAbortRef,
}: {
  client: OpenCodeClient | undefined;
  connectionId: string | undefined;
  db: SQLiteDatabase;
  queryClient: QueryClient;
  removeAbortRef: RefObject<AbortController | null>;
}) {
  return useMutation({
    mutationFn: async (session: SessionInfo) => {
      if (!client || !connectionId) throw new Error("CONNECTION_NOT_READY");
      return removeSessionTree(client, connectionId, db, removeAbortRef, session);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "REQUEST_ABORTED") return;
      Alert.alert("Delete failed", "The session is still present. Refresh and try again.");
    },
    onSuccess: ({ cleanupSucceeded, location: deletedLocation, sessionIds }) => {
      if (!connectionId) return;
      removeDeletedSessionQueries(queryClient, connectionId, deletedLocation, sessionIds);
      if (!cleanupSucceeded) {
        Alert.alert(
          "Local cleanup incomplete",
          "The server deleted the session, but encrypted local state could not be removed. Removing this connection profile will clear it.",
        );
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => undefined,
      );
    },
  });
}

async function removeSessionTree(
  client: OpenCodeClient,
  connectionId: string,
  db: SQLiteDatabase,
  removeAbortRef: RefObject<AbortController | null>,
  session: SessionInfo,
) {
  const controller = new AbortController();
  removeAbortRef.current?.abort();
  removeAbortRef.current = controller;
  try {
    const sessionIds = await loadOpenCodeSessionTreeIds(
      client,
      session.location,
      session.id,
      controller.signal,
    );
    await removeOpenCodeSession(client, session.id, { signal: controller.signal });
    const cleanupSucceeded = await deleteSessionLocalState(db, connectionId, sessionIds).then(
      () => true,
      () => false,
    );
    return { cleanupSucceeded, location: session.location, sessionIds };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("REQUEST_ABORTED");
    throw error;
  } finally {
    if (removeAbortRef.current === controller) removeAbortRef.current = null;
  }
}

function removeDeletedSessionQueries(
  queryClient: QueryClient,
  connectionId: string,
  location: LocationRef,
  sessionIds: readonly string[],
) {
  for (const deletedSessionID of sessionIds) {
    queryClient.removeQueries({
      queryKey: openCodeQueryKeys.session(connectionId, location, deletedSessionID),
    });
    queryClient.removeQueries({
      queryKey: openCodeQueryKeys.messageRoot(connectionId, location, deletedSessionID),
    });
    queryClient.removeQueries({
      queryKey: openCodeQueryKeys.inbox(connectionId, location, deletedSessionID),
    });
    queryClient.removeQueries({
      queryKey: openCodeQueryKeys.promptAdmissions(connectionId, location, deletedSessionID),
    });
  }
  void queryClient.invalidateQueries({
    queryKey: openCodeQueryKeys.connection(connectionId),
  });
}
