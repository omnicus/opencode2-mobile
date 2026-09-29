import { Platform } from "react-native";

// OpenCode's mobile web palette, with native system fonts and touch targets.
export const palette = {
  accent: "#8ab4f8",
  activity: "#56b6c2",
  background: "#161616",
  border: "#2c2c2c",
  card: "#242424",
  danger: "#ff6b81",
  dim: "#a0a0a0",
  info: "#8ab4f8",
  ink: "#fafafa",
  raised: "#242424",
  prompt: "#3a3a3a",
  signal: "#ffffff",
  signalDark: "#242424",
  success: "#7bd88f",
  warm: "#f6c85f",
} as const;

export const diffPalette = {
  addedText: "#7bd88f",
  removedText: "#ff6b81",
  contextText: "#a0a0a0",
  hunkHeader: "#8ab4f8",
  addedBackground: "#283831",
  removedBackground: "#45202e",
} as const;

export const markdownPalette = {
  code: "#fafafa",
  reasoning: "#a0a0a0",
  link: "#8ab4f8",
  linkText: "#8ab4f8",
  strong: "#fafafa",
} as const;

export const space = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
} as const;

export const largeTextFontScale = 1.3;
export const displayTitleMaxFontSizeMultiplier = 1.4;

export function usesLargeTextLayout(fontScale: number) {
  return fontScale >= largeTextFontScale;
}

export const typeRamp = {
  body: "body",
  caption: "caption1",
  control: "footnote",
  heading: "title1",
  subheading: "subheadline",
} as const;

// Native system fonts for UI; platform monospace only for code and technical data.
export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  sheetTitle: { fontSize: 20, lineHeight: 26, fontWeight: "600" },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22 },
  control: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  caption: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  code: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 14,
    lineHeight: 20,
  },
} as const;

export const control = {
  minHeight: 48,
  borderRadius: radius.md,
  paddingHorizontal: space.md,
  paddingVertical: space.sm,
} as const;

export const switchColors = {
  thumbColor: palette.ink,
  trackColor: { false: palette.border, true: "#626262" },
  ios_backgroundColor: palette.border,
} as const;
