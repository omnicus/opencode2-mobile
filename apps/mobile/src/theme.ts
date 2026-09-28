// Neutral dark surfaces inspired by the supplied ChatGPT and Gemini iOS references.
// Keep color for links and feedback; navigation and primary controls are monochrome.
export const palette = {
  accent: "#8ab4f8",
  activity: "#e3e3e3",
  background: "#000000",
  border: "#2c2c2c",
  card: "#141414",
  danger: "#ff6b81",
  dim: "#a0a0a0",
  info: "#8ab4f8",
  ink: "#eeeeee",
  raised: "#242424",
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
  code: "#a8d5ba",
  reasoning: "#c4b5fd",
  link: "#8ab4f8",
  linkText: "#8ab4f8",
  strong: "#eeeeee",
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
