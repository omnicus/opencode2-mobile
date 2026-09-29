import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
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
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { palette, space, typeRamp, typography, usesLargeTextLayout } from "../theme";

export function ModalSheet({
  children,
  onClose,
  scrollable = true,
  subtitle,
  title,
  visible,
  size = "page",
  returnFocusRef,
}: {
  children: ReactNode;
  onClose: () => void;
  scrollable?: boolean;
  subtitle?: string;
  title: string;
  visible: boolean;
  size?: "page" | "full" | "compact";
  returnFocusRef?: RefObject<View | null> | undefined;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const { fontScale, width } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const compact = size === "compact" && !largeText;
  const overlay = compact || (size !== "page" && width >= 700);
  const headingRef = useRef<Text>(null);
  const wasVisible = useRef(visible);
  const restoreFocus = () => {
    if (!returnFocusRef?.current) return;
    const handle = findNodeHandle(returnFocusRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  };
  useEffect(() => {
    const closed = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (!closed || Platform.OS === "ios" || !returnFocusRef) return;
    const frame = requestAnimationFrame(() => {
      const handle = returnFocusRef.current ? findNodeHandle(returnFocusRef.current) : null;
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, returnFocusRef]);

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
      onDismiss={restoreFocus}
      onShow={() => {
        const handle = findNodeHandle(headingRef.current);
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      }}
      presentationStyle={overlay ? "overFullScreen" : size === "page" ? "pageSheet" : "fullScreen"}
      transparent={overlay}
      visible={visible}
    >
      {/* Native modals need safe-area measurements from their own presentation root. */}
      <SafeAreaProvider
        style={[styles.frame, overlay && styles.overlay, compact && width < 700 && styles.bottom]}
      >
        <SafeAreaView
          edges={["top", "bottom"]}
          style={[styles.safeArea, overlay && styles.panel, compact && styles.compactPanel]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.keyboardView, compact && styles.compactKeyboardView]}
          >
            <View style={[styles.header, largeText && styles.headerLargeText]}>
              <View style={[styles.heading, largeText && styles.headingLargeText]}>
                <Text
                  accessibilityRole="header"
                  ref={headingRef}
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
                style={compact && styles.compactScroll}
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
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  overlay: { backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  bottom: { justifyContent: "flex-end" },
  panel: { width: "100%", maxWidth: 640, maxHeight: "90%", borderRadius: 18, overflow: "hidden" },
  compactPanel: { flex: 0, flexShrink: 1 },
  compactKeyboardView: { flex: 0, flexShrink: 1 },
  compactScroll: { flexGrow: 0, flexShrink: 1 },
  closeButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: space.sm },
  closeLabel: { ...typography.control, color: palette.signal },
  content: { gap: space.md, padding: space.md, paddingBottom: space.xl },
  fixedContent: { flex: 1, gap: space.md, padding: space.md, paddingBottom: space.xl },
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
  subtitle: { ...typography.caption, color: palette.dim, marginTop: 2 },
  title: { ...typography.sheetTitle, color: palette.ink },
});
