import Feather from "@expo/vector-icons/Feather";
import type { PermissionReply, PermissionRequest } from "@opencode2-mobile/opencode-adapter";
import { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextLayoutEventData,
  useWindowDimensions,
  View,
} from "react-native";
import { Button } from "../components/button";
import { ModalSheet } from "../components/modal-sheet";
import { requestCardStyles } from "../components/request-card-styles";
import { useAnnouncement } from "../components/use-announcement";
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
import { permissionActionExplanation, permissionActionHeading } from "./permission-presentation";
import { sanitizeTranscriptText } from "./session-transcript-model";

const inlineResourceCount = 2;
const commandPreviewLines = 6;
const commandPreviewCharacters = 1_024;
const replyErrorMessage =
  "The server did not accept that reply. Review the refreshed request and try again.";

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
  const patterns = (request.save ?? []).map((pattern) => sanitizeTranscriptText(pattern, 256));
  const explanation = permissionActionExplanation(request.action);
  const shell = request.action === "shell";
  const heading = permissionActionHeading(request.action, request.resources.length);
  const action = heading?.label ?? `Call tool ${sanitizeTranscriptText(request.action, 256)}`;
  const fullCommand = shell ? sanitizeTranscriptText(request.resources.join("\n")) : "";
  const commandPreview = shell
    ? sanitizeTranscriptText(request.resources.join("\n"), commandPreviewCharacters)
    : "";
  const [commandCutOff, setCommandCutOff] = useState(
    () =>
      commandPreview.length < fullCommand.length ||
      commandPreview.split("\n").length > commandPreviewLines,
  );
  useAnnouncement(replying && "Sending permission reply…");
  useAnnouncement(error && replyErrorMessage);

  function reply(value: PermissionReply) {
    setDetails(false);
    onReply(request.id, request.sessionID, value);
  }

  function confirmAlways() {
    Alert.alert(
      "Always allow?",
      patterns.length > 0
        ? `Future requests that match ${patterns.length === 1 ? "this pattern" : "these patterns"} will be allowed without asking:\n\n${patterns.join("\n")}`
        : "Future requests that match this one will be allowed without asking.",
      [
        { style: "cancel", text: "Cancel" },
        { onPress: () => reply("always"), text: "Always allow" },
      ],
    );
  }

  function measureCommand(event: { nativeEvent: TextLayoutEventData }) {
    const { lines } = event.nativeEvent;
    const shown = lines
      .slice(0, commandPreviewLines)
      .map((line) => line.text)
      .join("")
      .replace(/\s/g, "");
    setCommandCutOff(
      lines.length > commandPreviewLines ||
        commandPreview.length < fullCommand.length ||
        shown.length < commandPreview.replace(/\s/g, "").length,
    );
  }

  const actions = (
    <View style={styles.replyGroup}>
      <View style={[styles.actions, largeText && styles.actionsLarge]}>
        <Button
          label="Reject"
          variant="danger"
          align={largeText ? "stretch" : "start"}
          accessibilityHint="Reject this request; other pending requests in this session may also be rejected"
          disabled={replying}
          onPress={() => reply("reject")}
          style={!largeText && styles.reject}
        />
        <Button
          label="Allow once"
          variant="primary"
          align={largeText ? "stretch" : "start"}
          accessibilityHint="Allow this request one time"
          disabled={replying}
          onPress={() => reply("once")}
          style={!largeText && styles.allowOnce}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          patterns.length > 0
            ? `Always allow ${patterns[0]}${patterns.length > 1 ? ` and ${patterns.length - 1} more` : ""}`
            : "Always allow"
        }
        accessibilityHint="Asks for confirmation before saving the permission"
        accessibilityState={{ disabled: replying }}
        android_ripple={Platform.OS === "android" ? ripple : undefined}
        disabled={replying}
        onPress={confirmAlways}
        style={({ pressed }) => [
          styles.alwaysRow,
          pressed && Platform.OS === "ios" && styles.pressed,
          replying && styles.disabled,
        ]}
      >
        <Text dynamicTypeRamp={typeRamp.subheadline} numberOfLines={1} style={styles.alwaysLabel}>
          Always allow
          {patterns.length > 0 ? (
            <>
              {" "}
              <Text style={styles.alwaysPattern}>{patterns[0]}</Text>…
              {patterns.length > 1 ? ` +${patterns.length - 1}` : ""}
            </>
          ) : (
            "…"
          )}
        </Text>
        <Feather accessible={false} name="chevron-right" size={16} color={palette.dim} />
      </Pressable>
    </View>
  );
  const hiddenResources = request.resources.length - inlineResourceCount;
  const resources = request.resources.map((resource) => (
    <View key={resource} style={styles.commandBox}>
      <Text selectable style={[styles.command, styles.commandPadding]}>
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
              {pattern}
            </Text>
          ))}
        </View>
      </View>
    ) : null;
  return (
    <View style={styles.card}>
      <View style={styles.eyebrowRow}>
        <Feather accessible={false} name={heading?.icon ?? "tool"} size={14} color={palette.warm} />
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
          android_ripple={Platform.OS === "android" ? ripple : undefined}
          onPress={() => setDetails(true)}
          style={({ pressed }) => [
            styles.detailsButton,
            pressed && Platform.OS === "ios" && styles.pressed,
          ]}
        >
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.details}>
            Details
          </Text>
          <Feather accessible={false} name="chevron-right" size={14} color={palette.dim} />
        </Pressable>
      </View>
      {shell ? (
        <View style={styles.commandGroup}>
          <View style={[styles.commandBox, styles.commandPadding]}>
            <Text
              selectable
              numberOfLines={commandPreviewLines}
              onTextLayout={measureCommand}
              style={styles.command}
            >
              {commandPreview}
            </Text>
          </View>
          {commandCutOff ? (
            <Button
              label="Show full command"
              variant="text"
              accessibilityHint="Opens the full command in Details"
              onPress={() => setDetails(true)}
            />
          ) : null}
        </View>
      ) : request.resources.length > 0 ? (
        <View style={[styles.commandBox, styles.commandPadding]}>
          {request.resources.slice(0, inlineResourceCount).map((resource) => (
            <Text key={resource} selectable style={styles.command}>
              {sanitizeTranscriptText(resource, 512)}
            </Text>
          ))}
          {hiddenResources > 0 ? (
            <Text dynamicTypeRamp={typeRamp.footnote} style={styles.footnote}>
              +{hiddenResources} more
            </Text>
          ) : null}
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
          {replyErrorMessage}
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
        {actions}
      </ModalSheet>
    </View>
  );
}

const ripple = { color: "rgba(255,255,255,0.12)" };

const styles = StyleSheet.create({
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  eyebrow: { ...typography.sectionLabel, color: palette.warm, flexShrink: 1 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  headingTitle: { flex: 1 },
  card: requestCardStyles.card,
  title: { ...typography.headline, color: palette.ink },
  commandGroup: { alignItems: "flex-start", gap: space.xs },
  commandBox: {
    alignSelf: "stretch",
    backgroundColor: palette.background,
    borderRadius: radius.sm,
  },
  commandPadding: { gap: 2, padding: space.sm },
  command: { ...typography.code, color: markdownPalette.code },
  scope: { gap: space.xs },
  pattern: {
    ...typography.code,
    color: palette.ink,
  },
  details: { ...typography.subheadline, color: palette.dim },
  footnote: { ...typography.footnote, color: palette.dim },
  sectionLabel: { ...typography.sectionLabel, color: palette.dim },
  copy: { ...typography.subheadline, color: palette.dim },
  replyGroup: { gap: space.xs },
  actions: { ...requestCardStyles.actions, flexWrap: "nowrap" },
  actionsLarge: { flexDirection: "column" },
  reject: { minWidth: 104 },
  allowOnce: { flexGrow: 1 },
  alwaysRow: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: space.xs,
    minHeight: minTouchTarget,
    overflow: "hidden",
  },
  alwaysLabel: { ...typography.subheadline, color: palette.ink, flex: 1 },
  alwaysPattern: { fontFamily: typography.code.fontFamily, color: palette.dim },
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
