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
  rippleFeedback,
  space,
  typeRamp,
  typography,
} from "../theme";
import {
  favoriteToggleLabel,
  isSelectedModel,
  modelChoiceLabel,
  modelPickerCatalog,
} from "./model-picker-model";

const ripple = rippleFeedback.row;
const starRipple = rippleFeedback.borderless;

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
  const { isAmbiguous, isFavorite, sections } = modelPickerCatalog(
    models,
    favorites?.models,
    query,
  );
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
        ListEmptyComponent={emptyModelResults(state, Boolean(search.trim()))}
        renderSectionHeader={({ section }) => (
          <Text
            accessibilityRole="header"
            dynamicTypeRamp={typeRamp.sectionLabel}
            style={styles.section}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <ModelPickerRow
            ambiguous={isAmbiguous(item)}
            favorite={isFavorite(item)}
            favorites={favorites}
            item={item}
            onChoose={() => {
              onSelect({ id: item.id, providerID: item.providerID });
              close();
            }}
            selected={isSelectedModel(item, model)}
          />
        )}
      />
    </ModalSheet>
  );
}

// A plain element, not a component, because the list clones it with layout props.
function emptyModelResults(state: CatalogState | undefined, searching: boolean) {
  if (state?.loading) {
    return <ActivityIndicator accessibilityLabel="Loading models" color={palette.signal} />;
  }
  if (state?.error) return null;
  return (
    <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.empty}>
      {searching ? "No matching models" : "No enabled models"}
    </Text>
  );
}

function ModelPickerRow({
  ambiguous,
  favorite,
  favorites,
  item,
  onChoose,
  selected,
}: {
  ambiguous: boolean;
  favorite: boolean;
  favorites: FavoriteControls | undefined;
  item: ModelInfo;
  onChoose: () => void;
  selected: boolean;
}) {
  const favoriteDisabled = !favorites || favorites.disabled;
  return (
    <View style={[styles.row, selected && styles.selectedRow]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={modelChoiceLabel(item, ambiguous)}
        accessibilityState={{ selected }}
        android_ripple={ripple}
        onPress={onChoose}
        style={({ pressed }) => [styles.choice, pressed && Platform.OS === "ios" && styles.pressed]}
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
        accessibilityLabel={favoriteToggleLabel(item, favorite, ambiguous)}
        accessibilityState={{ checked: favorite, disabled: favoriteDisabled }}
        android_ripple={starRipple}
        disabled={favoriteDisabled}
        onPress={() => favorites?.toggle(item, !favorite)}
        style={({ pressed }) => [
          styles.star,
          pressed && Platform.OS === "ios" && styles.pressed,
          favoriteDisabled && styles.disabled,
        ]}
      >
        <Feather
          accessible={false}
          name="star"
          size={20}
          color={favorite ? palette.warm : palette.dim}
        />
      </Pressable>
    </View>
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
  selectedRow: { backgroundColor: palette.selected },
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
