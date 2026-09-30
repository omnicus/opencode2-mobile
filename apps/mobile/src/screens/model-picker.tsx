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
  TextInput,
  View,
} from "react-native";
import { ModalSheet } from "../components/modal-sheet";
import type { useModelFavorites } from "../state/use-model-favorites";
import { modelIdentityKey } from "../storage/model-favorites-repository";
import { palette, radius, space, typography } from "../theme";

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
      <TextInput
        accessibilityLabel="Search models"
        placeholder="Search models"
        placeholderTextColor={palette.dim}
        keyboardAppearance="dark"
        autoCapitalize="none"
        autoCorrect={false}
        value={search}
        onChangeText={setSearch}
        style={styles.search}
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
            <Text style={styles.empty}>
              {search.trim() ? "No matching models" : "No enabled models"}
            </Text>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={styles.section}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const favorite = favoritesByID.has(modelIdentityKey(item));
          const selected = item.id === model?.id && item.providerID === model.providerID;
          return (
            <View style={[styles.row, selected && styles.selectedRow]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.providerID}`}
                accessibilityState={{ selected }}
                onPress={() => {
                  onSelect({ id: item.id, providerID: item.providerID });
                  close();
                }}
                style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
              >
                <View style={styles.copy}>
                  <Text style={styles.label}>{item.name}</Text>
                  <Text style={styles.provider}>{item.providerID}</Text>
                </View>
                {selected ? (
                  <Feather accessible={false} name="check" size={20} color={palette.signal} />
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={`${favorite ? "Remove" : "Add"} ${item.name} ${favorite ? "from" : "to"} favorites`}
                accessibilityState={{
                  checked: favorite,
                  disabled: !favorites || favorites.disabled,
                }}
                disabled={!favorites || favorites.disabled}
                onPress={() => favorites?.toggle(item, !favorite)}
                style={({ pressed }) => [styles.star, pressed && styles.pressed]}
              >
                <Text accessible={false} style={[styles.starText, favorite && styles.favorite]}>
                  {favorite ? "★" : "☆"}
                </Text>
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
      <Text accessibilityRole="alert" style={styles.provider}>
        {text}
      </Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.retry}>
        <Text style={styles.label}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    ...typography.body,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.sm,
    color: palette.ink,
    minHeight: 48,
    paddingHorizontal: space.md,
  },
  list: { flex: 1 },
  section: { ...typography.label, color: palette.dim, paddingVertical: space.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
  },
  choice: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    paddingVertical: space.sm,
    paddingRight: space.sm,
    gap: space.sm,
  },
  copy: { flex: 1, minWidth: 0 },
  selectedRow: { backgroundColor: palette.raised },
  label: { ...typography.body, color: palette.ink },
  provider: { ...typography.caption, color: palette.dim, marginTop: 3 },
  star: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  starText: { fontSize: 26, color: palette.dim },
  favorite: { color: palette.ink },
  pressed: { opacity: 0.6 },
  empty: { ...typography.body, color: palette.dim, paddingVertical: space.lg },
  notice: { gap: space.xs },
  retry: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingRight: space.md,
  },
});
