import { expect, test } from "@jest/globals";
import type { ModelInfo } from "@opencode2-mobile/opencode-adapter";

import {
  favoriteToggleLabel,
  isSelectedModel,
  modelChoiceLabel,
  modelPickerCatalog,
} from "./model-picker-model";

function model(providerID: string, id: string, name: string) {
  return {
    id,
    name,
    providerID,
    variants: [],
    enabled: true,
    status: "active",
  } as unknown as ModelInfo;
}

const models = [
  model("zeta", "z1", "Zed"),
  model("alpha", "a2", "Beta"),
  model("alpha", "a1", "Able"),
  model("mid", "m1", "Middle"),
  model("mid", "m2", "Most"),
];

test("orders favorites by saved position, then providers and names alphabetically", () => {
  const { sections } = modelPickerCatalog(
    models,
    [
      { providerID: "mid", id: "m2" },
      { providerID: "missing", id: "gone" },
      { providerID: "zeta", id: "z1" },
    ],
    "",
  );
  expect(sections.map((section) => [section.key, section.data.map((item) => item.id)])).toEqual([
    ["favorites", ["m2", "z1"]],
    ["provider:alpha", ["a1", "a2"]],
    ["provider:mid", ["m1"]],
  ]);
  expect(sections[0]?.title).toBe("Favorites");
  expect(sections[1]?.title).toBe("alpha");
});

test("matches a lower-case query against name, provider and model ID", () => {
  expect(
    modelPickerCatalog(models, undefined, "mid").sections.flatMap((section) =>
      section.data.map((item) => item.id),
    ),
  ).toEqual(["m1", "m2"]);
  expect(modelPickerCatalog(models, undefined, "a2").sections[0]?.data).toEqual([models[1]]);
  expect(modelPickerCatalog(models, undefined, "able").sections[0]?.data).toEqual([models[2]]);
  expect(modelPickerCatalog(models, undefined, "nothing").sections).toEqual([]);
});

test("flags duplicate names within a provider across the whole catalog", () => {
  const duplicates = [
    model("p", "one", "Same"),
    model("p", "two", "Same"),
    model("q", "x", "Same"),
  ];
  const catalog = modelPickerCatalog(duplicates, [{ providerID: "q", id: "x" }], "two");
  expect(catalog.isAmbiguous(duplicates[0] as ModelInfo)).toBe(true);
  expect(catalog.isAmbiguous(duplicates[2] as ModelInfo)).toBe(false);
  expect(catalog.isAmbiguous(model("r", "new", "Unlisted"))).toBe(false);
  expect(catalog.isFavorite(duplicates[2] as ModelInfo)).toBe(true);
  expect(catalog.isFavorite(duplicates[0] as ModelInfo)).toBe(false);
});

test("selection requires both provider and model ID", () => {
  const item = model("p", "one", "One");
  expect(isSelectedModel(item, { providerID: "p", id: "one" })).toBe(true);
  expect(isSelectedModel(item, { providerID: "q", id: "one" })).toBe(false);
  expect(isSelectedModel(item, { providerID: "p", id: "two" })).toBe(false);
  expect(isSelectedModel(item, undefined)).toBe(false);
});

test("labels include the provider and ID only when needed", () => {
  const item = model("p", "one", "One");
  expect(modelChoiceLabel(item, false)).toBe("One, p");
  expect(modelChoiceLabel(item, true)).toBe("One, p, one");
  expect(favoriteToggleLabel(item, false, false)).toBe("Add One to favorites");
  expect(favoriteToggleLabel(item, true, true)).toBe("Remove One, p, one from favorites");
});
