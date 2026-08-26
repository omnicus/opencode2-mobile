import {
  createOpenCodeSession,
  getDefaultOpenCodeLocation,
  getOpenCodeLocation,
  type LocationRef,
  type ProjectListOutput,
} from "@opencode2-mobile/opencode-adapter";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { RootStackParamList } from "../navigation/root-navigation";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { palette, radius, space, typeRamp } from "../theme";
import { sanitizeTranscriptText } from "./session-transcript-model";

type Props = NativeStackScreenProps<RootStackParamList, "NewSession">;
type Project = ProjectListOutput[number];
type LocationChoice = { key: string; label: string; location: LocationRef };
type ProjectRow = { id: string; project?: Project; title?: string; type: "project" | "section" };

export function NewSessionScreen({ navigation }: Props) {
  const runtime = useConnectionRuntime();
  const selection = useWorkspaceSelection();
  const queryClient = useQueryClient();
  const createAbortRef = useRef<AbortController>(null);
  const closedRef = useRef(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project>();
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const connectionID = runtime.connectionId;
  const client = runtime.restClient;
  const defaultLocationQuery = useQuery({
    enabled: Boolean(client && connectionID),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getDefaultOpenCodeLocation(client, { signal });
    },
    queryKey: openCodeQueryKeys.defaultLocation(connectionID ?? "unselected"),
  });
  const followed = new Set(selection.followedProjectIds);
  const followedOrder = new Map(
    selection.followedProjectIds.map((projectID, index) => [projectID, index]),
  );
  const orderedProjects = selection.projects
    .map((project, serverIndex) => ({ project, serverIndex }))
    .sort((first, second) => {
      const firstPosition = followedOrder.get(first.project.id);
      const secondPosition = followedOrder.get(second.project.id);
      if (firstPosition !== undefined && secondPosition !== undefined) {
        return firstPosition - secondPosition;
      }
      if (firstPosition !== undefined) return -1;
      if (secondPosition !== undefined) return 1;
      return first.serverIndex - second.serverIndex;
    })
    .map(({ project }) => project);
  const matchingProjects = deferredSearch
    ? orderedProjects.filter((project) => projectSearchText(project).includes(deferredSearch))
    : orderedProjects;
  const showOtherProjects = browseAll || Boolean(deferredSearch);
  const rows = projectRows(matchingProjects, followed, showOtherProjects);
  const otherProjectCount = selection.projects.filter(
    (project) => !followed.has(project.id),
  ).length;
  const selectedLocations = projectLocations(selectedProject, defaultLocationQuery.data);

  useEffect(() => {
    void connectionID;
    closedRef.current = false;
    createAbortRef.current?.abort();
    setError(undefined);
    setSearch("");
    setBrowseAll(false);
    setSelectedProject(undefined);
    return () => createAbortRef.current?.abort();
  }, [connectionID]);

  const createMutation = useMutation({
    mutationFn: async ({ project, requested }: { project: Project; requested: LocationRef }) => {
      if (!client || !connectionID) throw new Error("CONNECTION_NOT_READY");
      const controller = new AbortController();
      createAbortRef.current?.abort();
      createAbortRef.current = controller;
      try {
        const location = await getOpenCodeLocation(client, requested, {
          signal: controller.signal,
        });
        if (location.project.id !== project.id) throw new Error("LOCATION_PROJECT_MISMATCH");
        if (!selection.followedProjectIds.includes(project.id)) {
          await selection.setFollowedProjectIds([...selection.followedProjectIds, project.id]);
        }
        const session = await createOpenCodeSession(
          client,
          location,
          {},
          { signal: controller.signal },
        );
        return { location, session };
      } catch (caught) {
        if (controller.signal.aborted) throw new Error("REQUEST_ABORTED");
        throw caught;
      } finally {
        if (createAbortRef.current === controller) createAbortRef.current = null;
      }
    },
    onError: (caught) => {
      if (caught instanceof Error && caught.message === "REQUEST_ABORTED") return;
      setError(
        caught instanceof Error && caught.message === "LOCATION_PROJECT_MISMATCH"
          ? "That directory no longer belongs to this project. Refresh projects and try again."
          : "The session could not be created. Check this project and connection, then try again.",
      );
    },
    onMutate: () => setError(undefined),
    onSuccess: ({ location, session }) => {
      if (!connectionID) return;
      queryClient.setQueryData(
        openCodeQueryKeys.session(connectionID, location, session.id),
        session,
      );
      void selection.refetch();
      if (closedRef.current) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      navigation.replace("Session", {
        connectionId: connectionID,
        focusComposer: true,
        location,
        sessionID: session.id,
      });
    },
  });

  function chooseProject(project: Project) {
    if (createMutation.isPending || selection.preferencesSaving) return;
    Keyboard.dismiss();
    const locations = projectLocations(project, defaultLocationQuery.data);
    if (locations.length === 1 && locations[0]) {
      createMutation.mutate({ project, requested: locations[0].location });
      return;
    }
    setError(undefined);
    setSelectedProject(project);
  }

  function showAllProjects() {
    setBrowseAll(true);
  }

  function close() {
    closedRef.current = true;
    createAbortRef.current?.abort();
    navigation.goBack();
  }

  const loading =
    selection.preferencesLoading || selection.projectsLoading || defaultLocationQuery.isPending;
  const disabled = createMutation.isPending || selection.preferencesSaving;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text
              accessibilityRole="header"
              dynamicTypeRamp={typeRamp.heading}
              style={styles.title}
            >
              {selectedProject ? "Choose location" : "New session"}
            </Text>
            <Text dynamicTypeRamp={typeRamp.body} style={styles.subtitle}>
              {selectedProject
                ? projectLabel(selectedProject)
                : "Choose where this session should start."}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={close}
            style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
          >
            <Text dynamicTypeRamp={typeRamp.control} style={styles.cancelLabel}>
              Cancel
            </Text>
          </Pressable>
        </View>

        {selectedProject ? (
          <View style={styles.body}>
            {!followed.has(selectedProject.id) ? (
              <Text style={styles.followingCopy}>
                Starting here will add this project to Sessions on this device.
              </Text>
            ) : null}
            <Pressable
              accessibilityLabel="Back to projects"
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => {
                setError(undefined);
                setSelectedProject(undefined);
              }}
              style={({ pressed }) => [
                styles.backButton,
                disabled && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.backLabel}>&lt; Projects</Text>
            </Pressable>
            <FlatList
              contentContainerStyle={styles.listContent}
              data={selectedLocations}
              ItemSeparatorComponent={RowSeparator}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(choice) => choice.key}
              renderItem={({ item: choice }) => (
                <LocationButton
                  disabled={disabled}
                  directory={choice.location.directory}
                  label={choice.label}
                  onPress={() =>
                    createMutation.mutate({ project: selectedProject, requested: choice.location })
                  }
                />
              )}
            />
          </View>
        ) : loading ? (
          <StateMessage label="Loading projects" loading />
        ) : selection.projectsError ||
          selection.preferencesError ||
          defaultLocationQuery.isError ? (
          <View style={styles.state}>
            <Text accessibilityRole="alert" style={styles.error}>
              Project locations could not be loaded from this connection.
            </Text>
            <ActionButton
              label="Retry"
              onPress={() => {
                setError(undefined);
                void Promise.all([selection.refetch(), defaultLocationQuery.refetch()]);
              }}
            />
          </View>
        ) : selection.projects.length === 0 ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>No server projects found</Text>
            <Text style={styles.stateCopy}>OpenCode did not return any known projects.</Text>
            <ActionButton label="Retry" onPress={() => void selection.refetch()} />
          </View>
        ) : (
          <View style={styles.body}>
            <View style={styles.searchField}>
              <TextInput
                accessibilityLabel="Search projects"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setSearch}
                placeholder="Search projects"
                placeholderTextColor={palette.dim}
                returnKeyType="search"
                style={styles.searchInput}
                value={search}
              />
              {search ? (
                <Pressable
                  accessibilityLabel="Clear project search"
                  accessibilityRole="button"
                  onPress={() => setSearch("")}
                  style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
                >
                  <Text style={styles.clearLabel}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            <FlatList
              contentContainerStyle={styles.listContent}
              data={rows}
              ItemSeparatorComponent={RowSeparator}
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(row) => row.id}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.stateTitle}>
                    {deferredSearch
                      ? `No projects match "${search.trim()}"`
                      : "No followed projects"}
                  </Text>
                  <Text style={styles.stateCopy}>
                    {deferredSearch
                      ? "Try a project name or path."
                      : "Browse server projects to start a session."}
                  </Text>
                </View>
              }
              renderItem={({ item }) =>
                item.type === "section" ? (
                  <Text accessibilityRole="header" style={styles.sectionTitle}>
                    {item.title}
                  </Text>
                ) : item.project ? (
                  <ProjectButton
                    disabled={disabled}
                    followed={followed.has(item.project.id)}
                    onPress={() => chooseProject(item.project as Project)}
                    project={item.project}
                  />
                ) : null
              }
            />
            {!showOtherProjects && otherProjectCount > 0 ? (
              <ActionButton label="Browse all projects" onPress={showAllProjects} />
            ) : null}
          </View>
        )}

        {createMutation.isPending ? (
          <View accessibilityLiveRegion="polite" style={styles.creatingState}>
            <ActivityIndicator color={palette.signal} />
            <Text style={styles.stateCopy}>Creating session...</Text>
          </View>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.footerError}>
            {error}
          </Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function projectLocations(
  project: Project | undefined,
  defaultLocation: Awaited<ReturnType<typeof getDefaultOpenCodeLocation>> | undefined,
) {
  if (!project) return [];
  const isDefaultProject = defaultLocation?.project.id === project.id;
  const defaultRef = defaultLocation
    ? {
        directory: defaultLocation.directory,
        ...(defaultLocation.workspaceID ? { workspaceID: defaultLocation.workspaceID } : {}),
      }
    : undefined;
  const mainLocation =
    isDefaultProject && defaultRef?.directory === project.canonical
      ? defaultRef
      : { directory: project.canonical };
  const choices: LocationChoice[] = [
    { key: locationKey(mainLocation), label: "Main directory", location: mainLocation },
  ];
  if (isDefaultProject && defaultRef && defaultRef.directory !== project.canonical) {
    choices.push({
      key: locationKey(defaultRef),
      label: "Current server directory",
      location: defaultRef,
    });
  }
  let worktreeIndex = 0;
  for (const directory of project.sandboxes) {
    if (choices.some((choice) => choice.location.directory === directory)) continue;
    worktreeIndex += 1;
    const location = { directory };
    choices.push({
      key: locationKey(location),
      label: `Worktree ${worktreeIndex}`,
      location,
    });
  }
  return choices;
}

function locationKey(location: LocationRef) {
  return `${location.directory}\u0000${location.workspaceID ?? ""}`;
}

function projectRows(projects: Project[], followed: ReadonlySet<string>, showOther: boolean) {
  const followedProjects = projects.filter((project) => followed.has(project.id));
  const otherProjects = showOther ? projects.filter((project) => !followed.has(project.id)) : [];
  const rows: ProjectRow[] = [];
  if (followedProjects.length) {
    rows.push({ id: "section-followed", title: "Followed projects", type: "section" });
    rows.push(
      ...followedProjects.map((project) => ({
        id: `project-${project.id}`,
        project,
        type: "project" as const,
      })),
    );
  }
  if (otherProjects.length) {
    rows.push({ id: "section-other", title: "Other projects", type: "section" });
    rows.push(
      ...otherProjects.map((project) => ({
        id: `project-${project.id}`,
        project,
        type: "project" as const,
      })),
    );
  }
  return rows;
}

function ProjectButton({
  disabled,
  followed,
  onPress,
  project,
}: {
  disabled: boolean;
  followed: boolean;
  onPress: () => void;
  project: Project;
}) {
  const label = projectLabel(project);
  const path = sanitizeTranscriptText(project.canonical, 1_024);
  return (
    <Pressable
      accessibilityLabel={`${label}, ${followed ? "followed" : "not followed, will be added to Sessions"}, ${path}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.project,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text dynamicTypeRamp={typeRamp.subheading} style={styles.projectTitle}>
        {label}
      </Text>
      <Text selectable style={styles.projectPath}>
        {path}
      </Text>
      {!followed ? <Text style={styles.followNote}>Will be added to Sessions</Text> : null}
    </Pressable>
  );
}

function LocationButton({
  directory,
  disabled,
  label,
  onPress,
}: {
  directory: string;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  const path = sanitizeTranscriptText(directory, 1_024);
  return (
    <Pressable
      accessibilityLabel={`${label}, ${path}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.project,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text dynamicTypeRamp={typeRamp.subheading} style={styles.projectTitle}>
        {label}
      </Text>
      <Text selectable style={styles.projectPath}>
        {path}
      </Text>
    </Pressable>
  );
}

function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
    >
      <Text dynamicTypeRamp={typeRamp.control} style={styles.actionLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function StateMessage({ label, loading }: { label: string; loading?: boolean }) {
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator accessibilityLabel={label} color={palette.signal} /> : null}
      <Text style={styles.stateCopy}>{label}</Text>
    </View>
  );
}

function RowSeparator() {
  return <View style={styles.separator} />;
}

function projectLabel(project: { canonical: string; id: string; name?: string }) {
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
}

function projectSearchText(project: Project) {
  return `${projectLabel(project)}\n${project.canonical}\n${project.sandboxes.join("\n")}\n${project.id}`.toLocaleLowerCase();
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    borderColor: palette.signal,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: space.md,
  },
  actionLabel: { color: palette.signal, fontSize: 15, fontWeight: "800" },
  backButton: { alignSelf: "flex-start", justifyContent: "center", minHeight: 44 },
  backLabel: { color: palette.signal, fontSize: 15, fontWeight: "700" },
  body: { flex: 1, gap: space.md, padding: space.lg, paddingTop: space.md },
  cancelButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: space.xs },
  cancelLabel: { color: palette.signal, fontSize: 16, fontWeight: "700" },
  clearButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: space.md },
  clearLabel: { color: palette.signal, fontSize: 13, fontWeight: "800" },
  creatingState: {
    alignItems: "center",
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  disabled: { opacity: 0.45 },
  emptyState: { alignItems: "center", gap: space.xs, paddingVertical: space.xl },
  error: { color: palette.danger, fontSize: 14, lineHeight: 20, textAlign: "center" },
  followNote: { color: palette.signal, fontSize: 11, fontWeight: "800", marginTop: space.xs },
  followingCopy: { color: palette.dim, fontSize: 13, lineHeight: 19 },
  footerError: {
    color: palette.danger,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  header: {
    alignItems: "flex-start",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: space.md,
    padding: space.lg,
  },
  heading: { flex: 1, minWidth: 0 },
  keyboardView: { flex: 1 },
  listContent: { paddingBottom: space.xl },
  pressed: { opacity: 0.58 },
  project: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 72,
    padding: space.md,
  },
  projectPath: { color: palette.dim, fontSize: 12, lineHeight: 18, marginTop: 3 },
  projectTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  screen: { backgroundColor: palette.background, flex: 1 },
  searchField: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 48,
  },
  searchInput: {
    color: palette.ink,
    flex: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: space.md,
  },
  sectionTitle: {
    color: palette.dim,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    paddingBottom: space.xs,
    paddingTop: space.sm,
    textTransform: "uppercase",
  },
  separator: { height: space.sm },
  state: {
    alignItems: "center",
    flex: 1,
    gap: space.sm,
    justifyContent: "center",
    padding: space.xl,
  },
  stateCopy: { color: palette.dim, fontSize: 14, lineHeight: 20, textAlign: "center" },
  stateTitle: { color: palette.ink, fontSize: 17, fontWeight: "800", textAlign: "center" },
  subtitle: { color: palette.dim, fontSize: 14, lineHeight: 20, marginTop: 3 },
  title: { color: palette.ink, fontSize: 28, fontWeight: "800", lineHeight: 34 },
});
