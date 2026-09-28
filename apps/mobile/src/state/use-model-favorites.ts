import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import {
  type ModelIdentity,
  readModelFavorites,
  setModelFavorite,
} from "../storage/model-favorites-repository";

const favoriteKey = (connectionID: string | undefined, updatedAt: number | undefined) =>
  ["device-model-favorites", connectionID, updatedAt] as const;

export function useModelFavorites(connectionID: string | undefined, updatedAt: number | undefined) {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: favoriteKey(connectionID, updatedAt),
    enabled: Boolean(connectionID && updatedAt !== undefined),
    queryFn: () => readModelFavorites(db, connectionID as string),
  });
  const mutation = useMutation({
    mutationFn: (input: {
      connectionID: string;
      updatedAt: number;
      model: ModelIdentity;
      favorite: boolean;
    }) => setModelFavorite(db, input.connectionID, input.updatedAt, input.model, input.favorite),
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: favoriteKey(input.connectionID, input.updatedAt) }),
  });
  const scopedMutation =
    mutation.variables?.connectionID === connectionID &&
    mutation.variables?.updatedAt === updatedAt;
  return {
    models: query.data ?? [],
    disabled: !query.isSuccess || mutation.isPending || !connectionID || updatedAt === undefined,
    error: query.isError || (scopedMutation && mutation.isError),
    retry: () => {
      mutation.reset();
      void query.refetch();
    },
    toggle: (model: ModelIdentity, favorite: boolean) => {
      if (!connectionID || updatedAt === undefined || !query.isSuccess || mutation.isPending)
        return;
      mutation.mutate({ connectionID, updatedAt, model, favorite });
    },
  };
}
