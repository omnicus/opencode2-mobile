export const palette = {
  background: "#100B18",
  border: "#392C48",
  card: "#241830",
  danger: "#FF8E7A",
  dim: "#A69BAF",
  ink: "#EAE2F0",
  signal: "#36C5E5",
  signalDark: "#172B38",
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
