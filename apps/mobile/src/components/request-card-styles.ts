import { StyleSheet } from "react-native";
import { cardSurface, minTouchTarget, palette, radius, space, typography } from "../theme";

// Question and approval actions share visual sizing without shrinking touch targets.
export const requestCardStyles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  button: {
    minHeight: minTouchTarget,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderColor: palette.border,
    borderWidth: 1,
    flexGrow: 1,
    maxWidth: "100%",
    overflow: "hidden",
  },
  buttonLabel: { ...typography.control, color: palette.ink, textAlign: "center" },
  card: { ...cardSurface, gap: 12 },
});
