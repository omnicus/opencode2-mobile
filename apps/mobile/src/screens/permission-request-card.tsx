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
import { applicationName } from "../application-name";
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
  rippleColor,
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
  // The card previews short patterns; Details and the confirmation show them in full.
  const patterns = (request.save ?? []).map((pattern) => sanitizeTranscriptText(pattern, 256));
  const fullPatterns = (request.save ?? []).map((pattern) =>
    sanitizeTranscriptText(pattern, pattern.length),
  );
  const shell = request.action === "shell";
  const heading = permissionActionHeading(request.action, request.resources.length);
  const action = heading?.label ?? `Call tool ${sanitizeTranscriptText(request.action, 256)}`;
  const command = useCommandPreview(request.resources, shell);
  useAnnouncement(replying && "Sending permission reply…");
  useAnnouncement(error && replyErrorMessage);

  function reply(value: PermissionReply) {
    setDetails(false);
    onReply(request.id, request.sessionID, value);
  }

  function confirmAlways() {
    Alert.alert("Always allow?", alwaysAllowMessage(fullPatterns), [
      { style: "cancel", text: "Cancel" },
      { onPress: () => reply("always"), text: "Always allow" },
    ]);
  }

  const actions = (
    <ReplyActions
      largeText={largeText}
      onAlways={confirmAlways}
      onReply={reply}
      patterns={patterns}
      replying={replying}
    />
  );
  return (
    <View style={styles.card}>
      {/* Same shape as a form card: what kind of request in the eyebrow, what it does as the title. */}
      <View style={styles.eyebrowRow}>
        <Feather accessible={false} name={heading?.icon ?? "tool"} size={14} color={palette.warm} />
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.eyebrow}>
          Permission required
        </Text>
      </View>
      <View style={styles.headingRow}>
        <Text
          accessibilityRole="header"
          dynamicTypeRamp={typeRamp.headline}
          style={[styles.title, styles.headingTitle]}
        >
          {action}
        </Text>
        <DetailsButton onPress={() => setDetails(true)} />
      </View>
      {shell ? (
        <CommandPreview command={command} onShowFull={() => setDetails(true)} />
      ) : (
        <ResourcePreview resources={request.resources} />
      )}
      <ReplyStatus error={error} replying={replying} />
      {actions}
      <ModalSheet title="Permission details" visible={details} onClose={() => setDetails(false)}>
        <Text dynamicTypeRamp={typeRamp.headline} style={styles.title}>
          {action}
        </Text>
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.sectionLabel}>
          {shell ? "Full command" : "Requested resources"}
        </Text>
        {request.resources.map((resource) => (
          <View key={resource} style={[styles.commandBox, styles.commandBoxSheet]}>
            <Text selectable style={[styles.command, styles.commandPadding]}>
              {sanitizeTranscriptText(resource, resource.length)}
            </Text>
          </View>
        ))}
        <SavedPatterns patterns={fullPatterns} />
        <ActionExplanation explanation={permissionActionExplanation(request.action)} />
        {actions}
      </ModalSheet>
    </View>
  );
}

function alwaysAllowMessage(patterns: string[]) {
  if (patterns.length === 0) {
    return "Future requests that match this one will be allowed without asking.";
  }
  const subject = patterns.length === 1 ? "this pattern" : "these patterns";
  return `Future requests that match ${subject} will be allowed without asking. A pattern can cover more than this request.\n\n${patterns.join("\n")}`;
}

function alwaysAllowLabel(patterns: string[]) {
  if (patterns.length === 0) return "Always allow";
  const more = patterns.length > 1 ? ` and ${patterns.length - 1} more` : "";
  return `Always allow ${patterns[0]}${more}`;
}

function useCommandPreview(resources: string[], shell: boolean) {
  const fullCommand = shell ? sanitizeTranscriptText(resources.join("\n")) : "";
  const commandPreview = shell
    ? sanitizeTranscriptText(resources.join("\n"), commandPreviewCharacters)
    : "";
  const [commandCutOff, setCommandCutOff] = useState(
    () =>
      commandPreview.length < fullCommand.length ||
      commandPreview.split("\n").length > commandPreviewLines,
  );

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

  return { commandCutOff, commandPreview, measureCommand };
}

function DetailsButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Details"
      accessibilityHint="Opens the full request, saved permission patterns, and explanation"
      android_ripple={Platform.OS === "android" ? ripple : undefined}
      onPress={onPress}
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
  );
}

function CommandPreview({
  command,
  onShowFull,
}: {
  command: ReturnType<typeof useCommandPreview>;
  onShowFull: () => void;
}) {
  return (
    <View style={styles.commandGroup}>
      <View style={[styles.commandBox, styles.commandPadding]}>
        <Text
          selectable
          numberOfLines={commandPreviewLines}
          onTextLayout={command.measureCommand}
          style={styles.command}
        >
          {command.commandPreview}
        </Text>
      </View>
      {command.commandCutOff ? (
        <Button
          label="Show full command"
          variant="text"
          accessibilityHint="Opens the full command in Details"
          onPress={onShowFull}
        />
      ) : null}
    </View>
  );
}

function ResourcePreview({ resources }: { resources: string[] }) {
  if (resources.length === 0) return null;
  const hiddenResources = resources.length - inlineResourceCount;
  return (
    <View style={[styles.commandBox, styles.commandPadding]}>
      {resources.slice(0, inlineResourceCount).map((resource) => (
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
  );
}

function ReplyStatus({ error, replying }: { error: boolean; replying: boolean }) {
  return (
    <>
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
    </>
  );
}

function ReplyActions({
  largeText,
  onAlways,
  onReply,
  patterns,
  replying,
}: {
  largeText: boolean;
  onAlways: () => void;
  onReply: (reply: PermissionReply) => void;
  patterns: string[];
  replying: boolean;
}) {
  const align = largeText ? "stretch" : "start";
  return (
    <View style={styles.replyGroup}>
      {/* The spec asks for this before Reject, so it sits beside the action, not only in Details. */}
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.footnote}>
        Reject may also reject other requests in this session.
      </Text>
      <View style={[styles.actions, largeText && styles.actionsLarge]}>
        <Button
          label="Reject"
          variant="danger"
          align={align}
          accessibilityHint="Reject this request; other pending requests in this session may also be rejected"
          disabled={replying}
          onPress={() => onReply("reject")}
          style={!largeText && styles.reject}
        />
        <Button
          label="Allow once"
          variant="primary"
          align={align}
          accessibilityHint="Allow this request one time"
          disabled={replying}
          onPress={() => onReply("once")}
          style={!largeText && styles.allowOnce}
        />
      </View>
      <AlwaysAllowButton onPress={onAlways} patterns={patterns} replying={replying} />
    </View>
  );
}

function AlwaysAllowButton({
  onPress,
  patterns,
  replying,
}: {
  onPress: () => void;
  patterns: string[];
  replying: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={alwaysAllowLabel(patterns)}
      accessibilityHint="Asks for confirmation before saving the permission"
      accessibilityState={{ disabled: replying }}
      android_ripple={Platform.OS === "android" ? ripple : undefined}
      disabled={replying}
      onPress={onPress}
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
  );
}

function SavedPatterns({ patterns }: { patterns: string[] }) {
  if (patterns.length === 0) return null;
  return (
    <View style={styles.scope}>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.footnote}>
        Always allow saves these patterns for future requests. They can cover more than this
        request.
      </Text>
      <View
        accessibilityLabel="Saved permission patterns"
        style={[styles.commandBox, styles.commandBoxSheet]}
      >
        {patterns.map((pattern) => (
          <Text key={pattern} selectable style={[styles.pattern, styles.commandPadding]}>
            {pattern}
          </Text>
        ))}
      </View>
    </View>
  );
}

function ActionExplanation({ explanation }: { explanation: string | undefined }) {
  return explanation ? (
    <View style={styles.scope}>
      <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.sectionLabel}>
        {applicationName} explanation
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
        {explanation}
      </Text>
    </View>
  ) : null;
}

const ripple = { color: rippleColor };

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
  // The Details sheet sits on the page color, so its code boxes use the card color instead.
  commandBoxSheet: { backgroundColor: palette.card },
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
  // A quiet outlined row, so the saved-permission choice reads as a control, not a caption.
  alwaysRow: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.xs,
    minHeight: minTouchTarget,
    overflow: "hidden",
    paddingHorizontal: space.md,
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
