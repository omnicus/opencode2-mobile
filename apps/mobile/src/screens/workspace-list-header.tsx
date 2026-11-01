import Feather from "@expo/vector-icons/Feather";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { SearchField } from "../components/search-field";
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
const borderlessRipple =
  Platform.OS === "android" ? { borderless: true, color: "rgba(255,255,255,0.12)" } : undefined;

// The Sessions screen header: the connection name opens Connections, and the search button
// expands a field over the full width until Close search collapses it.
export function WorkspaceListHeader({
  connection,
  connectionName,
  onChangeSearch,
  onCloseSearch,
  onOpenConnections,
  onOpenSearch,
  onSearchBlur,
  onSearchFocus,
  search,
  searchEditable,
  searchOpen,
  topInset,
  trailing,
}: {
  connection: { color: string; label: string };
  connectionName: string | undefined;
  onChangeSearch: (value: string) => void;
  onCloseSearch: () => void;
  onOpenConnections: () => void;
  onOpenSearch: () => void;
  onSearchBlur: () => void;
  onSearchFocus: () => void;
  search: string;
  searchEditable: boolean;
  searchOpen: boolean;
  topInset: number;
  trailing?: ReactNode;
}) {
  const name = connectionName ?? "No server selected";
  return (
    <View style={[styles.header, { paddingTop: topInset }]}>
      {searchOpen ? (
        <View style={styles.bar}>
          <SearchField
            accessibilityLabel="Search sessions"
            autoFocus
            clearAccessibilityLabel="Clear session search"
            editable={searchEditable}
            onBlur={onSearchBlur}
            onChangeText={onChangeSearch}
            onFocus={onSearchFocus}
            placeholder="Search all sessions"
            returnKeyType="search"
            style={styles.searchField}
            value={search}
          />
          <IconButton icon="x" label="Close search" onPress={onCloseSearch} />
        </View>
      ) : (
        <View style={styles.bar}>
          <Pressable
            accessibilityHint="Opens connections"
            accessibilityLabel={`Connection ${name}, ${connection.label.toLocaleLowerCase()}`}
            accessibilityRole="button"
            android_ripple={ripple}
            onPress={onOpenConnections}
            style={({ pressed }) => [
              styles.connection,
              pressed && Platform.OS === "ios" && styles.pressed,
            ]}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.statusDot, { backgroundColor: connection.color }]}
              testID="workspace-connection-status"
            />
            <Text
              dynamicTypeRamp={typeRamp.navTitle}
              ellipsizeMode="tail"
              numberOfLines={1}
              style={styles.connectionName}
            >
              {name}
            </Text>
          </Pressable>
          <IconButton
            disabled={!searchEditable}
            icon="search"
            label="Search sessions"
            onPress={onOpenSearch}
          />
          {trailing}
        </View>
      )}
    </View>
  );
}

function IconButton({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: "search" | "x";
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      android_ripple={borderlessRipple}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        disabled && styles.disabled,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
    >
      <Feather accessible={false} color={palette.ink} name={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.xs,
    minHeight: minTouchTarget,
  },
  connection: {
    alignItems: "center",
    borderRadius: radius.sm,
    flex: 1,
    flexDirection: "row",
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingHorizontal: space.sm,
  },
  connectionName: { ...typography.navTitle, color: palette.ink, flexShrink: 1 },
  disabled: { opacity: disabledOpacity },
  header: {
    backgroundColor: palette.background,
    paddingBottom: space.xs,
    paddingHorizontal: space.xs,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    flexShrink: 0,
    height: minTouchTarget,
    justifyContent: "center",
    overflow: "hidden",
    width: minTouchTarget,
  },
  pressed: { opacity: pressedOpacity },
  searchField: { flex: 1, marginLeft: space.sm },
  statusDot: { borderRadius: 4, height: 8, marginRight: space.sm, width: 8 },
});
