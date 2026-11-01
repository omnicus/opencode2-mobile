import type { ModelInfo, ModelRef } from "@opencode2-mobile/opencode-adapter";

import { modelIdentityKey } from "../storage/model-favorites-repository";

export type ModelPickerSection = { title: string; key: string; data: ModelInfo[] };

function nameKey(item: ModelInfo) {
  return JSON.stringify([item.providerID, item.name]);
}

function favoriteOrder(favorites: ModelRef[] | undefined) {
  return new Map(favorites?.map((item, index) => [modelIdentityKey(item), index]));
}

export function modelPickerCatalog(
  models: ModelInfo[],
  favorites: ModelRef[] | undefined,
  query: string,
) {
  const favoritesByID = favoriteOrder(favorites);
  const matching = models.filter((item) =>
    `${item.name}\n${item.providerID}\n${item.id}`.toLocaleLowerCase().includes(query),
  );
  const favoriteRows = matching
    .filter((item) => favoritesByID.has(modelIdentityKey(item)))
    .sort(
      (a, b) =>
        (favoritesByID.get(modelIdentityKey(a)) ?? 0) -
        (favoritesByID.get(modelIdentityKey(b)) ?? 0),
    );
  const nameCounts = new Map<string, number>();
  for (const item of models)
    nameCounts.set(nameKey(item), (nameCounts.get(nameKey(item)) ?? 0) + 1);
  const providers = new Map<string, ModelInfo[]>();
  for (const item of matching) {
    if (favoritesByID.has(modelIdentityKey(item))) continue;
    const rows = providers.get(item.providerID) ?? [];
    rows.push(item);
    providers.set(item.providerID, rows);
  }
  const sections: ModelPickerSection[] = [
    ...(favoriteRows.length ? [{ title: "Favorites", key: "favorites", data: favoriteRows }] : []),
    ...[...providers]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, data]) => ({
        title: provider,
        key: `provider:${provider}`,
        data: data.sort((a, b) => a.name.localeCompare(b.name)),
      })),
  ];
  return {
    sections,
    isFavorite: (item: ModelInfo) => favoritesByID.has(modelIdentityKey(item)),
    isAmbiguous: (item: ModelInfo) => (nameCounts.get(nameKey(item)) ?? 0) > 1,
  };
}

export function isSelectedModel(item: ModelInfo, model: ModelRef | undefined) {
  return item.id === model?.id && item.providerID === model.providerID;
}

export function modelChoiceLabel(item: ModelInfo, ambiguous: boolean) {
  return `${item.name}, ${item.providerID}${ambiguous ? `, ${item.id}` : ""}`;
}

export function favoriteToggleLabel(item: ModelInfo, favorite: boolean, ambiguous: boolean) {
  return `${favorite ? "Remove" : "Add"} ${item.name}${ambiguous ? `, ${item.providerID}, ${item.id}` : ""} ${favorite ? "from" : "to"} favorites`;
}
