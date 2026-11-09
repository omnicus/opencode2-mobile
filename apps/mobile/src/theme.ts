import { Platform } from "react-native";

// A subtly cool slate dark with soft pastel accents, chosen by the November 2026 design
// council. Surfaces step up in luminance: background, card, raised, prompt, selected.
// Every text color below clears 4.5:1 on every surface it is used on (ink 10.5:1 or more,
// dim 5.1:1 or more, semantic hues 5.1:1 or more). Working is blue, as the spec requires.
export const palette = {
  accent: "#89b4fa",
  // The working spinner and running subagents share the spec's working blue.
  activity: "#89b4fa",
  background: "#11131a",
  border: "#2f3442",
  card: "#1a1d27",
  danger: "#f38ba8",
  dim: "#a3aabb",
  info: "#89b4fa",
  ink: "#eef1f8",
  // Tool output and inline code inside cards: one step above the card.
  raised: "#232734",
  prompt: "#2a2f3d",
  // The one fill for a chosen tab, option, or row, and for secondary buttons.
  selected: "#313748",
  // A rose-tinted fill whose danger label clears 5.6:1.
  dangerFill: "#40293a",
  signal: "#ffffff",
  success: "#86d99a",
  warm: "#f2c86b",
} as const;

// Quiet text in inbox rows the spec fades to 70% while working; the composite clears 5.3:1.
export const fadedWorkingText = "#b8bdca";

// Added 7.7:1 and removed 5.9:1 on their line tints.
export const diffPalette = {
  addedText: "#86d99a",
  removedText: "#f38ba8",
  contextText: "#a3aabb",
  hunkHeader: "#89b4fa",
  addedBackground: "#20352f",
  removedBackground: "#3e2632",
} as const;

export const markdownPalette = {
  code: "#eef1f8",
  // A faint lavender lean keeps reasoning distinct from answers at 7.8:1 on the card.
  reasoning: "#a9b0c4",
  link: "#89b4fa",
  linkText: "#89b4fa",
  strong: "#ffffff",
} as const;

// Syntax colors in the same pastel family. The lowest, comments, is 5.5:1 on the code card.
export const codePalette = {
  comment: "#8b93a8",
  constant: "#89dceb",
  function: "#89b4fa",
  keyword: "#cba6f7",
  punctuation: "#9aa1b2",
  string: "#a6dba4",
  type: "#b4befe",
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
  trackColor: { false: palette.border, true: "#4b5675" },
  ios_backgroundColor: palette.border,
} as const;
