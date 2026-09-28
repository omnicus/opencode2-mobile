import { type FileDiffInfo, getOpenCodeVcsDiff } from "@opencode2-mobile/opencode-adapter";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { RootStackParamList } from "../navigation/root-navigation";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { diffPalette, palette, space, typeRamp, typography } from "../theme";
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
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  return (
    <FlatList
      accessibilityLabel="Current working tree changes"
      contentContainerStyle={rows.length === 0 ? styles.emptyContent : styles.content}
      data={rows}
      initialNumToRender={40}
      keyExtractor={(row) => row.key}
      ListEmptyComponent={
        !connectedToRoute ? (
          <DiffState
            detail="Return to the matching connection to review these changes."
            title="Connection unavailable"
          />
        ) : query.isPending ? (
          <ActivityIndicator accessibilityLabel="Loading current changes" color={palette.signal} />
        ) : query.isError ? (
          <DiffState
            action="Try again"
            detail="The current working-tree diff could not be loaded."
            onPress={() => void query.refetch()}
            title="Changes unavailable"
          />
        ) : (
          <DiffState detail="The working tree has no uncommitted changes." title="No changes" />
        )
      }
      ListHeaderComponent={
        rows.length > 0 ? (
          <View style={styles.summary}>
            <Text
              accessibilityRole="header"
              dynamicTypeRamp={typeRamp.subheading}
              style={styles.title}
            >
              {files.length} {files.length === 1 ? "file" : "files"}
            </Text>
            <Text dynamicTypeRamp={typeRamp.control} style={styles.totals}>
              <Text style={styles.additions}>+{additions}</Text>
              {"  "}
              <Text style={styles.deletions}>-{deletions}</Text>
            </Text>
            <Text dynamicTypeRamp={typeRamp.control} style={styles.explanation}>
              Current working tree. This may include changes made after the selected tool call.
            </Text>
            {query.isError ? (
              <DiffState
                title="Refresh failed"
                detail="Showing the last loaded changes."
                action="Retry"
                onPress={() => void query.refetch()}
              />
            ) : null}
            {expanded.size > 0 || canExpandAll ? (
              <Pressable
                accessibilityRole="button"
                style={styles.retry}
                onPress={() =>
                  setExpansion({
                    scope,
                    files: expanded.size > 0 ? new Set() : new Set(files.map((file) => file.file)),
                  })
                }
              >
                <Text style={styles.retryLabel}>
                  {expanded.size > 0 ? "Collapse all" : "Expand all"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null
      }
      maxToRenderPerBatch={60}
      refreshControl={
        <RefreshControl
          onRefresh={() => void query.refetch()}
          refreshing={query.isRefetching}
          tintColor={palette.signal}
        />
      }
      renderItem={({ item }) =>
        item.type === "file" ? (
          <DiffFileHeader
            row={item}
            expanded={expanded.has(item.file)}
            onPress={() =>
              setExpansion({
                scope,
                files: expanded.has(item.file) ? new Set() : new Set([item.file]),
              })
            }
          />
        ) : (
          <DiffLine row={item} />
        )
      }
      updateCellsBatchingPeriod={40}
      windowSize={9}
    />
  );
}

function DiffFileHeader({
  row,
  expanded,
  onPress,
}: {
  row: Extract<DiffRow, { type: "file" }>;
  expanded: boolean;
  onPress: () => void;
}) {
  const path = sanitizeTranscriptText(row.file, 1_024);
  const separator = path.lastIndexOf("/");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${row.status} file, ${path}, ${row.additions} additions, ${row.deletions} deletions`}
      onPress={onPress}
      style={({ pressed }) => [styles.fileHeader, pressed && styles.pressed]}
    >
      <Text dynamicTypeRamp={typeRamp.control} style={styles.fileName}>
        <Text style={styles.fileParent}>{path.slice(0, separator + 1)}</Text>
        {path.slice(separator + 1)}
      </Text>
      <View style={styles.fileMeta}>
        <Text accessible={false} style={styles.fileStatus}>
          {expanded ? "⌄" : "›"}
        </Text>
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.fileStatus}>
          {row.status.toLocaleUpperCase()}
        </Text>
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.additions}>
          +{row.additions}
        </Text>
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.deletions}>
          -{row.deletions}
        </Text>
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
        dynamicTypeRamp={typeRamp.subheading}
        style={styles.stateTitle}
      >
        {title}
      </Text>
      <Text dynamicTypeRamp={typeRamp.body} style={styles.stateDetail}>
        {detail}
      </Text>
      {action && onPress ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text dynamicTypeRamp={typeRamp.control} style={styles.retryLabel}>
            {action}
          </Text>
        </Pressable>
      ) : null}
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
  additions: { color: diffPalette.addedText, fontWeight: "800" },
  content: { paddingBottom: space.xl },
  deletions: { color: diffPalette.removedText, fontWeight: "800" },
  emptyContent: { flexGrow: 1, justifyContent: "center", padding: space.lg },
  explanation: { color: palette.dim, fontSize: 12, lineHeight: 18 },
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
  fileMeta: { flexDirection: "row", gap: space.sm },
  fileParent: { color: palette.dim, fontWeight: "400" },
  fileName: { ...typography.code, color: palette.ink, fontWeight: "600" },
  fileStatus: { ...typography.label, color: palette.dim },
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
  pressed: { opacity: 0.7 },
  retry: { justifyContent: "center", minHeight: 44, paddingRight: space.md },
  retryLabel: { color: palette.signal, fontSize: 13, fontWeight: "700" },
  state: { gap: space.sm },
  stateDetail: { color: palette.dim, fontSize: 15, lineHeight: 22 },
  stateTitle: { ...typography.heading, color: palette.ink },
  summary: { gap: space.xs, padding: space.md },
  title: { ...typography.heading, color: palette.ink },
  totals: { ...typography.code },
});
