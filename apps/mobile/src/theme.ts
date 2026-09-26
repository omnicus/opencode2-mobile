// OpenCode V2's `system` dark theme, resolved from the current Foot ANSI palette.
// https://github.com/anomalyco/opencode/blob/095bc2e20bf087f926d40cbc0afa7804564cf48e/packages/tui/src/theme/system.ts
// Values include OpenCode's V1-to-V2 theme migration. The terminal's transparent
// background becomes its opaque default background on mobile.
// Native filled controls use the TUI's focused primary-action colors.
export const palette = {
  accent: "#31bcdb", // hue.accent.200
  activity: "#d65adf", // categorical[0].200
  background: "#100b17", // background.base
  border: "#503774", // border.base
  card: "#221731", // background.raised.base
  danger: "#ff6b81", // text.feedback.error.base
  dim: "#a4a4a4", // text.muted
  info: "#31bcdb", // text.feedback.info.base
  ink: "#f3eff5", // text.base
  raised: "#2b1e3f", // background.raised.high
  signal: "#31bcdb", // text.formfield.$selected / background.action.primary.$focused
  signalDark: "#221731", // background.action.primary.$hovered
  success: "#7bd88f", // text.feedback.success.base
  warm: "#f6c85f", // text.feedback.warning.base
} as const;

export const diffPalette = {
  addedText: "#7bd88f",
  removedText: "#ff6b81",
  contextText: "#503774",
  hunkHeader: "#503774",
  addedBackground: "#283831",
  removedBackground: "#45202e",
} as const;

export const markdownPalette = {
  link: "#0a7fd4",
  linkText: "#31bcdb",
  strong: "#f3eff5",
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
