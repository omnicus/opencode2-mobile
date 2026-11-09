import Feather from "@expo/vector-icons/Feather";
import { type FileDiffInfo, getOpenCodeVcsDiff } from "@opencode2-mobile/opencode-adapter";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { type RefObject, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../components/button";
import { CopyTextButton } from "../components/copy-text-button";
import { ModalSheet } from "../components/modal-sheet";
import type { RootStackParamList } from "../navigation/root-navigation";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import {
  diffPalette,
  palette,
  pressedOpacity,
  rippleFeedback,
  space,
  typeRamp,
  typography,
} from "../theme";
import { sanitizeTranscriptText } from "./session-transcript-model";

type Props = NativeStackScreenProps<RootStackParamList, "Diff">;
type DiffRow =
  | {
      additions: number;
      deletions: number;
      file: string;
      key: string;
      status: FileDiffInfo["status"];
      type: "file";
    }
  | {
      key: string;
      kind: "addition" | "deletion" | "hunk" | "meta" | "plain";
      text: string;
      type: "line";
    };

const maxDiffFiles = 500;
const maxDiffLines = 20_000;
const maxDiffLineCharacters = 4_000;

export function DiffScreen({ route }: Props) {
  return <SessionChanges {...route.params} />;
}

export function SessionChanges({
  connectionId: routeConnectionId,
  location,
  mode,
}: RootStackParamList["Diff"]) {
  const runtime = useConnectionRuntime();
  const client = runtime.restClient;
  const connectedToRoute = runtime.connectionId === routeConnectionId;
  const query = useQuery({
    enabled: Boolean(client && connectedToRoute),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getOpenCodeVcsDiff(client, location, mode, { context: 5, signal });
    },
    queryKey: openCodeQueryKeys.vcsDiff(routeConnectionId, location, mode),
  });
  const files = connectedToRoute ? (query.data?.data ?? []) : [];
  const scope = JSON.stringify([routeConnectionId, location, mode]);
  const [expansion, setExpansion] = useState<{ scope: string; files: Set<string> }>({
    scope,
    files: new Set(),
  });
  const expanded = expansion.scope === scope ? expansion.files : new Set<string>();
  const rows = useMemo(() => buildDiffRows(files, expanded), [files, expanded]);
  const canExpandAll =
    files.length > 1 &&
    files.length <= 20 &&
    files.reduce((total, file) => total + file.patch.length, 0) <= 200_000;
  const [focus, setFocus] = useState<{ scope: string; file: string; open: boolean }>();
  const fileTriggerRef = useRef<View>(null);
  const focusedFile =
    focus?.scope === scope ? files.find((file) => file.file === focus.file) : undefined;

  return (
    <>
      <FlatList
        accessibilityLabel="Current working tree changes"
        contentContainerStyle={rows.length === 0 ? styles.emptyContent : styles.content}
        data={rows}
        initialNumToRender={40}
        keyExtractor={(row) => row.key}
        ListEmptyComponent={
          // A plain element, not a wrapper component, so the list can attach its layout handler.
          renderDiffEmptyState({
            connected: connectedToRoute,
            isError: query.isError,
            isPending: query.isPending,
            onRetry: () => void query.refetch(),
          })
        }
        ListHeaderComponent={
          rows.length > 0 ? (
            <DiffSummary
              canExpandAll={canExpandAll}
              expandedCount={expanded.size}
              files={files}
              isError={query.isError}
              onRetry={() => void query.refetch()}
              onToggleAll={() =>
                setExpansion({
                  scope,
                  files: expanded.size > 0 ? new Set() : new Set(files.map((file) => file.file)),
                })
              }
            />
          ) : null
        }
        maxToRenderPerBatch={60}
        refreshControl={
          <RefreshControl
            colors={[palette.signal]}
            onRefresh={() => void query.refetch()}
            progressBackgroundColor={palette.card}
            refreshing={query.isRefetching}
            tintColor={palette.signal}
          />
        }
        renderItem={({ item }) =>
          item.type === "file" ? (
            <DiffFileHeader
              buttonRef={focus?.file === item.file ? fileTriggerRef : undefined}
              row={item}
              onPress={() => setFocus({ scope, file: item.file, open: true })}
            />
          ) : (
            <DiffLine row={item} />
          )
        }
        updateCellsBatchingPeriod={40}
        windowSize={9}
      />
      <FocusedFileSheet
        file={focusedFile}
        onClose={() => setFocus((current) => (current ? { ...current, open: false } : current))}
        returnFocusRef={fileTriggerRef}
        visible={Boolean(focus?.open && focusedFile)}
      />
    </>
  );
}

function renderDiffEmptyState({
  connected,
  isError,
  isPending,
  onRetry,
}: {
  connected: boolean;
  isError: boolean;
  isPending: boolean;
  onRetry: () => void;
}) {
  if (!connected) {
    return (
      <DiffState
        detail="Return to the matching connection to review these changes."
        title="Connection unavailable"
      />
    );
  }
  if (isPending) {
    return (
      <ActivityIndicator accessibilityLabel="Loading current changes" color={palette.signal} />
    );
  }
  if (isError) {
    return (
      <DiffState
        action="Retry"
        detail="The current working-tree diff could not be loaded."
        onPress={onRetry}
        title="Changes unavailable"
      />
    );
  }
  return <DiffState detail="The working tree has no uncommitted changes." title="No changes" />;
}

function DiffSummary({
  canExpandAll,
  expandedCount,
  files,
  isError,
  onRetry,
  onToggleAll,
}: {
  canExpandAll: boolean;
  expandedCount: number;
  files: FileDiffInfo[];
  isError: boolean;
  onRetry: () => void;
  onToggleAll: () => void;
}) {
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  return (
    <View style={styles.summary}>
      <Text accessibilityRole="header" dynamicTypeRamp={typeRamp.headline} style={styles.title}>
        {files.length} {files.length === 1 ? "file" : "files"}
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.totals}>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.additions}>
          +{additions}
        </Text>
        {"  "}
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.deletions}>
          -{deletions}
        </Text>
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.explanation}>
        Uncommitted changes in the working tree right now, including edits made after any tool call.
      </Text>
      {isError ? (
        <DiffState
          title="Refresh failed"
          detail="Showing the last loaded changes."
          action="Retry"
          onPress={onRetry}
        />
      ) : null}
      {expandedCount > 0 || canExpandAll ? (
        <Button
          label={expandedCount > 0 ? "Collapse all" : "Expand all"}
          onPress={onToggleAll}
          variant="text"
        />
      ) : null}
    </View>
  );
}

function FocusedFileSheet({
  file,
  onClose,
  returnFocusRef,
  visible,
}: {
  file: FileDiffInfo | undefined;
  onClose: () => void;
  returnFocusRef: RefObject<View | null>;
  visible: boolean;
}) {
  const rows = useMemo(
    () =>
      file ? buildDiffRows([file], new Set([file.file])).filter((row) => row.type === "line") : [],
    [file],
  );
  return (
    <ModalSheet
      title="File changes"
      subtitle={file ? sanitizeTranscriptText(file.file, 1024) : ""}
      visible={visible}
      onClose={onClose}
      size="full"
      scrollable={false}
      returnFocusRef={returnFocusRef}
    >
      {file ? (
        <View style={styles.focusedSummary}>
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.totals}>
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.additions}>
              +{file.additions}
            </Text>
            {"  "}
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.deletions}>
              -{file.deletions}
            </Text>
            {" · "}
            {file.status.charAt(0).toLocaleUpperCase() + file.status.slice(1)}
          </Text>
          {file.patch.trim() ? <CopyTextButton label="Copy patch" text={file.patch} /> : null}
        </View>
      ) : null}
      <FlatList
        accessibilityLabel="Focused file diff"
        data={rows}
        keyExtractor={(row) => row.key}
        initialNumToRender={40}
        maxToRenderPerBatch={60}
        windowSize={9}
        renderItem={({ item }) => (item.type === "line" ? <DiffLine row={item} /> : null)}
      />
    </ModalSheet>
  );
}

function DiffFileHeader({
  row,
  onPress,
  buttonRef,
}: {
  row: Extract<DiffRow, { type: "file" }>;
  onPress: () => void;
  buttonRef?: RefObject<View | null> | undefined;
}) {
  const path = sanitizeTranscriptText(row.file, 1_024);
  const separator = path.lastIndexOf("/");
  return (
    <Pressable
      ref={buttonRef}
      accessibilityHint="Opens the changes for this file"
      accessibilityRole="button"
      accessibilityLabel={`${row.status} file, ${path}, ${row.additions} additions, ${row.deletions} deletions`}
      android_ripple={rippleFeedback.row}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fileHeader,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
    >
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.fileName}>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.fileParent}>
          {path.slice(0, separator + 1)}
        </Text>
        {path.slice(separator + 1)}
      </Text>
      <View style={styles.fileMeta}>
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.fileStatus}>
          {row.status.charAt(0).toLocaleUpperCase() + row.status.slice(1)}
        </Text>
        <Text dynamicTypeRamp={typeRamp.footnote} style={[styles.count, styles.additions]}>
          +{row.additions}
        </Text>
        <Text dynamicTypeRamp={typeRamp.footnote} style={[styles.count, styles.deletions]}>
          -{row.deletions}
        </Text>
        <Feather
          accessible={false}
          color={palette.dim}
          name="chevron-right"
          size={16}
          style={styles.fileOpen}
        />
      </View>
    </Pressable>
  );
}

function DiffLine({ row }: { row: Extract<DiffRow, { type: "line" }> }) {
  return (
    <Text
      dynamicTypeRamp={typeRamp.body}
      selectable
      accessibilityLabel={`${row.kind === "addition" ? "Added line" : row.kind === "deletion" ? "Removed line" : row.kind === "hunk" ? "Diff hunk" : row.kind === "plain" ? "Context line" : "Diff information"}: ${row.text}`}
      style={[
        styles.line,
        row.kind === "addition" && styles.lineAddition,
        row.kind === "deletion" && styles.lineDeletion,
        row.kind === "hunk" && styles.lineHunk,
        row.kind === "meta" && styles.lineMeta,
      ]}
    >
      {row.text}
    </Text>
  );
}

function DiffState({
  action,
  detail,
  onPress,
  title,
}: {
  action?: string;
  detail: string;
  onPress?: () => void;
  title: string;
}) {
  return (
    <View style={styles.state}>
      <Text
        accessibilityRole="header"
        dynamicTypeRamp={typeRamp.headline}
        style={styles.stateTitle}
      >
        {title}
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateDetail}>
        {detail}
      </Text>
      {action && onPress ? <Button label={action} onPress={onPress} variant="text" /> : null}
    </View>
  );
}

export function buildDiffRows(files: FileDiffInfo[], expanded?: ReadonlySet<string>) {
  const rows: DiffRow[] = [];
  let lineCount = 0;
  const visibleFiles = files.slice(0, maxDiffFiles);
  for (const [fileIndex, file] of visibleFiles.entries()) {
    rows.push({
      additions: file.additions,
      deletions: file.deletions,
      file: file.file,
      key: `file:${fileIndex}:${file.file}`,
      status: file.status,
      type: "file",
    });
    if (expanded && !expanded.has(file.file)) continue;
    if (!file.patch.trim()) {
      rows.push({
        key: `unavailable:${fileIndex}`,
        kind: "meta",
        type: "line",
        text: "Diff unavailable for this file.",
      });
      continue;
    }
    if (lineCount >= maxDiffLines) continue;
    for (const [lineIndex, line] of file.patch.split(/\r?\n/).entries()) {
      if (lineCount >= maxDiffLines) break;
      rows.push({
        key: `line:${fileIndex}:${lineIndex}`,
        kind: diffLineKind(line),
        text: sanitizeTranscriptText(line, maxDiffLineCharacters),
        type: "line",
      });
      lineCount += 1;
    }
  }
  if (files.length > visibleFiles.length || lineCount >= maxDiffLines) {
    rows.push({
      key: "line:omitted",
      kind: "meta",
      text: "Additional diff content omitted on this device.",
      type: "line",
    });
  }
  return rows;
}

function diffLineKind(line: string): Extract<DiffRow, { type: "line" }>["kind"] {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) return "meta";
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "deletion";
  return "plain";
}

const styles = StyleSheet.create({
  additions: { color: diffPalette.addedText },
  content: { paddingBottom: space.xl },
  count: { ...typography.footnote, fontFamily: typography.code.fontFamily },
  deletions: { color: diffPalette.removedText },
  emptyContent: { flexGrow: 1, justifyContent: "center", padding: space.lg },
  explanation: { ...typography.footnote, color: palette.dim },
  fileHeader: {
    backgroundColor: palette.card,
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    borderTopColor: palette.border,
    borderTopWidth: 1,
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  fileMeta: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  focusedSummary: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    justifyContent: "space-between",
  },
  fileOpen: { marginLeft: "auto" },
  fileParent: { color: palette.dim },
  fileName: { ...typography.code, color: palette.ink },
  fileStatus: { ...typography.sectionLabel, color: palette.dim },
  line: {
    ...typography.code,
    color: diffPalette.contextText,
    paddingHorizontal: space.md,
    paddingVertical: 1,
  },
  lineAddition: { backgroundColor: diffPalette.addedBackground, color: diffPalette.addedText },
  lineDeletion: { backgroundColor: diffPalette.removedBackground, color: diffPalette.removedText },
  lineHunk: { color: diffPalette.hunkHeader, marginTop: space.xs },
  lineMeta: { color: palette.dim },
  pressed: { opacity: pressedOpacity },
  // Centered like the other empty and error states.
  state: {
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
  },
  stateDetail: { ...typography.subheadline, color: palette.dim, textAlign: "center" },
  stateTitle: { ...typography.headline, color: palette.ink, textAlign: "center" },
  summary: { gap: space.xs, padding: space.md },
  title: { ...typography.headline, color: palette.ink },
  totals: { ...typography.code, color: palette.dim },
});
