import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { useRef } from "react";
import {
  readSessionArchivePreferences,
  setSessionArchived,
} from "../storage/session-archive-repository";

export function useSessionArchives(connectionId?: string, connectionUpdatedAtMs?: number) {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();
  const writing = useRef(false);
  const queryKey = ["device-session-archives", connectionId, connectionUpdatedAtMs] as const;
  const query = useQuery({
    enabled: Boolean(connectionId),
    queryKey,
    queryFn: () => {
      if (!connectionId) throw new Error("CONNECTION_NOT_READY");
      return readSessionArchivePreferences(db, connectionId);
    },
  });
  const mutation = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      archived: boolean;
      connectionId: string;
      connectionUpdatedAtMs: number | undefined;
      queryKey: typeof queryKey;
    }) => {
      await setSessionArchived(
        db,
        input.connectionId,
        input.sessionId,
        input.archived,
        input.connectionUpdatedAtMs,
      );
      return readSessionArchivePreferences(db, input.connectionId);
    },
    onSuccess: (ids, input) => queryClient.setQueryData(input.queryKey, ids),
  });
  return {
    ids: query.data?.ids ?? [],
    restoredAt: query.data?.restoredAt ?? {},
    loaded: query.isSuccess,
    busy: query.isPending || mutation.isPending,
    error: query.isError,
    refetch: query.refetch,
    async setArchived(sessionId: string, archived: boolean) {
      return updateArchives(sessionId, archived);
    },
  };

  async function updateArchives(sessionId: string, archived: boolean) {
    if (writing.current || query.isPending || query.isError || !connectionId) return;
    writing.current = true;
    try {
      await mutation.mutateAsync({
        sessionId,
        archived,
        connectionId,
        connectionUpdatedAtMs,
        queryKey,
      });
    } finally {
      writing.current = false;
    }
  }
}
