import Feather from "@expo/vector-icons/Feather";
import type { ModelInfo, ModelRef } from "@opencode2-mobile/opencode-adapter";
import { type RefObject, useDeferredValue, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../components/button";
import { ModalSheet } from "../components/modal-sheet";
import { SearchField } from "../components/search-field";
import type { useModelFavorites } from "../state/use-model-favorites";
import { modelIdentityKey } from "../storage/model-favorites-repository";
import {
  disabledOpacity,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
} from "../theme";

const ripple = Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined;

export type FavoriteControls = ReturnType<typeof useModelFavorites>;
export type CatalogState = { loading: boolean; error: boolean; retry: () => void };

export function ModelPicker({
  models,
  model,
  favorites,
  state,
  onSelect,
  onClose,
  visible,
  returnFocusRef,
}: {
  models: ModelInfo[];
  model: ModelRef | undefined;
  favorites: FavoriteControls | undefined;
  state: CatalogState | undefined;
  onSelect: (model: ModelRef) => void;
  onClose: () => void;
  visible: boolean;
  returnFocusRef?: RefObject<View | null>;
}) {
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const favoritesByID = new Map(
    favorites?.models.map((item, index) => [modelIdentityKey(item), index]),
  );
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
  const nameKey = (item: ModelInfo) => JSON.stringify([item.providerID, item.name]);
  for (const item of models)
    nameCounts.set(nameKey(item), (nameCounts.get(nameKey(item)) ?? 0) + 1);
  const providers = new Map<string, ModelInfo[]>();
  for (const item of matching) {
    if (favoritesByID.has(modelIdentityKey(item))) continue;
    const rows = providers.get(item.providerID) ?? [];
    rows.push(item);
    providers.set(item.providerID, rows);
  }
  const sections = [
    ...(favoriteRows.length ? [{ title: "Favorites", key: "favorites", data: favoriteRows }] : []),
    ...[...providers]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, data]) => ({
        title: provider,
        key: `provider:${provider}`,
        data: data.sort((a, b) => a.name.localeCompare(b.name)),
      })),
  ];
  const close = () => {
    setSearch("");
    onClose();
  };
  return (
    <ModalSheet
      title="Choose model"
      visible={visible}
      onClose={close}
      scrollable={false}
      size="full"
      returnFocusRef={returnFocusRef}
    >
      <SearchField
        clearAccessibilityLabel="Clear model search"
        onChangeText={setSearch}
        placeholder="Search models"
        returnKeyType="search"
        value={search}
      />
      {state?.error ? (
        <PickerNotice text="Models could not be loaded." retry={state.retry} />
      ) : null}
      {favorites?.error ? (
        <PickerNotice
          text="Model favorites could not be saved or loaded."
          retry={favorites.retry}
        />
      ) : null}
      <SectionList
        accessibilityLabel="Model results"
        sections={sections}
        keyExtractor={modelIdentityKey}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        style={styles.list}
        ListEmptyComponent={
          state?.loading ? (
            <ActivityIndicator accessibilityLabel="Loading models" color={palette.signal} />
          ) : !state?.error ? (
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.empty}>
              {search.trim() ? "No matching models" : "No enabled models"}
            </Text>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text
            accessibilityRole="header"
            dynamicTypeRamp={typeRamp.sectionLabel}
            style={styles.section}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const favorite = favoritesByID.has(modelIdentityKey(item));
          const selected = item.id === model?.id && item.providerID === model.providerID;
          const ambiguous = (nameCounts.get(nameKey(item)) ?? 0) > 1;
          return (
            <View style={[styles.row, selected && styles.selectedRow]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.providerID}${ambiguous ? `, ${item.id}` : ""}`}
                accessibilityState={{ selected }}
                android_ripple={ripple}
                onPress={() => {
                  onSelect({ id: item.id, providerID: item.providerID });
                  close();
                }}
                style={({ pressed }) => [
                  styles.choice,
                  pressed && Platform.OS === "ios" && styles.pressed,
                ]}
              >
                <View style={styles.copy}>
                  <Text dynamicTypeRamp={typeRamp.body} style={styles.label}>
                    {item.name}
                  </Text>
                  <Text dynamicTypeRamp={typeRamp.footnote} style={styles.provider}>
                    {item.providerID}
                    {ambiguous ? ` · ${item.id}` : ""}
                  </Text>
                </View>
                {selected ? (
                  <Feather accessible={false} name="check" size={20} color={palette.signal} />
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={`${favorite ? "Remove" : "Add"} ${item.name}${ambiguous ? `, ${item.providerID}, ${item.id}` : ""} ${favorite ? "from" : "to"} favorites`}
                accessibilityState={{
                  checked: favorite,
                  disabled: !favorites || favorites.disabled,
                }}
                android_ripple={
                  Platform.OS === "android"
                    ? { color: "rgba(255,255,255,0.12)", borderless: true }
                    : undefined
                }
                disabled={!favorites || favorites.disabled}
                onPress={() => favorites?.toggle(item, !favorite)}
                style={({ pressed }) => [
                  styles.star,
                  pressed && Platform.OS === "ios" && styles.pressed,
                  (!favorites || favorites.disabled) && styles.disabled,
                ]}
              >
                <Feather
                  accessible={false}
                  name="star"
                  size={20}
                  color={favorite ? palette.ink : palette.dim}
                />
              </Pressable>
            </View>
          );
        }}
      />
    </ModalSheet>
  );
}

export function PickerNotice({ text, retry }: { text: string; retry: () => void }) {
  return (
    <View style={styles.notice}>
      <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.footnote} style={styles.provider}>
        {text}
      </Text>
      <Button label="Retry" onPress={retry} variant="text" />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  section: { ...typography.sectionLabel, color: palette.dim, paddingVertical: space.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    overflow: "hidden",
    paddingHorizontal: space.sm,
  },
  choice: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: minTouchTarget,
    paddingVertical: space.sm,
    paddingRight: space.sm,
    gap: space.sm,
  },
  copy: { flex: 1, minWidth: 0 },
  selectedRow: { backgroundColor: palette.prompt },
  label: { ...typography.body, color: palette.ink },
  provider: { ...typography.footnote, color: palette.dim, marginTop: 2 },
  star: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: pressedOpacity },
  disabled: { opacity: disabledOpacity },
  empty: { ...typography.subheadline, color: palette.dim, paddingVertical: space.lg },
  notice: { gap: space.xs },
});
