import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import {
  defaultPullRequestFilter,
  type PullRequestFilter,
  readPullRequestFilter,
  writePullRequestFilter,
} from "../storage/pull-request-filter-repository";

const filterKey = (connectionID: string | undefined, updatedAt: number | undefined) =>
  ["device-pull-request-filter", connectionID, updatedAt] as const;

export function usePullRequestFilter(
  connectionID: string | undefined,
  updatedAt: number | undefined,
) {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: filterKey(connectionID, updatedAt),
    enabled: Boolean(connectionID && updatedAt !== undefined),
    queryFn: () => readPullRequestFilter(db, connectionID as string),
  });
  const mutation = useMutation({
    mutationFn: (input: { connectionID: string; filter: PullRequestFilter; updatedAt: number }) =>
      writePullRequestFilter(db, input.connectionID, input.updatedAt, input.filter),
    // The chips change at once; a failed save puts the stored filter back.
    onMutate: (input) => {
      const key = filterKey(input.connectionID, input.updatedAt);
      const previous = queryClient.getQueryData<PullRequestFilter>(key);
      queryClient.setQueryData(key, input.filter);
      return { key, previous };
    },
    onError: (_error, _input, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous);
    },
  });
  const scopedMutation =
    mutation.variables?.connectionID === connectionID &&
    mutation.variables?.updatedAt === updatedAt;
  return {
    error: scopedMutation && mutation.isError,
    filter: query.data ?? defaultPullRequestFilter,
    loaded: query.isSuccess || query.isError,
    setFilter: (filter: PullRequestFilter) => {
      if (!connectionID || updatedAt === undefined || !query.isSuccess) return;
      mutation.mutate({ connectionID, filter, updatedAt });
    },
  };
}
