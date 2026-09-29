import {
  getOpenCodeShell,
  getOpenCodeShellOutput,
  isShellNotFoundError,
  type LocationRef,
  maxShellOutputBytes,
  type OpenCodeClient,
  type ShellGetOutput,
} from "@opencode2-mobile/opencode-adapter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";

import { openCodeQueryKeys } from "../state/open-code-query-keys";

type ShellScope = {
  client: OpenCodeClient | undefined;
  connectionId: string;
  enabled: boolean;
  location: LocationRef;
};

export const SessionShellScope = createContext<ShellScope | undefined>(undefined);

type ShellSnapshot = {
  cursor: number;
  output: string;
  truncated: boolean;
  missing: boolean;
  info?: ShellGetOutput["data"];
};

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
    refetchInterval: (query) => {
      const snapshot = query.state.data;
      return query.state.status === "error" ||
        snapshot?.missing ||
        (snapshot?.info && snapshot.info.status !== "running")
        ? false
        : 1_000;
    },
    queryFn: async ({ signal }): Promise<ShellSnapshot> => {
      if (!scope.client || !scope.enabled) throw new Error("CONNECTION_NOT_READY");
      const previous = queryClient.getQueryData<ShellSnapshot>(queryKey);
      try {
        const { data: info } = await getOpenCodeShell(scope.client, scope.location, shellID, {
          signal,
        });
        let { data: page } = await getOpenCodeShellOutput(scope.client, scope.location, shellID, {
          cursor: previous?.cursor ?? 0,
          signal,
        });
        let output = (previous?.output ?? "") + page.output;
        let truncated =
          previous?.truncated || page.truncated || output.length > maxShellOutputBytes;
        // Catch up to the latest bounded tail in at most one extra request,
        // including after reconnection or opening a long-finished command.
        if (page.cursor < page.size || page.cursor < (previous?.cursor ?? 0)) {
          const cursor = Math.max(0, page.size - maxShellOutputBytes);
          ({ data: page } = await getOpenCodeShellOutput(scope.client, scope.location, shellID, {
            cursor,
            signal,
          }));
          output = page.output;
          truncated = cursor > 0 || page.truncated;
        }
        const bytes = new TextEncoder().encode(output);
        if (bytes.length > maxShellOutputBytes) {
          let start = bytes.length - maxShellOutputBytes;
          while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
          output = new TextDecoder().decode(bytes.slice(start));
          truncated = true;
        }
        return { info, cursor: page.cursor, output, truncated: Boolean(truncated), missing: false };
      } catch (error) {
        if (!isShellNotFoundError(error)) throw error;
        return {
          cursor: previous?.cursor ?? 0,
          output: previous?.output ?? "",
          truncated: previous?.truncated ?? false,
          missing: true,
        };
      }
    },
  });
  return children({
    snapshot: scope.enabled ? query.data : undefined,
    error: query.isError,
    statusLabel: shellObservationStatus(scope.enabled ? query.data : undefined, query.isError),
    retry: () => {
      if (scope.enabled) void query.refetch();
    },
  });
}

function shellObservationStatus(snapshot: ShellSnapshot | undefined, error: boolean) {
  if (error) return "Shell output could not be refreshed.";
  if (snapshot?.missing) return "Shell output is no longer available on the server.";
  if (!snapshot?.info) return "Loading shell output…";
  switch (snapshot.info.status) {
    case "running":
      return "Running";
    case "timeout":
      return "Timed out";
    case "killed":
      return "Stopped";
    case "exited":
      return `Exited${snapshot.info.exit === undefined ? "" : ` · ${snapshot.info.exit}`}`;
  }
}
