import Feather from "@expo/vector-icons/Feather";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Button } from "../components/button";
import { CopyTextButton } from "../components/copy-text-button";
import { ModalSheet } from "../components/modal-sheet";
import {
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";

export function parseTranscriptLink(value: string | null) {
  if (!value || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function describeTranscriptLink(url: URL) {
  const match =
    url.hostname === "github.com"
      ? /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url.pathname)
      : null;
  return match
    ? {
        title: `${match[1]}/${match[2]} #${match[3]}`,
        kind: "Pull request",
        icon: "git-pull-request" as const,
      }
    : {
        title: `${url.host}${url.pathname === "/" ? "" : url.pathname}`,
        kind: "External link",
        icon: "link" as const,
      };
}

export function TranscriptLinkCard({
  href,
  onOpenLink,
}: {
  href: string;
  onOpenLink: (url: string) => void;
}) {
  const [options, setOptions] = useState(false);
  const triggerRef = useRef<View>(null);
  const largeText = usesLargeTextLayout(useWindowDimensions().fontScale);
  const url = parseTranscriptLink(href);
  if (!url) return null;
  const { title, kind, icon } = describeTranscriptLink(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const destination = url.protocol === "http:" || local ? `${url.protocol}//${url.host}` : url.host;
  return (
    <>
      <View style={styles.card}>
        <Pressable
          ref={triggerRef}
          accessibilityRole="link"
          accessibilityLabel={`${kind}: ${title}`}
          accessibilityHint={`Opens ${url.host}. Long press for link options.`}
          onPress={() => onOpenLink(url.toString())}
          onLongPress={() => setOptions(true)}
          accessibilityActions={[{ name: "options", label: "Link options" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "options") setOptions(true);
          }}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Feather accessible={false} name={icon} size={18} color={palette.accent} />
          <View style={styles.copy}>
            <Text
              dynamicTypeRamp={typeRamp.subheadline}
              numberOfLines={largeText ? undefined : 2}
              style={styles.title}
            >
              {title}
            </Text>
            <Text dynamicTypeRamp={typeRamp.footnote} style={styles.subtitle}>
              {kind} · {destination}
              {local ? " · This device" : ""}
            </Text>
          </View>
          <Feather accessible={false} name="arrow-up-right" size={16} color={palette.dim} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Link options for ${title}`}
          onPress={() => setOptions(true)}
          style={({ pressed }) => [styles.options, pressed && styles.pressed]}
        >
          <Feather accessible={false} name="more-horizontal" size={16} color={palette.dim} />
        </Pressable>
      </View>
      <ModalSheet
        title="Link options"
        subtitle={title}
        visible={options}
        onClose={() => setOptions(false)}
        returnFocusRef={triggerRef}
        size="compact"
      >
        <Text selectable dynamicTypeRamp={typeRamp.subheadline} style={styles.destination}>
          {url.toString()}
        </Text>
        {local ? (
          <Text dynamicTypeRamp={typeRamp.footnote} style={styles.subtitle}>
            Localhost points to this phone or tablet, not your OpenCode server.
          </Text>
        ) : null}
        <Button
          fullWidth
          icon="external-link"
          label="Open link"
          onPress={() => {
            setOptions(false);
            onOpenLink(url.toString());
          }}
          variant="primary"
        />
        <CopyTextButton appearance="button" label="Copy link" text={url.toString()} />
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.subtitle}>
          Links open in your browser. No preview is fetched automatically.
        </Text>
      </ModalSheet>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: space.sm,
    minHeight: minTouchTarget,
    // Matches the code block frame so both read as embedded content.
    borderRadius: radius.sm,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
  },
  link: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: minTouchTarget,
    paddingVertical: 4,
  },
  options: {
    width: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.subheadline, color: palette.ink },
  subtitle: { ...typography.footnote, color: palette.dim },
  destination: { ...typography.subheadline, color: palette.ink },
  pressed: { opacity: pressedOpacity },
});
