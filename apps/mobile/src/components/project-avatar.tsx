import type { ProjectListOutput } from "@opencode2-mobile/opencode-adapter";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { projectAvatarPalette, typography } from "../theme";

export type ProjectIcon = NonNullable<ProjectListOutput[number]["icon"]>;
export type ProjectAvatarColor = keyof typeof projectAvatarPalette.colors;

const colorAliases: Record<string, ProjectAvatarColor> = { lime: "green", mint: "cyan" };
// Only inline bytes render, so an avatar never makes a network request.
const dataUriPattern = /^data:image\/(png|jpeg|gif|webp);base64,/i;
export const maxProjectAvatarImageLength = 1024 * 1024;

export function projectAvatarColor(color: string | undefined): ProjectAvatarColor {
  if (!color) return "gray";
  if (Object.hasOwn(projectAvatarPalette.colors, color)) return color as ProjectAvatarColor;
  return Object.hasOwn(colorAliases, color) ? (colorAliases[color] ?? "gray") : "gray";
}

// A chosen color replaces the image, as on OpenCode desktop.
export function projectAvatarImageUri(icon: ProjectIcon | undefined) {
  if (!icon || icon.color) return undefined;
  const uri = icon.override || icon.url;
  if (!uri || uri.length > maxProjectAvatarImageLength) return undefined;
  return dataUriPattern.test(uri.slice(0, 64)) ? uri : undefined;
}

export function projectAvatarLetter(name: string) {
  const trimmed = name.trim();
  // Hermes may lack Intl.Segmenter; a code point still keeps surrogate pairs whole.
  const first =
    typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)][0]?.segment
      : Array.from(trimmed)[0];
  return (first ?? "").toLocaleUpperCase();
}

// The row label already names the project, so the avatar is hidden from screen readers.
// Pass the title's scaled line height to center the avatar on the title's first line.
export function ProjectAvatar({
  icon,
  lineHeight,
  name,
  size = 20,
}: {
  icon?: ProjectIcon | undefined;
  lineHeight?: number;
  name: string;
  size?: number;
}) {
  const imageUri = projectAvatarImageUri(icon);
  const [failedUri, setFailedUri] = useState<string>();
  const frame = { borderRadius: size / 4, height: size, width: size };
  const colors = projectAvatarPalette.colors[projectAvatarColor(icon?.color)];
  const avatar =
    imageUri && imageUri !== failedUri ? (
      <Image
        accessible={false}
        onError={() => setFailedUri(imageUri)}
        source={{ uri: imageUri }}
        style={[styles.image, frame]}
        testID="project-avatar-image"
      />
    ) : (
      <View
        style={[
          styles.letterFrame,
          frame,
          { backgroundColor: colors.fill, borderColor: colors.border },
        ]}
        testID="project-avatar-letter"
      >
        <Text allowFontScaling={false} style={[styles.letter, letterSize(size)]}>
          {projectAvatarLetter(name)}
        </Text>
      </View>
    );
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.slot, lineHeight ? { height: Math.max(size, lineHeight) } : undefined]}
      testID="project-avatar"
    >
      {avatar}
    </View>
  );
}

// The letter scales with the frame so a 16pt row avatar does not crowd its border.
function letterSize(size: number) {
  return size >= 20 ? undefined : { fontSize: Math.round(size * 0.62), lineHeight: size - 2 };
}

const styles = StyleSheet.create({
  slot: { flexShrink: 0, justifyContent: "center" },
  image: { flexShrink: 0 },
  letter: { ...typography.label, color: projectAvatarPalette.foreground, textAlign: "center" },
  letterFrame: {
    alignItems: "center",
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: "center",
    overflow: "hidden",
  },
});
