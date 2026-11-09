import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

import { iconTilePalette } from "../theme";

export type IconTileTint = keyof typeof iconTilePalette;

// A white glyph on a rounded colored square, like iOS Settings, so each settings row is
// recognizable at a glance.
export function IconTile({
  icon,
  tint,
}: {
  icon: ComponentProps<typeof Feather>["name"];
  tint: IconTileTint;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { backgroundColor: iconTilePalette[tint] }]}
      testID={`icon-tile-${tint}`}
    >
      <Feather color="#ffffff" name={icon} size={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: "center",
    borderRadius: 8,
    flexShrink: 0,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
});
