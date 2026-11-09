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
  // The one fill for a chosen tab, option, or row on a card or sheet.
  selected: "#3a3a3a",
  // Danger at 16% over the card: a tinted fill whose red label still clears 4.5:1.
  dangerFill: "#3f2a2e",
  signal: "#ffffff",
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

// Code block syntax colors, sampled from the OpenCode iOS app's dark transcript. Comments and
// punctuation are lifted to about 5:1 on the code card so they stay readable.
export const codePalette = {
  comment: "#8b949e",
  constant: "#7cc8d0",
  function: "#e48cb8",
  keyword: "#e48cb8",
  punctuation: "#9a9a9a",
  string: "#a5d6a7",
  type: "#9c94f0",
} as const;

// OpenCode desktop's dark project avatar colors: fill, 1px border, and a white letter.
export const projectAvatarPalette = {
  foreground: "#ffffff",
  colors: {
    orange: { fill: "#723d22", border: "#ff8648" },
    yellow: { fill: "#68552b", border: "#e7af36" },
    cyan: { fill: "#005a6e", border: "#0096b8" },
    green: { fill: "#196130", border: "#49c970" },
    red: { fill: "#7a1f23", border: "#d92e3c" },
    pink: { fill: "#8c2d61", border: "#e4429e" },
    blue: { fill: "#263fa9", border: "#7698fd" },
    purple: { fill: "#361f83", border: "#7152f4" },
    gray: { fill: "#5c5c5c", border: "#aeaeae" },
  },
} as const;

// Settings row icon tiles. White glyphs sit on each fill at 3:1 or more.
export const iconTilePalette = {
  amber: "#b7791f",
  blue: "#2f6fdb",
  gray: "#636366",
  green: "#2f9a57",
  indigo: "#5856d6",
  red: "#d0434f",
  teal: "#1f8a9e",
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
  pill: 999,
} as const;

// Android press feedback; iOS uses pressedOpacity instead.
export const rippleColor = "rgba(255,255,255,0.12)";
// Getters read the platform at use, so render-time callers follow a test's platform switch.
export const rippleFeedback = {
  get row() {
    return Platform.OS === "android" ? { color: rippleColor } : undefined;
  },
  get borderless() {
    return Platform.OS === "android" ? { borderless: true, color: rippleColor } : undefined;
  },
};

// The one shadow for controls that float over content: bottom menu, composer, task chip.
export const floatingShadow = {
  boxShadow: "0px 2px 10px rgba(0, 0, 0, 0.3)",
  elevation: 3,
} as const;

export const pressedOpacity = 0.6;
export const disabledOpacity = 0.5;
// Android's 48dp guideline, shared by both platforms' controls.
export const minTouchTarget = 48;

export const largeTextFontScale = 1.3;
export const displayTitleMaxFontSizeMultiplier = 1.4;

export function usesLargeTextLayout(fontScale: number) {
  return fontScale >= largeTextFontScale;
}

export const typeRamp = {
  largeTitle: "title1",
  navTitle: "headline",
  headline: "headline",
  body: "body",
  subheadline: "subheadline",
  control: "footnote",
  footnote: "footnote",
  sectionLabel: "footnote",
  caption: "caption1",
  label: "caption1",
  compactControl: "caption1",
} as const;

// Native system fonts for UI; platform monospace only for code and technical data.
export const typography = {
  largeTitle: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  navTitle: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22 },
  // Chat sizes match the OpenCode iOS app: prose and tool summaries share one size.
  chatBody: { fontSize: 17, lineHeight: 25 },
  chatActivity: { fontSize: 17, lineHeight: 24 },
  subheadline: { fontSize: 15, lineHeight: 20 },
  control: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  compactControl: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  footnote: { fontSize: 13, lineHeight: 18 },
  sectionLabel: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
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

export const cardSurface = {
  backgroundColor: palette.card,
  borderColor: palette.border,
  borderWidth: 1,
  borderRadius: radius.md,
  padding: space.md,
} as const;

export const switchColors = {
  thumbColor: palette.ink,
  trackColor: { false: palette.border, true: "#626262" },
  ios_backgroundColor: palette.border,
} as const;
