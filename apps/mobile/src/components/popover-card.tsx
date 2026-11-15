import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  type Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { floatingShadow, palette, radius, space } from "../theme";
import { focusAccessibility, useReturnFocusAfterClose } from "./modal-sheet";

// Matches the sheet's readable width on tablets.
const maxCardWidth = 640;

// A card that opens from a control near the bottom of the screen and covers it, with the
// screen dimmed behind. Tapping outside, Android back, or the iOS escape gesture closes it.
// Lighter than a sheet for a short list the reader glances at and leaves.
export function PopoverCard({
  anchorRef,
  children,
  fill = false,
  initialFocusRef,
  label,
  onClose,
  onRequestClose,
  placement = "cover",
  returnFocusRef,
  scrollable = true,
  visible,
}: {
  // The control the card opens from. "cover" pins the card's bottom edge to the control's
  // bottom edge, over it; "above" opens just above it, leaving the control in view.
  anchorRef: RefObject<View | null>;
  placement?: "cover" | "above";
  children: ReactNode;
  // Use the full available height, for content that sizes itself to its container.
  fill?: boolean;
  initialFocusRef?: RefObject<Text | View | null> | undefined;
  label: string;
  onClose: () => void;
  // Android back and the iOS escape gesture. Defaults to onClose; an inner page passes Back.
  onRequestClose?: (() => void) | undefined;
  returnFocusRef: RefObject<View | null>;
  scrollable?: boolean;
  visible: boolean;
}) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { anchor, measure } = useAnchorFrame(anchorRef, visible, width, height);
  const cardRef = useRef<View>(null);
  // iOS returns focus in onDismiss; Android has no dismiss event, so it returns on close.
  useReturnFocusAfterClose(visible, returnFocusRef);

  const bottomEdge = anchor
    ? placement === "above"
      ? anchor.top - space.xs
      : anchor.bottom
    : height - insets.bottom - space.xl;
  const bottom = Math.max(height - bottomEdge, insets.bottom + space.sm);
  // Never taller than the space above its bottom edge, so it can't run under the status bar.
  const maxHeight = Math.max(0, height - bottom - insets.top - space.md);
  const side = space.md;
  const cardWidth = Math.min(
    width - Math.max(side, insets.left + space.sm) - Math.max(side, insets.right + space.sm),
    maxCardWidth,
  );
  const leftEdge = Math.max(side, insets.left + space.sm);
  const rightEdge = width - Math.max(side, insets.right + space.sm);
  // Centered when there's room, and always clear of a notch on either side.
  const left = Math.min(Math.max(leftEdge, (width - cardWidth) / 2), rightEdge - cardWidth);

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onDismiss={() => focusAccessibility(returnFocusRef.current)}
      onRequestClose={onRequestClose ?? onClose}
      onShow={() => {
        // Opening can fold the composer under the anchor (its keyboard-less focus ends), which
        // moves the anchor without any keyboard event; measure again once the card is up.
        measure();
        focusAccessibility(initialFocusRef?.current ?? cardRef.current);
      }}
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel={`Close ${label}`}
        accessibilityRole="button"
        onPress={onClose}
        style={styles.backdrop}
        testID="popover-backdrop"
      />
      <View
        ref={cardRef}
        accessibilityLabel={label}
        accessibilityViewIsModal
        onAccessibilityEscape={onRequestClose ?? onClose}
        style={[
          styles.card,
          { bottom, left, maxHeight, width: cardWidth },
          fill && { height: maxHeight },
        ]}
        testID="popover-card"
      >
        {scrollable ? (
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.fixed]}>{children}</View>
        )}
      </View>
    </Modal>
  );
}

// Where the anchor sits in the window while the card is open. Measured again when the window
// changes size or the keyboard moves, so the card keeps its place against the anchor.
function useAnchorFrame(
  anchorRef: RefObject<View | null>,
  visible: boolean,
  width: number,
  height: number,
) {
  const [anchor, setAnchor] = useState<{ bottom: number; top: number }>();
  const measure = () =>
    anchorRef.current?.measureInWindow((_x, y, _width, anchorHeight) => {
      if (anchorHeight > 0) setAnchor({ bottom: y + anchorHeight, top: y });
    });
  // biome-ignore lint/correctness/useExhaustiveDependencies: width and height re-run the measure on rotation and resize.
  useEffect(() => {
    if (!visible) {
      setAnchor(undefined);
      return;
    }
    const remeasure = () =>
      anchorRef.current?.measureInWindow((_x, y, _width, anchorHeight) => {
        if (anchorHeight > 0) setAnchor({ bottom: y + anchorHeight, top: y });
      });
    remeasure();
    const shown = Keyboard.addListener("keyboardDidShow", remeasure);
    const hidden = Keyboard.addListener("keyboardDidHide", remeasure);
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [anchorRef, visible, width, height]);
  return { anchor, measure };
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.45)" },
  card: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...floatingShadow,
    overflow: "hidden",
    position: "absolute",
  },
  content: { gap: space.md, paddingVertical: space.md },
  fixed: { flex: 1 },
});
