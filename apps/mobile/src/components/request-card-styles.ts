import { StyleSheet } from "react-native";
import { palette, radius, space, typography } from "../theme";

// Question and approval actions share visual sizing without shrinking touch targets.
export const requestCardStyles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  button: {
    minHeight: 44,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderColor: palette.border,
    borderWidth: 1,
    maxWidth: "100%",
  },
  buttonLabel: { ...typography.control, color: palette.ink, textAlign: "center" },
  card: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: palette.warm,
    padding: 12,
    gap: space.sm,
  },
});
