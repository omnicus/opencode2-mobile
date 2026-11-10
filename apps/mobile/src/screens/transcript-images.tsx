import Feather from "@expo/vector-icons/Feather";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
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

export type JustifiedImageRow = { start: number; end: number; height: number };

// Rows of tiles that keep each image's shape and share one height per row. The row count comes
// from the target height, and a small linear partition balances the rows so a batch of seven
// screenshots reads as three and four instead of a full row and a straggler. No row grows past
// the cap, so a lone portrait screenshot stays a tile instead of filling the screen.
export function justifiedImageRows(
  aspects: readonly number[],
  width: number,
  options: { gap: number; maxHeight: number; targetHeight: number },
): JustifiedImageRow[] {
  const count = aspects.length;
  if (count === 0 || width <= 0) return [];
  const total = aspects.reduce((sum, aspect) => sum + aspect, 0);
  const rowCount = Math.min(count, Math.max(1, Math.round((total * options.targetHeight) / width)));
  const ideal = total / rowCount;
  const prefix = [0];
  for (const aspect of aspects) prefix.push((prefix.at(-1) ?? 0) + aspect);
  const span = (start: number, end: number) => (prefix[end] ?? 0) - (prefix[start] ?? 0);

  // cost[rows][end] is the best squared deviation for the first `end` images in `rows` rows.
  const cost = Array.from({ length: rowCount + 1 }, () => Array<number>(count + 1).fill(Infinity));
  const split = Array.from({ length: rowCount + 1 }, () => Array<number>(count + 1).fill(0));
  const first = cost[0];
  if (first) first[0] = 0;
  for (let rows = 1; rows <= rowCount; rows += 1) {
    for (let end = rows; end <= count; end += 1) {
      for (let start = rows - 1; start < end; start += 1) {
        const value = (cost[rows - 1]?.[start] ?? Infinity) + (span(start, end) - ideal) ** 2;
        const row = cost[rows];
        if (row && value < (row[end] ?? Infinity) - 1e-9) {
          row[end] = value;
          const splitRow = split[rows];
          if (splitRow) splitRow[end] = start;
        }
      }
    }
  }

  const result: JustifiedImageRow[] = [];
  let end = count;
  for (let rows = rowCount; rows > 0; rows -= 1) {
    const start = split[rows]?.[end] ?? 0;
    const available = width - options.gap * (end - start - 1);
    result.unshift({
      start,
      end,
      height: Math.min(options.maxHeight, available / span(start, end)),
    });
    end = start;
  }
  return result;
}

const tileGap = space.xs;
const tileTargetHeight = 170;
// Below the height a row of three phone screenshots needs to fill the width, so such a row
// stays short and ends early instead of growing.
const tileMaxHeight = 200;
// Very tall or wide images crop to these bounds in a tile; the viewer always shows all of it.
const tileAspectBounds = { min: 0.4, max: 2.5 } as const;
// Lays out before the first measurement, so rows have a size in tests and on the first frame.
const fallbackWidth = 320;

// Several images form justified rows of small tiles. Tapping one opens the full-screen viewer.
export function TranscriptImages({ images }: { images: readonly TranscriptImage[] }) {
  const [viewing, setViewing] = useState<number>();
  const [width, setWidth] = useState(0);
  const [aspects, setAspects] = useState<Readonly<Record<string, number>>>({});
  if (images.length === 0) return null;
  const rows = justifiedImageRows(
    images.map((image) => aspects[image.key] ?? 1),
    width || fallbackWidth,
    { gap: tileGap, maxHeight: tileMaxHeight, targetHeight: tileTargetHeight },
  );
  const setAspect = (key: string, aspect: number) => {
    const bounded = Math.min(tileAspectBounds.max, Math.max(tileAspectBounds.min, aspect));
    setAspects((current) => (current[key] === bounded ? current : { ...current, [key]: bounded }));
  };
  return (
    <View
      onLayout={({ nativeEvent: { layout } }) => {
        if (Math.abs(layout.width - width) >= 1) setWidth(layout.width);
      }}
      style={styles.images}
    >
      {rows.map((row) => {
        const rowImages = images.slice(row.start, row.end);
        return (
          <View key={rowImages.map((image) => image.key).join("|")} style={styles.tileRow}>
            {rowImages.map((image) => (
              <TranscriptImageTile
                key={image.key}
                height={row.height}
                image={image}
                onAspect={setAspect}
                onOpen={(opened) => setViewing(images.indexOf(opened))}
                width={row.height * (aspects[image.key] ?? 1)}
              />
            ))}
          </View>
        );
      })}
      <TranscriptImageViewer
        images={images}
        index={viewing}
        onClose={() => setViewing(undefined)}
      />
    </View>
  );
}

function TranscriptImageTile({
  height,
  image,
  onAspect,
  onOpen,
  width,
}: {
  height: number;
  image: TranscriptImage;
  onAspect: (key: string, aspect: number) => void;
  onOpen: (image: TranscriptImage) => void;
  width: number;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[styles.failed, { height, width }]}>
        <Text dynamicTypeRamp={typeRamp.caption} numberOfLines={3} style={styles.failedText}>
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
      style={({ pressed }) => [styles.tile, { height, width }, pressed && styles.pressed]}
    >
      <Image
        accessible={false}
        onError={() => setFailed(true)}
        onLoad={({ nativeEvent: { source } }) => {
          if (source.width > 0 && source.height > 0) {
            onAspect(image.key, source.width / source.height);
          }
        }}
        resizeMode="cover"
        source={{ uri: image.uri }}
        style={styles.fill}
      />
    </Pressable>
  );
}

function TranscriptImageViewer({
  images,
  index,
  onClose,
}: {
  images: readonly TranscriptImage[];
  index: number | undefined;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const open = index !== undefined && index >= 0 && index < images.length;
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
      transparent
      visible={open}
    >
      {/* A Modal is a separate native root, so Android gestures need their own handler root. */}
      <GestureHandlerRootView style={styles.viewer}>
        {open ? <ImagePages images={images} initialIndex={index} topInset={insets.top} /> : null}
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

// Each image is one page of a horizontal pager, so a swipe moves to the next image. Zoom stays
// inside a page: iOS nests a zooming scroll view, and Android locks paging while zoomed.
function ImagePages({
  images,
  initialIndex,
  topInset,
}: {
  images: readonly TranscriptImage[];
  initialIndex: number;
  topInset: number;
}) {
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const pageRef = useRef(page);
  pageRef.current = page;

  // Keep the current image in place after the first layout and after a rotation.
  useEffect(() => {
    pager.current?.scrollTo({ animated: false, x: pageRef.current * width });
  }, [width]);

  return (
    <>
      <ScrollView
        ref={pager}
        contentOffset={{ x: initialIndex * width, y: 0 }}
        horizontal
        onMomentumScrollEnd={({ nativeEvent }) => {
          const next = Math.round(nativeEvent.contentOffset.x / width);
          setPage(Math.min(images.length - 1, Math.max(0, next)));
        }}
        pagingEnabled
        scrollEnabled={images.length > 1 && !zoomed}
        showsHorizontalScrollIndicator={false}
        testID="image-pager"
      >
        {images.map((image) => (
          <View key={image.key} style={[styles.page, { width }]}>
            {Platform.OS === "android" ? (
              <ZoomableImage image={image} onZoomChange={setZoomed} />
            ) : (
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
            )}
          </View>
        ))}
      </ScrollView>
      {images.length > 1 ? (
        <View pointerEvents="none" style={[styles.counter, { top: topInset + space.sm }]}>
          <View style={styles.counterPill}>
            <Text
              accessibilityLiveRegion="polite"
              dynamicTypeRamp={typeRamp.caption}
              style={styles.counterText}
            >
              {page + 1} of {images.length}
            </Text>
          </View>
        </View>
      ) : null}
    </>
  );
}

// Android's ScrollView has no zoom, so pinch, pan and double tap drive a transform instead.
function ZoomableImage({
  image,
  onZoomChange,
}: {
  image: TranscriptImage;
  onZoomChange: (zoomed: boolean) => void;
}) {
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
    runOnJS(onZoomChange)(false);
  };
  const clampOffset = (value: number, size: number, zoom: number) => {
    "worklet";
    const limit = (size * (zoom - 1)) / 2;
    return Math.min(limit, Math.max(-limit, value));
  };
  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
      runOnJS(onZoomChange)(true);
    })
    .onUpdate((event) => {
      scale.value = Math.min(maximumZoom, Math.max(1, startScale.value * event.scale));
      offsetX.value = clampOffset(offsetX.value, width.value, scale.value);
      offsetY.value = clampOffset(offsetY.value, height.value, scale.value);
    })
    .onEnd(() => {
      if (scale.value <= 1.01) reset();
    });
  // Pan claims the touch only while zoomed, so an unzoomed swipe reaches the pager.
  const pan = Gesture.Pan()
    .averageTouches(true)
    .manualActivation(true)
    .onTouchesMove((_event, state) => {
      if (scale.value > 1) state.activate();
      else state.fail();
    })
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
      else {
        scale.value = withTiming(2);
        runOnJS(onZoomChange)(true);
      }
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
    justifyContent: "center",
    overflow: "hidden",
    padding: space.sm,
  },
  failedText: { ...typography.caption, color: palette.dim },
  fill: { height: "100%", width: "100%" },
  images: { gap: tileGap, marginVertical: space.xs },
  pressed: { opacity: pressedOpacity },
  tile: {
    backgroundColor: palette.raised,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  tileRow: { flexDirection: "row", gap: tileGap },
  counter: { alignItems: "center", left: 0, position: "absolute", right: 0 },
  counterPill: {
    backgroundColor: "rgba(40, 40, 40, 0.85)",
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs / 2,
  },
  counterText: { ...typography.caption, color: palette.ink },
  page: { height: "100%" },
  viewer: { backgroundColor: "#000000", flex: 1 },
  viewerContent: { flexGrow: 1 },
});
