import Feather from "@expo/vector-icons/Feather";
import { type ComponentProps, useEffect, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { attentionAccessibilityValue } from "../navigation/attention-labels";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import {
  floatingShadow,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  rippleFeedback,
  space,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";

export type WorkspaceTab = "approvals" | "chat" | "pulls";

const tabs: { icon: ComponentProps<typeof Feather>["name"]; label: string; tab: WorkspaceTab }[] = [
  { icon: "message-circle", label: "Chat", tab: "chat" },
  { icon: "git-pull-request", label: "PRs", tab: "pulls" },
  { icon: "check-circle", label: "Approvals", tab: "approvals" },
];
const ripple = rippleFeedback.row;
const borderlessRipple = rippleFeedback.borderless;

// The phone Sessions menu: the three list views, then New session apart on the right.
export function WorkspaceBottomMenu({
  active,
  hidden = false,
  onNewSession,
  onSelect,
}: {
  active: WorkspaceTab;
  hidden?: boolean;
  onNewSession: () => void;
  onSelect: (tab: WorkspaceTab) => void;
}) {
  const selection = useWorkspaceSelection();
  const { fontScale } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    // iOS sends Will events, so the menu hides as the keyboard starts to rise. Android only
    // sends Did events.
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
      setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (hidden || keyboardVisible) return null;
  // Only requests that need the user earn a badge. Coverage still being checked, stale, or
  // incomplete is reported by the Approvals screen and the accessibility value instead.
  const count = selection.pendingCount;

  return (
    <View pointerEvents="box-none" style={styles.dock}>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {tabs.map(({ icon, label, tab }) => {
          const selected = tab === active;
          const approvals = tab === "approvals";
          return (
            <Pressable
              accessibilityLabel={label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityValue={
                approvals
                  ? { text: attentionAccessibilityValue(count, selection.attentionCoverage) }
                  : undefined
              }
              android_ripple={ripple}
              key={tab}
              onPress={() => onSelect(tab)}
              style={({ pressed }) => [
                styles.tab,
                selected && styles.tabSelected,
                pressed && Platform.OS === "ios" && styles.pressed,
              ]}
              testID={`workspace-tab-${tab}`}
            >
              <View>
                <Feather
                  accessible={false}
                  color={selected ? palette.ink : palette.dim}
                  name={icon}
                  size={20}
                />
                {approvals && count > 0 ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.badge}
                    testID="workspace-approvals-badge"
                  >
                    <Text style={styles.badgeLabel}>{count > 99 ? "99+" : count}</Text>
                  </View>
                ) : null}
              </View>
              {/* Large text keeps icons only so the bar fits; the tab name stays accessible. */}
              {largeText ? null : (
                <Text
                  dynamicTypeRamp={typeRamp.caption}
                  numberOfLines={1}
                  style={[styles.tabLabel, selected && styles.tabLabelSelected]}
                >
                  {label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityHint="Choose a project for a new session"
        accessibilityLabel="New session"
        accessibilityRole="button"
        android_ripple={borderlessRipple}
        onPress={() => {
          Keyboard.dismiss();
          onNewSession();
        }}
        style={({ pressed }) => [
          styles.newSession,
          pressed && Platform.OS === "ios" && styles.pressed,
        ]}
      >
        <Feather accessible={false} color={palette.background} name="plus" size={24} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    backgroundColor: palette.warm,
    borderRadius: radius.pill,
    justifyContent: "center",
    minHeight: 16,
    minWidth: 16,
    paddingHorizontal: 4,
    position: "absolute",
    right: -10,
    top: -6,
  },
  badgeLabel: { ...typography.label, color: palette.background, lineHeight: undefined },
  dock: {
    alignItems: "center",
    bottom: space.sm,
    flexDirection: "row",
    gap: space.sm,
    left: space.md,
    position: "absolute",
    right: space.md,
  },
  newSession: {
    alignItems: "center",
    backgroundColor: palette.signal,
    borderRadius: radius.pill,
    ...floatingShadow,
    height: 56,
    justifyContent: "center",
    overflow: "hidden",
    width: 56,
  },
  pressed: { opacity: pressedOpacity },
  tab: {
    alignItems: "center",
    borderRadius: radius.pill,
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: minTouchTarget,
    overflow: "hidden",
    paddingVertical: space.xs,
  },
  tabLabel: { ...typography.caption, color: palette.dim },
  tabLabelSelected: { color: palette.ink },
  tabSelected: { backgroundColor: palette.selected },
  tabs: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    ...floatingShadow,
    flex: 1,
    flexDirection: "row",
    minHeight: 56,
    padding: 4,
  },
});
