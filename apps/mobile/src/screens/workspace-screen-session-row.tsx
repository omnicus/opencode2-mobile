import Feather from "@expo/vector-icons/Feather";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import {
  type AccessibilityActionEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { ProjectAvatar } from "../components/project-avatar";
import { type FollowedInboxRow, workingSince } from "../state/followed-project-inbox";
import {
  minTouchTarget,
  palette,
  pressedOpacity,
  rippleFeedback,
  space,
  typeRamp,
  typography,
} from "../theme";
import { formatElapsed, inboxStatusLabels, sessionTimeDescription } from "./workspace-screen-model";

const rowRipple = rippleFeedback.row;

type SessionRowHandlers = {
  onActions: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onPress: () => void;
};

export function SessionRow({
  branch,
  largeText,
  onActions,
  onArchive,
  onDelete,
  onPress,
  row,
}: SessionRowHandlers & {
  branch: string | undefined;
  largeText: boolean;
  row: FollowedInboxRow;
}) {
  const title = row.session.title || "Untitled session";
  const archiveLabel = row.archived ? "Unarchive" : "Archive";
  return (
    <ReanimatedSwipeable
      containerStyle={styles.swipeContainer}
      enableTrackpadTwoFingerGesture
      onSwipeableWillOpen={() => {
        void Haptics.selectionAsync().catch(() => undefined);
      }}
      overshootRight={false}
      renderRightActions={(_progress, _translation, swipeable) => (
        <Pressable
          accessibilityLabel={`${archiveLabel} ${title}`}
          accessibilityRole="button"
          android_ripple={rowRipple}
          onPress={() => {
            swipeable.close();
            onArchive();
          }}
          style={({ pressed }) => [
            styles.swipeArchive,
            pressed && Platform.OS === "ios" && styles.pressed,
          ]}
        >
          <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.swipeArchiveLabel}>
            {archiveLabel}
          </Text>
        </Pressable>
      )}
    >
      <Pressable
        accessibilityActions={[
          { name: "activate" },
          { label: `${archiveLabel} session`, name: "archive" },
          { label: "Delete session", name: "delete" },
          { label: "Session actions", name: "options" },
        ]}
        accessibilityHint="Opens the session. Long press for more actions"
        accessibilityLabel={sessionAccessibilityLabel(row, branch)}
        accessibilityRole="button"
        android_ripple={rowRipple}
        onAccessibilityAction={({ nativeEvent }: AccessibilityActionEvent) =>
          runSessionRowAction(nativeEvent.actionName, { onActions, onArchive, onDelete, onPress })
        }
        onPress={onPress}
        onLongPress={onActions}
        style={({ pressed }) => [
          styles.sessionRow,
          pressed && Platform.OS === "ios" && styles.pressed,
        ]}
      >
        <SessionRowSummary branch={branch} largeText={largeText} row={row} title={title} />
      </Pressable>
    </ReanimatedSwipeable>
  );
}

export function runSessionRowAction(actionName: string, handlers: SessionRowHandlers) {
  if (actionName === "activate") handlers.onPress();
  if (actionName === "archive") handlers.onArchive();
  if (actionName === "delete") handlers.onDelete();
  if (actionName === "options") handlers.onActions();
}

function SessionRowSummary({
  branch,
  largeText,
  row,
  title,
}: {
  branch: string | undefined;
  largeText: boolean;
  row: FollowedInboxRow;
  title: string;
}) {
  const { fontScale } = useWindowDimensions();
  // Rows recede once read so unread results stand out, as on OpenCode desktop.
  const unread = row.status !== "ready" && row.status !== "working";
  const detail = branch ?? row.worktreeLabel;
  return (
    <View
      style={[
        styles.sessionCopy,
        row.status === "working" && styles.sessionWorking,
        row.archived && styles.sessionArchived,
      ]}
      testID="session-row-copy"
    >
      {/* The project and status line, then the title, then the branch. */}
      <View style={styles.sessionMeta}>
        <ProjectAvatar
          icon={row.projectIcon}
          lineHeight={typography.footnote.lineHeight * fontScale}
          name={row.projectLabel}
          size={16}
        />
        <Text dynamicTypeRamp={typeRamp.footnote} numberOfLines={1} style={styles.sessionProject}>
          {row.projectLabel}
        </Text>
        <View style={styles.sessionTrailing} testID="session-row-trailing">
          <SessionStatus row={row} />
        </View>
      </View>
      <Text
        dynamicTypeRamp={typeRamp.body}
        numberOfLines={largeText ? 3 : 1}
        style={[styles.sessionTitle, unread ? styles.sessionTitleUnread : styles.sessionTitleRead]}
      >
        {title}
      </Text>
      {detail ? (
        <View style={styles.sessionDetail} testID="session-row-branch">
          <Feather
            accessible={false}
            color={palette.dim}
            name="git-branch"
            size={13 * Math.min(fontScale, 2)}
          />
          <Text
            dynamicTypeRamp={typeRamp.footnote}
            numberOfLines={largeText ? 2 : 1}
            style={styles.sessionDetailText}
          >
            {detail}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Waiting rows name what they wait for, working rows how long the run has taken, and finished
// rows whether their last run was read.
function SessionStatus({ row }: { row: FollowedInboxRow }) {
  if (row.status === "working") return <WorkingStatus since={workingSince(row.session)} />;
  if (row.status === "ready") {
    return (
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.sessionTime}>
        {formatElapsed(Date.now() - (row.session.time.idle ?? row.session.time.updated), false)}
      </Text>
    );
  }
  return (
    <Text
      dynamicTypeRamp={typeRamp.footnote}
      style={[styles.sessionStatus, statusStyles[row.status]]}
      testID={`session-row-status-${row.status}`}
    >
      {inboxStatusLabels[row.status]}
    </Text>
  );
}

// Ticks once a second. Screen readers hear only "Working", not every new duration.
function WorkingStatus({ since }: { since: number | undefined }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [since]);
  return (
    <Text
      accessibilityLabel={inboxStatusLabels.working}
      dynamicTypeRamp={typeRamp.footnote}
      style={[styles.sessionStatus, statusStyles.working]}
      testID="session-row-status-working"
    >
      {since === undefined
        ? inboxStatusLabels.working
        : `${inboxStatusLabels.working} ${formatElapsed(now - since, true)}`}
    </Text>
  );
}

export function sessionAccessibilityLabel(row: FollowedInboxRow, branch: string | undefined) {
  const { session } = row;
  const states = [
    row.projectLabel,
    branch ? `Branch ${branch}` : row.worktreeLabel ? `Worktree ${row.worktreeLabel}` : undefined,
    row.status === "ready" ? undefined : inboxStatusLabels[row.status],
    row.status === "done" || row.status === "failed" ? "Unread" : undefined,
    row.archived ? "Archived" : undefined,
    sessionTimeDescription(session.time.idle ?? session.time.updated),
  ].filter(Boolean);
  return `Open session ${session.title || "Untitled session"}${states.length > 0 ? `. ${states.join(". ")}` : ""}`;
}

const styles = StyleSheet.create({
  pressed: { opacity: pressedOpacity },
  sessionArchived: { opacity: 0.5 },
  sessionCopy: { flex: 1, gap: 2, minWidth: 0 },
  sessionDetail: { alignItems: "center", flexDirection: "row", gap: space.xs / 2 },
  sessionDetailText: { ...typography.footnote, color: palette.dim, flexShrink: 1 },
  sessionMeta: { alignItems: "center", flexDirection: "row", gap: space.xs },
  sessionProject: { ...typography.footnote, color: palette.dim, flexShrink: 1 },
  sessionRow: {
    backgroundColor: palette.background,
    flexDirection: "row",
    minHeight: minTouchTarget,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  sessionStatus: { ...typography.footnote },
  sessionTime: { ...typography.footnote, color: palette.dim },
  sessionTitle: { ...typography.body, minWidth: 0 },
  sessionTitleRead: { color: palette.dim },
  // Headline is the body size at semibold.
  sessionTitleUnread: { ...typography.headline, color: palette.ink },
  sessionTrailing: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    justifyContent: "flex-end",
    marginLeft: "auto",
  },
  sessionWorking: { opacity: 0.7 },
  swipeArchive: {
    alignItems: "center",
    backgroundColor: palette.accent,
    justifyContent: "center",
    minWidth: 96,
    paddingHorizontal: space.sm,
  },
  swipeArchiveLabel: { ...typography.sectionLabel, color: palette.background },
  swipeContainer: { backgroundColor: palette.background },
});

const statusStyles = StyleSheet.create({
  approval: { color: palette.warm },
  done: { color: palette.success },
  failed: { color: palette.danger },
  input: { color: palette.warm },
  working: { color: palette.info },
});
