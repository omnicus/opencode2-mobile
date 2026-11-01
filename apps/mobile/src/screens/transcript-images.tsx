import Feather from "@expo/vector-icons/Feather";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { palette, radius, space, typeRamp, typography } from "../theme";
import { sanitizeTranscriptText } from "./session-transcript-model";

type AssistantTool = Extract<
  Extract<SessionMessageInfo, { type: "assistant" }>["content"][number],
  { type: "tool" }
>;
type UserFile = NonNullable<Extract<SessionMessageInfo, { type: "user" }>["files"]>[number];

export type TranscriptImage = { key: string; label: string; uri: string };

// Only inline bytes render, so an image never makes a network request. SVG and
// other formats stay as labels; the platform decoders handle these four.
const imageMimes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const dataUriPattern = /^data:(image\/[a-z]+);base64,/i;
export const maxTranscriptImages = 8;
// The message list is already capped at 16 MiB; this keeps one image from using most of it.
export const maxTranscriptImageLength = 12 * 1024 * 1024;
const minimumAspectRatio = 0.75;

export function inlineImageUri(uri: string, mime: string) {
  if (uri.length > maxTranscriptImageLength) return undefined;
  const match = dataUriPattern.exec(uri.slice(0, 64));
  const type = match?.[1]?.toLowerCase();
  if (!type || !imageMimes.has(type) || type !== mime.toLowerCase()) return undefined;
  return uri;
}

export function toolImages(tools: readonly AssistantTool[]) {
  const images: TranscriptImage[] = [];
  for (const tool of tools) {
    if (tool.state.status !== "completed" && tool.state.status !== "error") continue;
    for (const [index, item] of (tool.state.content ?? []).entries()) {
      if (images.length >= maxTranscriptImages) return images;
      if (item.type !== "file") continue;
      const uri = inlineImageUri(item.uri, item.mime);
      if (!uri) continue;
      images.push({ key: `${tool.id}:${index}`, label: imageLabel(item.name), uri });
    }
  }
  return images;
}

export function messageToolImages(messages: readonly SessionMessageInfo[]) {
  return toolImages(
    messages.flatMap((message) =>
      message.type === "assistant"
        ? message.content.filter((part): part is AssistantTool => part.type === "tool")
        : [],
    ),
  );
}

export function isInlineImageAttachment(file: UserFile) {
  return imageMimes.has(file.mime.toLowerCase()) && file.data.length <= maxTranscriptImageLength;
}

export function attachmentImages(files: readonly UserFile[] | undefined) {
  const images: TranscriptImage[] = [];
  for (const [index, file] of (files ?? []).entries()) {
    if (images.length >= maxTranscriptImages) break;
    if (!isInlineImageAttachment(file)) continue;
    images.push({
      key: `attachment:${index}`,
      label: imageLabel(file.name),
      uri: `data:${file.mime.toLowerCase()};base64,${file.data}`,
    });
  }
  return images;
}

function imageLabel(name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed ? sanitizeTranscriptText(trimmed.split("/").at(-1) ?? trimmed, 256) : "Image";
}

export function TranscriptImages({ images }: { images: readonly TranscriptImage[] }) {
  const [viewing, setViewing] = useState<TranscriptImage>();
  if (images.length === 0) return null;
  return (
    <View style={styles.images}>
      {images.map((image) => (
        <TranscriptImageThumbnail key={image.key} image={image} onOpen={setViewing} />
      ))}
      <TranscriptImageViewer image={viewing} onClose={() => setViewing(undefined)} />
    </View>
  );
}

function TranscriptImageThumbnail({
  image,
  onOpen,
}: {
  image: TranscriptImage;
  onOpen: (image: TranscriptImage) => void;
}) {
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={styles.failed}>
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.failedText}>
          {image.label} could not be shown
        </Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityHint="Opens the image full screen"
      accessibilityLabel={image.label}
      accessibilityRole="imagebutton"
      onPress={() => onOpen(image)}
      style={({ pressed }) => [styles.thumbnail, { aspectRatio }, pressed && styles.pressed]}
    >
      <Image
        accessible={false}
        onError={() => setFailed(true)}
        onLoad={({ nativeEvent: { source } }) => {
          if (source.width > 0 && source.height > 0) {
            setAspectRatio(Math.max(minimumAspectRatio, source.width / source.height));
          }
        }}
        resizeMode="contain"
        source={{ uri: image.uri }}
        style={styles.fill}
      />
    </Pressable>
  );
}

function TranscriptImageViewer({
  image,
  onClose,
}: {
  image: TranscriptImage | undefined;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
      transparent
      visible={image !== undefined}
    >
      <View style={styles.viewer}>
        {image ? (
          <ScrollView
            centerContent
            contentContainerStyle={styles.viewerContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image
              accessibilityIgnoresInvertColors
              accessibilityLabel={image.label}
              resizeMode="contain"
              source={{ uri: image.uri }}
              style={styles.fill}
            />
          </ScrollView>
        ) : null}
        <Pressable
          accessibilityLabel="Close image"
          accessibilityRole="button"
          hitSlop={space.sm}
          onPress={onClose}
          style={({ pressed }) => [
            styles.close,
            { top: insets.top + space.sm, right: insets.right + space.md },
            pressed && styles.pressed,
          ]}
        >
          <Feather accessible={false} color={palette.ink} name="x" size={22} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  close: {
    alignItems: "center",
    backgroundColor: "rgba(40, 40, 40, 0.85)",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    width: 44,
  },
  failed: {
    backgroundColor: palette.raised,
    borderRadius: radius.md,
    padding: space.sm,
  },
  failedText: { ...typography.caption, color: palette.dim },
  fill: { height: "100%", width: "100%" },
  images: { gap: space.sm, marginVertical: space.xs },
  pressed: { opacity: 0.7 },
  thumbnail: {
    backgroundColor: palette.raised,
    borderRadius: radius.md,
    overflow: "hidden",
    width: "100%",
  },
  viewer: { backgroundColor: "#000000", flex: 1 },
  viewerContent: { flexGrow: 1 },
});
