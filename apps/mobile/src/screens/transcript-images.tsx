import Feather from "@expo/vector-icons/Feather";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { useState } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
} from "../theme";
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
const maximumZoom = 4;

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

// One image shows at its own shape. Several form a grid of square crops, two columns for two
// or four and three otherwise, so a batch of screenshots stays scannable.
export function TranscriptImages({ images }: { images: readonly TranscriptImage[] }) {
  const [viewing, setViewing] = useState<TranscriptImage>();
  if (images.length === 0) return null;
  const columns = images.length === 2 || images.length === 4 ? 2 : 3;
  const rows: TranscriptImage[][] = [];
  if (images.length > 1) {
    for (let index = 0; index < images.length; index += columns) {
      rows.push(images.slice(index, index + columns));
    }
  }
  return (
    <View style={styles.images}>
      {images.length === 1 && images[0] ? (
        <TranscriptImageThumbnail image={images[0]} onOpen={setViewing} />
      ) : (
        rows.map((row) => (
          <View key={row.map((image) => image.key).join("|")} style={styles.gridRow}>
            {row.map((image) => (
              <View key={image.key} style={styles.gridCell}>
                <TranscriptImageThumbnail grid image={image} onOpen={setViewing} />
              </View>
            ))}
            {/* One spacer fills the empty columns so a short last row keeps cell widths. */}
            {row.length < columns ? (
              <View
                style={{
                  flex: columns - row.length,
                  marginLeft: space.xs * (columns - row.length - 1),
                }}
              />
            ) : null}
          </View>
        ))
      )}
      <TranscriptImageViewer image={viewing} onClose={() => setViewing(undefined)} />
    </View>
  );
}

function TranscriptImageThumbnail({
  grid = false,
  image,
  onOpen,
}: {
  grid?: boolean;
  image: TranscriptImage;
  onOpen: (image: TranscriptImage) => void;
}) {
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[styles.failed, grid && styles.gridFailed]}>
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
      style={({ pressed }) => [
        styles.thumbnail,
        { aspectRatio: grid ? 1 : aspectRatio },
        pressed && styles.pressed,
      ]}
    >
      <Image
        accessible={false}
        onError={() => setFailed(true)}
        onLoad={({ nativeEvent: { source } }) => {
          if (source.width > 0 && source.height > 0) {
            setAspectRatio(Math.max(minimumAspectRatio, source.width / source.height));
          }
        }}
        resizeMode={grid ? "cover" : "contain"}
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
      {/* A Modal is a separate native root, so Android gestures need their own handler root. */}
      <GestureHandlerRootView style={styles.viewer}>
        {image && Platform.OS === "android" ? (
          <ZoomableImage image={image} />
        ) : image ? (
          <ScrollView
            centerContent
            contentContainerStyle={styles.viewerContent}
            maximumZoomScale={maximumZoom}
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
      </GestureHandlerRootView>
    </Modal>
  );
}

// Android's ScrollView has no zoom, so pinch, pan and double tap drive a transform instead.
function ZoomableImage({ image }: { image: TranscriptImage }) {
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);

  const reset = () => {
    "worklet";
    scale.value = withTiming(1);
    startScale.value = 1;
    offsetX.value = withTiming(0);
    offsetY.value = withTiming(0);
  };
  const clampOffset = (value: number, size: number, zoom: number) => {
    "worklet";
    const limit = (size * (zoom - 1)) / 2;
    return Math.min(limit, Math.max(-limit, value));
  };
  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.min(maximumZoom, Math.max(1, startScale.value * event.scale));
      offsetX.value = clampOffset(offsetX.value, width.value, scale.value);
      offsetY.value = clampOffset(offsetY.value, height.value, scale.value);
    })
    .onEnd(() => {
      if (scale.value <= 1.01) reset();
    });
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      startX.value = offsetX.value;
      startY.value = offsetY.value;
    })
    .onUpdate((event) => {
      if (scale.value <= 1) return;
      offsetX.value = clampOffset(startX.value + event.translationX, width.value, scale.value);
      offsetY.value = clampOffset(startY.value + event.translationY, height.value, scale.value);
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) reset();
      else scale.value = withTiming(2);
    });
  const transform = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View
        collapsable={false}
        onLayout={({ nativeEvent: { layout } }) => {
          width.value = layout.width;
          height.value = layout.height;
        }}
        style={[styles.fill, transform]}
      >
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={image.label}
          resizeMode="contain"
          source={{ uri: image.uri }}
          style={styles.fill}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  close: {
    alignItems: "center",
    backgroundColor: "rgba(40, 40, 40, 0.85)",
    borderRadius: minTouchTarget / 2,
    height: minTouchTarget,
    justifyContent: "center",
    position: "absolute",
    width: minTouchTarget,
  },
  failed: {
    backgroundColor: palette.raised,
    borderRadius: radius.md,
    padding: space.sm,
  },
  failedText: { ...typography.caption, color: palette.dim },
  fill: { height: "100%", width: "100%" },
  images: { gap: space.xs, marginVertical: space.xs },
  gridCell: { flex: 1, minWidth: 0 },
  gridFailed: { aspectRatio: 1, justifyContent: "center" },
  gridRow: { flexDirection: "row", gap: space.xs },
  pressed: { opacity: pressedOpacity },
  thumbnail: {
    backgroundColor: palette.raised,
    borderRadius: radius.md,
    overflow: "hidden",
    width: "100%",
  },
  viewer: { backgroundColor: "#000000", flex: 1 },
  viewerContent: { flexGrow: 1 },
});
