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

import {
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
import { type ModalSheetSize, modalSheetLayout } from "./modal-sheet-model";

export function ModalSheet({
  children,
  onClose,
  scrollable = true,
  subtitle,
  title,
  visible,
  size = "page",
  returnFocusRef,
  closeLabel = "Done",
}: {
  children: ReactNode;
  onClose: () => void;
  scrollable?: boolean;
  subtitle?: string;
  title: string;
  visible: boolean;
  size?: ModalSheetSize;
  returnFocusRef?: RefObject<View | null> | undefined;
  closeLabel?: string;
}) {
  const { fontScale, width } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const { bottom, compact, overlay, presentationStyle } = modalSheetLayout(size, largeText, width);
  const headingRef = useRef<Text>(null);
  useReturnFocusAfterClose(visible, returnFocusRef);
  const reducedMotion = useReducedMotion();

  return (
    <Modal
      animationType={reducedMotion ? "none" : "slide"}
      onRequestClose={onClose}
      onDismiss={() => focusAccessibility(returnFocusRef?.current)}
      onShow={() => focusAccessibility(headingRef.current)}
      presentationStyle={presentationStyle}
      transparent={overlay}
      visible={visible}
    >
      {/* Native modals need safe-area measurements from their own presentation root. */}
      <SafeAreaProvider style={[styles.frame, overlay && styles.overlay, bottom && styles.bottom]}>
        {compact ? (
          <Pressable
            accessible={false}
            importantForAccessibility="no"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
            testID="modal-sheet-backdrop"
          />
        ) : null}
        <SafeAreaView
          edges={["top", "bottom"]}
          style={[styles.safeArea, overlay && styles.panel, compact && styles.compactPanel]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.keyboardView, compact && styles.compactKeyboardView]}
          >
            <ModalSheetHeader
              closeLabel={closeLabel}
              headingRef={headingRef}
              largeText={largeText}
              onClose={onClose}
              subtitle={subtitle}
              title={title}
            />
            <ModalSheetBody compact={compact} scrollable={scrollable}>
              {children}
            </ModalSheetBody>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function focusAccessibility(target: Text | View | null | undefined) {
  const handle = target ? findNodeHandle(target) : null;
  if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
}

function useReturnFocusAfterClose(
  visible: boolean,
  returnFocusRef: RefObject<View | null> | undefined,
) {
  const wasVisible = useRef(visible);
  useEffect(() => {
    const closed = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (!closed || Platform.OS === "ios" || !returnFocusRef) return;
    const frame = requestAnimationFrame(() => focusAccessibility(returnFocusRef.current));
    return () => cancelAnimationFrame(frame);
  }, [visible, returnFocusRef]);
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);
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
  return reducedMotion;
}

function ModalSheetHeader({
  closeLabel,
  headingRef,
  largeText,
  onClose,
  subtitle,
  title,
}: {
  closeLabel: string;
  headingRef: RefObject<Text | null>;
  largeText: boolean;
  onClose: () => void;
  subtitle: string | undefined;
  title: string;
}) {
  return (
    <View style={[styles.header, largeText && styles.headerLargeText]}>
      <View style={[styles.heading, largeText && styles.headingLargeText]}>
        <Text
          accessibilityRole="header"
          ref={headingRef}
          dynamicTypeRamp={typeRamp.navTitle}
          style={styles.title}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text dynamicTypeRamp={typeRamp.footnote} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityLabel={`Close ${title}`}
        accessibilityRole="button"
        android_ripple={rippleFeedback.borderless}
        onPress={onClose}
        style={({ pressed }) => [
          styles.closeButton,
          pressed && Platform.OS === "ios" && styles.pressed,
        ]}
      >
        <Text dynamicTypeRamp={typeRamp.navTitle} style={styles.closeLabel}>
          {closeLabel}
        </Text>
      </Pressable>
    </View>
  );
}

function ModalSheetBody({
  children,
  compact,
  scrollable,
}: {
  children: ReactNode;
  compact: boolean;
  scrollable: boolean;
}) {
  if (!scrollable) return <View style={styles.fixedContent}>{children}</View>;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={compact && styles.compactScroll}
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  overlay: { backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  bottom: { justifyContent: "flex-end" },
  panel: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "90%",
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  compactPanel: { flex: 0, flexShrink: 1 },
  compactKeyboardView: { flex: 0, flexShrink: 1 },
  compactScroll: { flexGrow: 0, flexShrink: 1 },
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: space.sm,
  },
  closeLabel: { ...typography.navTitle, color: palette.signal },
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
  pressed: { opacity: pressedOpacity },
  safeArea: { backgroundColor: palette.background, flex: 1 },
  subtitle: { ...typography.footnote, color: palette.dim, marginTop: 2 },
  title: { ...typography.navTitle, color: palette.ink },
});
