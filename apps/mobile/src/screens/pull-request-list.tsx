import Feather from "@expo/vector-icons/Feather";
import {
  type GitHubPullRequest,
  type GitHubPullRequestList,
  type GitHubPullRequestUnavailableReason,
  listGitHubPullRequests,
  type ProjectListOutput,
} from "@opencode2-mobile/opencode-adapter";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Button } from "../components/button";
import { ProjectAvatar } from "../components/project-avatar";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { labelProject } from "../state/followed-project-inbox";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import {
  minTouchTarget,
  palette,
  pressedOpacity,
  space,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
import { sanitizeTranscriptText } from "./session-transcript-model";
import { formatSessionTime, sessionTimeDescription } from "./workspace-screen-model";

type Project = ProjectListOutput[number];
type ProjectState = "error" | "empty" | "loading" | GitHubPullRequestUnavailableReason;
type ProjectResult = {
  data: GitHubPullRequestList | undefined;
  isError: boolean;
  isPending: boolean;
  refetch: () => unknown;
};

export type PullRequestListItem =
  | { count: number | undefined; key: string; label: string; project: Project; type: "project" }
  | { key: string; projectLabel: string; pullRequest: GitHubPullRequest; type: "pull" }
  | { key: string; onRetry: () => void; state: ProjectState; type: "state" };

const stateCopy: Record<ProjectState, string> = {
  empty: "No open pull requests.",
  error: "Pull requests could not be loaded.",
  failed: "GitHub CLI on the server could not list pull requests.",
  "gh-auth": "GitHub CLI on the server is not signed in. Run gh auth login there.",
  "gh-missing": "GitHub CLI (gh) is not installed on the server.",
  loading: "Checking pull requests",
  "no-github-remote": "This project has no GitHub repository.",
  timeout: "GitHub took too long to answer.",
};
const retryableStates: ReadonlySet<ProjectState> = new Set(["error", "failed", "timeout"]);
const reviewLabels: Record<NonNullable<GitHubPullRequest["reviewDecision"]>, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};
const rowRipple = Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined;

export function pullRequestListItems(
  projects: readonly Project[],
  results: readonly ProjectResult[],
): PullRequestListItem[] {
  return projects.flatMap((project, index): PullRequestListItem[] => {
    const result = results[index];
    const label = labelProject(project, project.id);
    const listed = result?.data?.status === "listed" ? result.data.pullRequests : undefined;
    const header: PullRequestListItem = {
      count: listed?.length,
      key: `project:${project.id}`,
      label,
      project,
      type: "project",
    };
    const state: ProjectState | undefined =
      result?.data?.status === "unavailable"
        ? result.data.reason
        : result?.isError
          ? "error"
          : !result || result.isPending
            ? "loading"
            : listed?.length === 0
              ? "empty"
              : undefined;
    if (state) {
      return [
        header,
        {
          key: `state:${project.id}`,
          onRetry: () => void result?.refetch(),
          state,
          type: "state" as const,
        },
      ];
    }
    return [
      header,
      ...(listed ?? []).map((pullRequest) => ({
        key: `pull:${project.id}:${pullRequest.number}`,
        projectLabel: label,
        pullRequest,
        type: "pull" as const,
      })),
    ];
  });
}

export function PullRequestList({
  active,
  onChooseProjects,
}: {
  active: boolean;
  onChooseProjects: () => void;
}) {
  const runtime = useConnectionRuntime();
  const selection = useWorkspaceSelection();
  const { fontScale } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const [refreshing, setRefreshing] = useState(false);
  const client = runtime.restClient;
  const connectionId = runtime.connectionId;
  const projectsById = new Map(selection.projects.map((project) => [project.id, project]));
  const followed = selection.followedProjectIds.flatMap((id) => {
    const project = projectsById.get(id);
    return project ? [project] : [];
  });
  // Each check runs a command on the server, so nothing starts until the tab is open.
  const results = useQueries({
    queries: followed.map((project) => {
      const location = { directory: project.canonical };
      return {
        enabled: Boolean(active && client && connectionId),
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (!client) throw new Error("CONNECTION_NOT_READY");
          return listGitHubPullRequests(client, location, { signal });
        },
        queryKey: openCodeQueryKeys.pullRequests(connectionId ?? "unselected", location),
        retry: false,
        staleTime: 60_000,
      };
    }),
  });
  const items = pullRequestListItems(followed, results);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all(results.map((result) => result.refetch()));
    } finally {
      setRefreshing(false);
    }
  }

  if (selection.preferencesLoading || (selection.projectsLoading && followed.length === 0)) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator accessibilityLabel="Loading followed projects" color={palette.signal} />
      </View>
    );
  }
  if (followed.length === 0) {
    return (
      <View style={styles.empty}>
        <Feather accessible={false} color={palette.dim} name="git-pull-request" size={36} />
        <Text accessibilityRole="header" dynamicTypeRamp={typeRamp.headline} style={styles.title}>
          No projects followed yet
        </Text>
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
          Open pull requests for the projects you follow show up here.
        </Text>
        <Button align="center" label="Choose projects" onPress={onChooseProjects} />
      </View>
    );
  }

  return (
    <FlatList
      ListHeaderComponent={
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.source}>
          Listed by GitHub CLI on the server.
        </Text>
      }
      contentContainerStyle={styles.listContent}
      data={items}
      extraData={fontScale}
      keyExtractor={(item) => item.key}
      refreshControl={
        <RefreshControl
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          tintColor={palette.signal}
        />
      }
      renderItem={({ item }) =>
        item.type === "project" ? (
          <ProjectHeader count={item.count} label={item.label} project={item.project} />
        ) : item.type === "state" ? (
          <ProjectStateRow onRetry={item.onRetry} state={item.state} />
        ) : (
          <PullRequestRow
            largeText={largeText}
            projectLabel={item.projectLabel}
            pullRequest={item.pullRequest}
          />
        )
      }
    />
  );
}

function ProjectHeader({
  count,
  label,
  project,
}: {
  count: number | undefined;
  label: string;
  project: Project;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      accessibilityRole="header"
      accessible
      style={styles.projectHeader}
    >
      <ProjectAvatar
        icon={project.icon}
        lineHeight={typography.sectionLabel.lineHeight * fontScale}
        name={label}
      />
      <Text dynamicTypeRamp={typeRamp.sectionLabel} numberOfLines={1} style={styles.projectLabel}>
        {label}
      </Text>
      {count !== undefined ? (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.count}>
          {count}
        </Text>
      ) : null}
    </View>
  );
}

function ProjectStateRow({ onRetry, state }: { onRetry: () => void; state: ProjectState }) {
  return (
    <View style={styles.stateRow}>
      {state === "loading" ? (
        <ActivityIndicator accessible={false} color={palette.dim} size="small" />
      ) : null}
      <Text
        accessibilityLiveRegion={state === "loading" ? "none" : "polite"}
        dynamicTypeRamp={typeRamp.footnote}
        style={[styles.stateText, state === "error" && styles.stateError]}
      >
        {stateCopy[state]}
      </Text>
      {retryableStates.has(state) ? (
        <Button label="Retry" onPress={onRetry} size="compact" variant="text" />
      ) : null}
    </View>
  );
}

function PullRequestRow({
  largeText,
  projectLabel,
  pullRequest,
}: {
  largeText: boolean;
  projectLabel: string;
  pullRequest: GitHubPullRequest;
}) {
  const title = sanitizeTranscriptText(pullRequest.title, 512) || `#${pullRequest.number}`;
  const branch = sanitizeTranscriptText(pullRequest.branch, 256);
  const author = pullRequest.author ? sanitizeTranscriptText(pullRequest.author, 64) : undefined;
  const review = pullRequest.reviewDecision ? reviewLabels[pullRequest.reviewDecision] : undefined;
  const details = [`#${pullRequest.number}`, branch, author].filter(Boolean).join(" · ");
  const label = [
    `Pull request ${pullRequest.number}, ${title}`,
    projectLabel,
    pullRequest.draft ? "Draft" : undefined,
    review,
    pullRequest.updatedAtMs === undefined
      ? undefined
      : sessionTimeDescription(pullRequest.updatedAtMs),
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <Pressable
      accessibilityHint="Opens the pull request in the browser"
      accessibilityLabel={label}
      accessibilityRole="link"
      android_ripple={rowRipple}
      onPress={() => void Linking.openURL(pullRequest.url).catch(() => undefined)}
      style={({ pressed }) => [styles.row, pressed && Platform.OS === "ios" && styles.pressed]}
    >
      <Feather
        accessible={false}
        color={pullRequest.draft ? palette.dim : palette.success}
        name="git-pull-request"
        size={18}
        style={styles.rowIcon}
      />
      <View style={styles.rowCopy}>
        <View style={styles.titleRow}>
          <Text
            dynamicTypeRamp={typeRamp.body}
            numberOfLines={largeText ? 3 : 2}
            style={styles.rowTitle}
          >
            {title}
          </Text>
          {pullRequest.updatedAtMs !== undefined ? (
            <Text dynamicTypeRamp={typeRamp.footnote} style={styles.time}>
              {formatSessionTime(pullRequest.updatedAtMs)}
            </Text>
          ) : null}
        </View>
        <Text dynamicTypeRamp={typeRamp.footnote} numberOfLines={1} style={styles.details}>
          {details}
        </Text>
        {pullRequest.draft || review ? (
          <View style={styles.tags}>
            {pullRequest.draft ? (
              <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.tagDraft}>
                Draft
              </Text>
            ) : null}
            {review && pullRequest.reviewDecision ? (
              <Text
                dynamicTypeRamp={typeRamp.sectionLabel}
                style={
                  pullRequest.reviewDecision === "APPROVED"
                    ? styles.tagApproved
                    : pullRequest.reviewDecision === "CHANGES_REQUESTED"
                      ? styles.tagChanges
                      : styles.tagDraft
                }
              >
                {review}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  copy: { ...typography.subheadline, color: palette.dim, textAlign: "center" },
  count: { ...typography.footnote, color: palette.dim },
  details: { ...typography.footnote, color: palette.dim },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: space.sm,
    justifyContent: "center",
    padding: space.xl,
  },
  listContent: {
    alignSelf: "center",
    maxWidth: 760,
    paddingBottom: 96,
    width: "100%",
  },
  pressed: { opacity: pressedOpacity },
  projectHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  projectLabel: { ...typography.sectionLabel, color: palette.dim, flex: 1 },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  rowCopy: { flex: 1, gap: space.xs / 2, minWidth: 0 },
  rowIcon: { marginTop: 2 },
  rowTitle: { ...typography.body, color: palette.ink, flex: 1, minWidth: 0 },
  source: {
    ...typography.footnote,
    color: palette.dim,
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
  stateError: { color: palette.danger },
  stateRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: space.md,
  },
  stateText: { ...typography.footnote, color: palette.dim, flexShrink: 1 },
  tagApproved: { ...typography.sectionLabel, color: palette.success },
  tagChanges: { ...typography.sectionLabel, color: palette.warm },
  tagDraft: { ...typography.sectionLabel, color: palette.dim },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  time: { ...typography.footnote, color: palette.dim, flexShrink: 0 },
  title: { ...typography.headline, color: palette.ink, textAlign: "center" },
  titleRow: { alignItems: "flex-start", flexDirection: "row", gap: space.sm },
});
