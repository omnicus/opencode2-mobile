import type { PermissionReply, PermissionRequest } from "@opencode2-mobile/opencode-adapter";
import { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ModalSheet } from "../components/modal-sheet";
import {
  control,
  markdownPalette,
  palette,
  radius,
  space,
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
            replying && styles.disabled,
            pressed && styles.disabled,
          ]}
        >
          <Text
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
    <Text key={resource} selectable style={styles.command}>
      {sanitizeTranscriptText(resource, resource.length)}
    </Text>
  ));
  const scope =
    patterns.length > 0 ? (
      <View style={styles.scope}>
        <Text style={styles.caption}>Always allow saves these patterns for future requests</Text>
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
      <Text accessibilityRole="header" style={styles.title}>
        Permission required
      </Text>
      <Text style={styles.action}>{action}</Text>
      {shell ? (
        <View style={styles.commandBox}>
          <Text numberOfLines={3} style={styles.command}>
            {sanitizeTranscriptText(request.resources.join("\n"), 1024)}
          </Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Details"
        accessibilityHint="Opens the full request, saved permission patterns, and explanation"
        onPress={() => setDetails(true)}
        style={({ pressed }) => [styles.detailsButton, pressed && styles.disabled]}
      >
        <Text style={styles.caption}>Details ›</Text>
      </Pressable>
      {replying ? (
        <Text accessibilityLiveRegion="polite" style={styles.caption}>
          Sending permission reply…
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.reject}>
          The server did not accept that reply. Review the refreshed request and try again.
        </Text>
      ) : null}
      {actions}
      <ModalSheet title="Permission details" visible={details} onClose={() => setDetails(false)}>
        <Text style={styles.title}>{action}</Text>
        <Text style={styles.caption}>{shell ? "Full command" : "Requested resources"}</Text>
        {resources}
        {scope}
        {patterns.length > 0 ? (
          <Text style={styles.copy}>
            Always allow saves the displayed patterns, which can cover more than this request.
          </Text>
        ) : null}
        {explanation ? (
          <View>
            <Text style={styles.caption}>OpenCode Mobile explanation</Text>
            <Text style={styles.copy}>{explanation}</Text>
          </View>
        ) : null}
        <Text style={styles.copy}>
          Reject may also reject other pending permission requests in this session.
        </Text>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 12,
    gap: 8,
  },
  title: { ...typography.heading, color: palette.warm },
  action: { ...typography.body, color: palette.ink },
  commandBox: { backgroundColor: palette.background, borderRadius: radius.sm },
  command: {
    ...typography.code,
    color: markdownPalette.code,
    padding: 10,
  },
  scope: { gap: 4 },
  pattern: {
    ...typography.code,
    color: palette.ink,
  },
  caption: { ...typography.caption, color: palette.dim },
  copy: { ...typography.body, color: palette.dim, marginVertical: space.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionsLarge: { flexDirection: "column" },
  button: {
    ...control,
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    borderColor: palette.border,
    borderWidth: 1,
  },
  primary: { backgroundColor: palette.signal },
  primaryLabel: { color: palette.background },
  buttonLabel: { ...typography.control, color: palette.ink, textAlign: "center" },
  reject: { color: palette.danger },
  disabled: { opacity: 0.5 },
  detailsButton: { minHeight: 44, justifyContent: "center" },
});
