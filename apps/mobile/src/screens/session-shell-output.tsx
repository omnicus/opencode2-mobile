import {
  getOpenCodeShell,
  getOpenCodeShellOutput,
  isShellNotFoundError,
  type LocationRef,
  maxShellOutputBytes,
  type OpenCodeClient,
} from "@opencode2-mobile/opencode-adapter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";

import { openCodeQueryKeys } from "../state/open-code-query-keys";
import {
  boundShellOutput,
  missingShellSnapshot,
  type ShellSnapshot,
  shellObservationStatus,
  shellRefetchInterval,
} from "./session-shell-output-model";

type ShellScope = {
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
  const snapshot = scope.enabled ? query.data : undefined;
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
