import { getOpenCodeVcs, type ProjectListOutput } from "@opencode2-mobile/opencode-adapter";
import { useQueries } from "@tanstack/react-query";

import { useConnectionRuntime } from "../state/connection-runtime-context";
import {
  type FollowedInboxRow,
  locationKey,
  uniqueLocations,
} from "../state/followed-project-inbox";
import { openCodeQueryKeys } from "../state/open-code-query-keys";

// Git info is not stored on the session, so load the branch for each location the rows show.
// Reading VCS initializes a location on the server, so only a project's checkout and its current
// worktrees are read. A retired worktree directory shows its name without a branch.
export function useInboxBranches(rows: readonly FollowedInboxRow[], projects: ProjectListOutput) {
  const runtime = useConnectionRuntime();
  const connectionId = runtime.connectionId;
  const client = runtime.restClient;
  const liveDirectories = new Set(
    projects.flatMap((project) => [project.canonical, ...project.sandboxes]),
  );
  const locations = uniqueLocations(
    rows
      .map((row) => row.session.location)
      .filter((location) => liveDirectories.has(location.directory)),
  );
  const queries = useQueries({
    queries: locations.map((location) => ({
      enabled: Boolean(client && connectionId),
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (!client) throw new Error("CONNECTION_NOT_READY");
        return getOpenCodeVcs(client, location, { signal });
      },
      queryKey: openCodeQueryKeys.vcs(connectionId ?? "unselected", location),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const branches = new Map<string, string>();
  for (const [index, location] of locations.entries()) {
    const branch = queries[index]?.data?.data.branch.current;
    if (branch) branches.set(locationKey(location), branch);
  }
  return branches;
}
