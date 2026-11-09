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
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Button } from "../components/button";
import { ModalSheet } from "../components/modal-sheet";
import { ProjectAvatar } from "../components/project-avatar";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { labelProject } from "../state/followed-project-inbox";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { usePullRequestFilter } from "../state/use-pull-request-filter";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import {
  type PullRequestStatusFilter,
  pullRequestStatusFilters,
} from "../storage/pull-request-filter-repository";
import {
  disabledOpacity,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  rippleFeedback,
  space,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
import { sanitizeTranscriptText } from "./session-transcript-model";
import { formatSessionTime, sessionTimeDescription } from "./workspace-screen-model";

type Project = ProjectListOutput[number];
type ProjectState = "error" | "empty" | "loading" | "no-match" | GitHubPullRequestUnavailableReason;
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
  "no-match": "No open pull requests match this status.",
  timeout: "GitHub took too long to answer.",
};
const retryableStates: ReadonlySet<ProjectState> = new Set(["error", "failed", "timeout"]);
const reviewLabels: Record<NonNullable<GitHubPullRequest["reviewDecision"]>, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};
const rowRipple = rippleFeedback.row;

export const statusFilterLabels: Record<PullRequestStatusFilter, string> = {
  all: "All statuses",
  approved: "Approved",
  "changes-requested": "Changes requested",
  draft: "Draft",
  ready: "Ready",
  "review-required": "Review required",
};

export function matchesStatusFilter(
  pullRequest: GitHubPullRequest,
  status: PullRequestStatusFilter,
) {
  switch (status) {
    case "all":
      return true;
    case "draft":
      return pullRequest.draft;
    case "ready":
      return !pullRequest.draft;
    case "approved":
      return pullRequest.reviewDecision === "APPROVED";
    case "changes-requested":
      return pullRequest.reviewDecision === "CHANGES_REQUESTED";
    case "review-required":
      return !pullRequest.draft && pullRequest.reviewDecision === "REVIEW_REQUIRED";
  }
}

export function pullRequestListItems(
  projects: readonly Project[],
  results: readonly ProjectResult[],
  status: PullRequestStatusFilter = "all",
): PullRequestListItem[] {
  return projects.flatMap((project, index): PullRequestListItem[] => {
    const result = results[index];
    const label = labelProject(project, project.id);
    const all = result?.data?.status === "listed" ? result.data.pullRequests : undefined;
    const listed = all?.filter((pullRequest) => matchesStatusFilter(pullRequest, status));
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
            : all?.length === 0
              ? "empty"
              : listed?.length === 0
                ? "no-match"
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
  const [openFilter, setOpenFilter] = useState<"project" | "status">();
  const client = runtime.restClient;
  const connectionId = runtime.connectionId;
  const filters = usePullRequestFilter(connectionId, runtime.connectionUpdatedAtMs);
  const projectsById = new Map(selection.projects.map((project) => [project.id, project]));
  const followed = selection.followedProjectIds.flatMap((id) => {
    const project = projectsById.get(id);
    return project ? [project] : [];
  });
  // A saved project that is no longer followed reads as All projects until it is changed.
  const filteredProject = followed.find((project) => project.id === filters.filter.projectID);
  const visibleProjects = filteredProject ? [filteredProject] : followed;
  const status = filters.filter.status;
  // Each check runs a command on the server, so nothing starts until the tab is open and the
  // saved filter has loaded, and projects outside the filter are never checked.
  const results = useQueries({
    queries: visibleProjects.map((project) => {
      const location = { directory: project.canonical };
      return {
        enabled: Boolean(active && client && connectionId && filters.loaded),
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
  const items = pullRequestListItems(visibleProjects, results, status);

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

  const projectLabel = filteredProject
    ? labelProject(filteredProject, filteredProject.id)
    : "All projects";

  return (
    <>
      <View style={styles.filters}>
        <ScrollView
          contentContainerStyle={styles.filterChips}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
        >
          <FilterChip
            active={status !== "all"}
            disabled={!filters.loaded}
            label={statusFilterLabels[status]}
            name="Status"
            onPress={() => setOpenFilter("status")}
          />
          <FilterChip
            active={Boolean(filteredProject)}
            disabled={!filters.loaded}
            label={projectLabel}
            name="Project"
            onPress={() => setOpenFilter("project")}
          />
        </ScrollView>
        {filters.error ? (
          <Text
            accessibilityRole="alert"
            dynamicTypeRamp={typeRamp.footnote}
            style={styles.filterError}
          >
            The filter could not be saved on this device.
          </Text>
        ) : null}
      </View>
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
            <ProjectStateRow
              onRetry={
                item.state === "no-match"
                  ? () => filters.setFilter({ ...filters.filter, status: "all" })
                  : item.onRetry
              }
              state={item.state}
            />
          ) : (
            <PullRequestRow
              largeText={largeText}
              projectLabel={item.projectLabel}
              pullRequest={item.pullRequest}
            />
          )
        }
      />
      <ModalSheet
        onClose={() => setOpenFilter(undefined)}
        size="compact"
        title="Status"
        visible={openFilter === "status"}
      >
        {pullRequestStatusFilters.map((value) => (
          <FilterOption
            key={value}
            label={statusFilterLabels[value]}
            onPress={() => {
              setOpenFilter(undefined);
              filters.setFilter({ ...filters.filter, status: value });
            }}
            selected={value === status}
          />
        ))}
      </ModalSheet>
      <ModalSheet
        onClose={() => setOpenFilter(undefined)}
        size="compact"
        title="Project"
        visible={openFilter === "project"}
      >
        <FilterOption
          label="All projects"
          onPress={() => {
            setOpenFilter(undefined);
            filters.setFilter({ status });
          }}
          selected={!filteredProject}
        />
        {followed.map((project) => (
          <FilterOption
            key={project.id}
            label={labelProject(project, project.id)}
            onPress={() => {
              setOpenFilter(undefined);
              filters.setFilter({ projectID: project.id, status });
            }}
            selected={project.id === filteredProject?.id}
          />
        ))}
      </ModalSheet>
    </>
  );
}

function FilterChip({
  active,
  disabled,
  label,
  name,
  onPress,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  name: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={`Opens ${name.toLocaleLowerCase()} choices`}
      accessibilityLabel={`${name} filter, ${label}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      android_ripple={rowRipple}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        disabled && styles.disabled,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
    >
      <Text
        dynamicTypeRamp={typeRamp.control}
        numberOfLines={1}
        style={[styles.chipLabel, active && styles.chipLabelActive]}
      >
        {label}
      </Text>
      <Feather
        accessible={false}
        color={active ? palette.ink : palette.dim}
        name="chevron-down"
        size={16}
      />
    </Pressable>
  );
}

function FilterOption({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      android_ripple={rowRipple}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
    >
      <Text dynamicTypeRamp={typeRamp.body} numberOfLines={2} style={styles.optionLabel}>
        {label}
      </Text>
      {selected ? (
        <Feather accessible={false} color={palette.signal} name="check" size={20} />
      ) : null}
    </Pressable>
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
      ) : state === "no-match" ? (
        <Button label="Show all statuses" onPress={onRetry} size="compact" variant="text" />
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
      onPress={() =>
        void Linking.openURL(pullRequest.url).catch(() =>
          Alert.alert("Couldn't open pull request", "No app on this device could open the link."),
        )
      }
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
                      : styles.tagReview
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
  chip: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.xs,
    maxWidth: 260,
    minHeight: minTouchTarget,
    overflow: "hidden",
    paddingHorizontal: space.md,
  },
  chipActive: { backgroundColor: palette.card, borderColor: palette.ink },
  chipLabel: { ...typography.control, color: palette.dim, flexShrink: 1 },
  chipLabelActive: { color: palette.ink },
  copy: { ...typography.subheadline, color: palette.dim, textAlign: "center" },
  disabled: { opacity: disabledOpacity },
  filterChips: { gap: space.sm, paddingHorizontal: space.md },
  filterError: {
    ...typography.footnote,
    color: palette.danger,
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
  filters: { paddingBottom: space.xs },
  // Matches the composer pickers: inset rows with one selected fill.
  option: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: space.sm,
    minHeight: minTouchTarget,
    overflow: "hidden",
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  optionSelected: { backgroundColor: palette.selected },
  optionLabel: { ...typography.body, color: palette.ink, flex: 1 },
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
  // GitHub's review colors: approved green, changes requested red, waiting amber.
  tagChanges: { ...typography.sectionLabel, color: palette.danger },
  tagDraft: { ...typography.sectionLabel, color: palette.dim },
  tagReview: { ...typography.sectionLabel, color: palette.warm },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  time: { ...typography.footnote, color: palette.dim, flexShrink: 0 },
  title: { ...typography.headline, color: palette.ink, textAlign: "center" },
  titleRow: { alignItems: "flex-start", flexDirection: "row", gap: space.sm },
});
