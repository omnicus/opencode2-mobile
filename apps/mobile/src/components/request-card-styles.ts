import { StyleSheet } from "react-native";
import { cardSurface, space } from "../theme";

// Question and approval actions share visual sizing without shrinking touch targets.
export const requestCardStyles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  card: { ...cardSurface, gap: 12 },
});
