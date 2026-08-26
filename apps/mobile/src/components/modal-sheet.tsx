import { type ReactNode, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { palette, space, typeRamp, usesLargeTextLayout } from "../theme";

export function ModalSheet({
  children,
  onClose,
  scrollable = true,
  subtitle,
  title,
  visible,
}: {
  children: ReactNode;
  onClose: () => void;
  scrollable?: boolean;
  subtitle?: string;
  title: string;
  visible: boolean;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const { fontScale } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReducedMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return (
    <Modal
      animationType={reducedMotion ? "none" : "slide"}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardView}
        >
          <View style={[styles.header, largeText && styles.headerLargeText]}>
            <View style={[styles.heading, largeText && styles.headingLargeText]}>
              <Text
                accessibilityRole="header"
                dynamicTypeRamp={typeRamp.subheading}
                style={styles.title}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text dynamicTypeRamp={typeRamp.control} style={styles.subtitle}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel={`Close ${title}`}
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Text dynamicTypeRamp={typeRamp.control} style={styles.closeLabel}>
                Done
              </Text>
            </Pressable>
          </View>
          {scrollable ? (
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.fixedContent}>{children}</View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  closeButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: space.sm },
  closeLabel: { color: palette.signal, fontSize: 16, fontWeight: "700" },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xl },
  fixedContent: { flex: 1, gap: space.md, padding: space.lg, paddingBottom: space.xl },
  header: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: space.md,
  },
  headerLargeText: { alignItems: "flex-start", flexDirection: "column", paddingVertical: space.sm },
  heading: { flex: 1, minWidth: 0 },
  headingLargeText: { flex: 0, width: "100%" },
  keyboardView: { flex: 1 },
  pressed: { opacity: 0.55 },
  safeArea: { backgroundColor: palette.background, flex: 1 },
  subtitle: { color: palette.dim, fontSize: 12, marginTop: 2 },
  title: { color: palette.ink, fontSize: 20, fontWeight: "700" },
});
