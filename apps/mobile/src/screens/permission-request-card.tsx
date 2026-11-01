import Feather from "@expo/vector-icons/Feather";
import type { PermissionReply, PermissionRequest } from "@opencode2-mobile/opencode-adapter";
import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ModalSheet } from "../components/modal-sheet";
import { requestCardStyles } from "../components/request-card-styles";
import {
  disabledOpacity,
  markdownPalette,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
import { permissionActionExplanation } from "./permission-presentation";
import { sanitizeTranscriptText } from "./session-transcript-model";

export function PermissionRequestCard({
  request,
  replying,
  error,
  onReply,
}: {
  request: PermissionRequest;
  replying: boolean;
  error: boolean;
  onReply: (requestID: string, sessionID: string, reply: PermissionReply) => void;
}) {
  const [details, setDetails] = useState(false);
  const { fontScale } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const patterns = request.save ?? [];
  const explanation = permissionActionExplanation(request.action);
  const shell = request.action === "shell";
  const action = shell
    ? "Run shell command"
    : `Call tool ${sanitizeTranscriptText(request.action, 256)}`;
  const actions = (
    <View style={[styles.actions, largeText && styles.actionsLarge]}>
      {(
        [
          ["once", "Allow once"],
          ["always", "Always allow"],
          ["reject", "Reject"],
        ] as const
      ).map(([reply, label]) => (
        <Pressable
          key={reply}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={
            reply === "once"
              ? "Allow this request one time"
              : reply === "always"
                ? "Save permission for matching requests. Review the scope in Details"
                : "Reject this request; other pending requests in this session may also be rejected"
          }
          accessibilityState={{ disabled: replying, busy: replying }}
          disabled={replying}
          onPress={() => onReply(request.id, request.sessionID, reply)}
          style={({ pressed }) => [
            styles.button,
            reply === "once" && styles.primary,
            pressed && styles.pressed,
            replying && styles.disabled,
          ]}
        >
          <Text
            dynamicTypeRamp={typeRamp.control}
            style={[
              styles.buttonLabel,
              reply === "once" && styles.primaryLabel,
              reply === "reject" && styles.reject,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
  const resources = request.resources.map((resource) => (
    <View key={resource} style={styles.commandBox}>
      <Text selectable style={styles.command}>
        {sanitizeTranscriptText(resource, resource.length)}
      </Text>
    </View>
  ));
  const scope =
    patterns.length > 0 ? (
      <View style={styles.scope}>
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.footnote}>
          Always allow saves these patterns for future requests
        </Text>
        <View accessibilityLabel="Saved permission patterns">
          {patterns.map((pattern) => (
            <Text key={pattern} selectable style={styles.pattern}>
              {sanitizeTranscriptText(pattern, pattern.length)}
            </Text>
          ))}
        </View>
      </View>
    ) : null;
  return (
    <View style={styles.card}>
      <View style={styles.eyebrowRow}>
        <Feather
          accessible={false}
          name={shell ? "terminal" : "tool"}
          size={14}
          color={palette.warm}
        />
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.eyebrow}>
          {action}
        </Text>
      </View>
      <View style={styles.headingRow}>
        <Text
          accessibilityRole="header"
          dynamicTypeRamp={typeRamp.headline}
          style={[styles.title, styles.headingTitle]}
        >
          Permission required
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Details"
          accessibilityHint="Opens the full request, saved permission patterns, and explanation"
          onPress={() => setDetails(true)}
          style={({ pressed }) => [styles.detailsButton, pressed && styles.pressed]}
        >
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.details}>
            Details
          </Text>
          <Feather accessible={false} name="chevron-right" size={14} color={palette.dim} />
        </Pressable>
      </View>
      {shell ? (
        <View style={styles.commandBox}>
          <Text numberOfLines={2} style={styles.command}>
            {sanitizeTranscriptText(request.resources.join("\n"), 1024)}
          </Text>
        </View>
      ) : null}
      {replying ? (
        <Text
          accessibilityLiveRegion="polite"
          dynamicTypeRamp={typeRamp.footnote}
          style={styles.footnote}
        >
          Sending permission reply…
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
          The server did not accept that reply. Review the refreshed request and try again.
        </Text>
      ) : null}
      {actions}
      <ModalSheet title="Permission details" visible={details} onClose={() => setDetails(false)}>
        <Text dynamicTypeRamp={typeRamp.headline} style={styles.title}>
          {action}
        </Text>
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.sectionLabel}>
          {shell ? "Full command" : "Requested resources"}
        </Text>
        {resources}
        {scope}
        {patterns.length > 0 ? (
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
            Always allow saves the displayed patterns, which can cover more than this request.
          </Text>
        ) : null}
        {explanation ? (
          <View style={styles.scope}>
            <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.sectionLabel}>
              OpenCode Mobile explanation
            </Text>
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
              {explanation}
            </Text>
          </View>
        ) : null}
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
          Reject may also reject other pending permission requests in this session.
        </Text>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  eyebrow: { ...typography.sectionLabel, color: palette.warm, flexShrink: 1 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  headingTitle: { flex: 1 },
  card: requestCardStyles.card,
  title: { ...typography.headline, color: palette.ink },
  commandBox: { backgroundColor: palette.background, borderRadius: radius.sm },
  command: {
    ...typography.code,
    color: markdownPalette.code,
    padding: space.sm,
  },
  scope: { gap: space.xs },
  pattern: {
    ...typography.code,
    color: palette.ink,
  },
  details: { ...typography.subheadline, color: palette.dim },
  footnote: { ...typography.footnote, color: palette.dim },
  sectionLabel: { ...typography.sectionLabel, color: palette.dim },
  copy: { ...typography.subheadline, color: palette.dim },
  actions: requestCardStyles.actions,
  actionsLarge: { flexDirection: "column" },
  button: requestCardStyles.button,
  primary: { backgroundColor: palette.signal, borderColor: palette.signal },
  primaryLabel: { color: palette.background },
  buttonLabel: requestCardStyles.buttonLabel,
  reject: { color: palette.danger },
  error: { ...typography.subheadline, color: palette.danger },
  pressed: { opacity: pressedOpacity },
  disabled: { opacity: disabledOpacity },
  detailsButton: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    justifyContent: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: space.xs,
  },
});
