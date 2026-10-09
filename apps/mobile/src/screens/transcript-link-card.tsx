import Feather from "@expo/vector-icons/Feather";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { CopyTextButton } from "../components/copy-text-button";
import { ModalSheet } from "../components/modal-sheet";
import { palette, radius, space, typeRamp, typography, usesLargeTextLayout } from "../theme";

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
              dynamicTypeRamp={typeRamp.control}
              numberOfLines={largeText ? undefined : 2}
              style={styles.title}
            >
              {title}
            </Text>
            <Text dynamicTypeRamp={typeRamp.caption} style={styles.subtitle}>
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
          style={styles.options}
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
        closeLabel="Close"
      >
        <Text selectable dynamicTypeRamp={typeRamp.body} style={styles.destination}>
          {url.toString()}
        </Text>
        {local ? (
          <Text style={styles.subtitle}>
            Localhost points to this phone or tablet, not your OpenCode server.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open link"
          onPress={() => {
            onOpenLink(url.toString());
          }}
          style={styles.open}
        >
          <Feather accessible={false} name="external-link" size={18} color={palette.ink} />
          <Text dynamicTypeRamp={typeRamp.control} style={styles.title}>
            Open link
          </Text>
        </Pressable>
        <CopyTextButton text={url.toString()} label="Copy link" />
        <Text style={styles.subtitle}>
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
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: palette.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  link: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 48,
    paddingVertical: 4,
  },
  options: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.compactControl, color: palette.ink },
  subtitle: { ...typography.caption, color: palette.dim },
  destination: { ...typography.body, color: palette.ink },
  open: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 48 },
  pressed: { opacity: 0.6 },
});
