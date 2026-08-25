export const palette = {
  background: "#0B0D0C",
  border: "#2A302D",
  card: "#121614",
  danger: "#FF8E7A",
  dim: "#8E9993",
  ink: "#F0F4F1",
  signal: "#B6F26C",
  signalDark: "#18230E",
  warm: "#FFB86B",
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
