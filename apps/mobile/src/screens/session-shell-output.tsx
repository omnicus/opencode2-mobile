import {
  getOpenCodeShell,
  getOpenCodeShellOutput,
  isShellNotFoundError,
  type LocationRef,
  maxShellOutputBytes,
  type OpenCodeClient,
  removeOpenCodeShell,
  type SessionMessageInfo,
  type ShellGetOutput,
} from "@opencode2-mobile/opencode-adapter";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";

import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { type ShellCandidate, shellCandidates } from "./session-background-shells-model";
import {
  boundShellOutput,
  missingShellSnapshot,
  type ShellSnapshot,
  shellObservationStatus,
  shellRefetchInterval,
} from "./session-shell-output-model";

export type ShellScope = {
  client: OpenCodeClient | undefined;
  connectionId: string;
  enabled: boolean;
  location: LocationRef;
};

export const SessionShellScope = createContext<ShellScope | undefined>(undefined);

type Observation = {
  snapshot?: ShellSnapshot | undefined;
  error: boolean;
  statusLabel: string;
  retry: () => void;
};

export function ShellObservation({
  children,
  shellID,
}: {
  children: (observation: Observation | undefined) => ReactNode;
  shellID: string | undefined;
}) {
  const scope = useContext(SessionShellScope);
  if (!scope || !shellID) return children(undefined);
  // Unmount on a scope change, so neither output nor an in-flight request crosses servers.
  return (
    <ObservedShell
      key={JSON.stringify([
        scope.connectionId,
        scope.location.directory,
        scope.location.workspaceID,
        shellID,
      ])}
      scope={scope}
      shellID={shellID}
    >
      {children}
    </ObservedShell>
  );
}

function ObservedShell({
  children,
  scope,
  shellID,
}: {
  children: (observation: Observation) => ReactNode;
  scope: ShellScope;
  shellID: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = openCodeQueryKeys.shell(scope.connectionId, scope.location, shellID);
  const query = useQuery<ShellSnapshot>({
    queryKey,
    enabled: Boolean(scope.enabled && scope.client),
    gcTime: 60_000,
    retry: 1,
    // Shell lifetime is independent of model/session execution. React Query's
    // focus/online managers pause this when the native app is backgrounded/offline.
    refetchInterval: (query) => shellRefetchInterval(query.state.status, query.state.data),
    queryFn: async ({ signal }): Promise<ShellSnapshot> => {
      if (!scope.client || !scope.enabled) throw new Error("CONNECTION_NOT_READY");
      const previous = queryClient.getQueryData<ShellSnapshot>(queryKey);
      return fetchShellSnapshot(scope.client, scope.location, shellID, previous, signal);
    },
  });
  // Keys carry the connection and location, so last-known output never crosses servers; it stays
  // on screen while the connection is stale instead of falling back to "Loading".
  const snapshot = query.data;
  return children({
    snapshot,
    error: query.isError,
    statusLabel: shellObservationStatus(snapshot, query.isError),
    retry: () => {
      if (scope.enabled) void query.refetch();
    },
  });
}

async function fetchShellSnapshot(
  client: OpenCodeClient,
  location: LocationRef,
  shellID: string,
  previous: ShellSnapshot | undefined,
  signal: AbortSignal,
): Promise<ShellSnapshot> {
  try {
    const { data: info } = await getOpenCodeShell(client, location, shellID, { signal });
    const page = await readShellOutput(client, location, shellID, previous, signal);
    const { output, truncated } = boundShellOutput(page.output, page.truncated);
    return { info, cursor: page.cursor, output, truncated: Boolean(truncated), missing: false };
  } catch (error) {
    if (!isShellNotFoundError(error)) throw error;
    return missingShellSnapshot(previous);
  }
}

async function readShellOutput(
  client: OpenCodeClient,
  location: LocationRef,
  shellID: string,
  previous: ShellSnapshot | undefined,
  signal: AbortSignal,
) {
  const previousCursor = previous?.cursor ?? 0;
  let { data: page } = await getOpenCodeShellOutput(client, location, shellID, {
    cursor: previousCursor,
    signal,
  });
  let output = (previous?.output ?? "") + page.output;
  let truncated = previous?.truncated || page.truncated || output.length > maxShellOutputBytes;
  // Catch up to the latest bounded tail in at most one extra request,
  // including after reconnection or opening a long-finished command.
  if (page.cursor < page.size || page.cursor < previousCursor) {
    const cursor = Math.max(0, page.size - maxShellOutputBytes);
    ({ data: page } = await getOpenCodeShellOutput(client, location, shellID, { cursor, signal }));
    output = page.output;
    truncated = cursor > 0 || page.truncated;
  }
  return { cursor: page.cursor, output, truncated };
}

export type ShellStatus = { info?: ShellGetOutput["data"]; missing: boolean };
// The last loaded status, and whether the newest refresh of it failed.
type ShellStatusResult = ShellStatus & { refreshFailed: boolean };

function isSettledShellStatus(status: ShellStatus | undefined) {
  return Boolean(status && (status.missing || status.info?.status !== "running"));
}

// Events invalidate shell queries when a shell exits; the slow poll only covers missed events.
const shellStatusPollMs = 10_000;

// Server status for each shell the transcript says may run in the background, keyed by ID.
// Unknown until loaded, so a shell that already ended never flashes as running.
export function useShellStatuses(shellIDs: readonly string[]) {
  const scope = useContext(SessionShellScope);
  const results = useQueries({
    queries: shellIDs.map((shellID) => ({
      queryKey: scope
        ? openCodeQueryKeys.shellStatus(scope.connectionId, scope.location, shellID)
        : ["shell-status-unscoped", shellID],
      enabled: Boolean(scope?.enabled && scope.client),
      gcTime: 60_000,
      retry: 1,
      // An ended or removed shell never runs again, so shell events and focus do not refetch it.
      staleTime: (query: { state: { data?: ShellStatus | undefined } }) =>
        isSettledShellStatus(query.state.data) ? Number.POSITIVE_INFINITY : 0,
      refetchInterval: (query: { state: { data?: ShellStatus | undefined } }) =>
        isSettledShellStatus(query.state.data) ? false : shellStatusPollMs,
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ShellStatus> => {
        if (!scope?.client || !scope.enabled) throw new Error("CONNECTION_NOT_READY");
        try {
          const { data } = await getOpenCodeShell(scope.client, scope.location, shellID, {
            signal,
          });
          return { info: data, missing: false };
        } catch (error) {
          if (isShellNotFoundError(error)) return { missing: true };
          throw error;
        }
      },
    })),
  });
  // Keys carry the connection and location, so last-known data never crosses servers.
  const statuses = new Map<string, ShellStatusResult>();
  shellIDs.forEach((shellID, index) => {
    const result = results[index];
    if (result?.data) statuses.set(shellID, { ...result.data, refreshFailed: result.isError });
  });
  return statuses;
}

// Removing a shell stops it. Its queries then refetch, so every view reads how it ended.
export function useStopShell() {
  const scope = useContext(SessionShellScope);
  const queryClient = useQueryClient();
  const available = Boolean(scope?.enabled && scope.client);
  const stop = useCallback(
    async (shellID: string) => {
      if (!scope?.client || !scope.enabled) throw new Error("CONNECTION_NOT_READY");
      try {
        await removeOpenCodeShell(scope.client, scope.location, shellID);
      } catch (error) {
        // It ended between the last poll and the stop; refreshing shows how.
        if (!isShellNotFoundError(error)) throw error;
      }
      await queryClient.invalidateQueries({
        queryKey: openCodeQueryKeys.shell(scope.connectionId, scope.location, shellID),
      });
    },
    [queryClient, scope],
  );
  return available ? stop : undefined;
}

// Background shells the server still reports as running, with the server's start time.
export function useRunningShells(messages: SessionMessageInfo[]) {
  const candidates = useMemo(() => shellCandidates(messages), [messages]);
  const statuses = useShellStatuses(candidates.map((candidate) => candidate.shellID));
  return candidates.flatMap((candidate): ShellCandidate[] => {
    const status = statuses.get(candidate.shellID);
    const info = status?.info;
    if (info?.status !== "running") return [];
    return [
      {
        ...candidate,
        ...(status?.refreshFailed ? { lastKnown: true } : {}),
        startedAt: info.time.started,
      },
    ];
  });
}
