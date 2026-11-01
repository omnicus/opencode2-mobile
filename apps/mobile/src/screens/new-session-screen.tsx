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
import { type ReactNode, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../components/button";
import { SearchField } from "../components/search-field";
import { useAnnouncement } from "../components/use-announcement";
import type { RootStackParamList } from "../navigation/root-navigation";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import {
  cardSurface,
  disabledOpacity,
  minTouchTarget,
  palette,
  pressedOpacity,
  space,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
import { sanitizeTranscriptText } from "./session-transcript-model";

type Props = NativeStackScreenProps<RootStackParamList, "NewSession">;
type Project = ProjectListOutput[number];
type LocationChoice = { key: string; label: string; location: LocationRef };
type ProjectRow = { id: string; project?: Project; title?: string; type: "project" | "section" };

export function NewSessionScreen({ navigation }: Props) {
  const { fontScale } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
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
      if (caught instanceof Error && caught.message === "LOCATION_PROJECT_MISMATCH") {
        setSelectedProject(undefined);
        setError("The project list changed. Choose the project again.");
        void Promise.all([selection.refetch(), defaultLocationQuery.refetch()]);
        return;
      }
      setError(
        "The session could not be created. Check this project and connection, then try again.",
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
  const creating = createMutation.isPending ? createMutation.variables : undefined;
  const onLocationStep = Boolean(selectedProject);
  const blockBackRef = useRef(false);
  blockBackRef.current = onLocationStep && !createMutation.isPending;
  useAnnouncement(createMutation.isPending && "Creating session");
  useAnnouncement(error);

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !onLocationStep || createMutation.isPending });
  }, [createMutation.isPending, navigation, onLocationStep]);

  // Back and the iOS swipe-down return to Projects from the location step instead of closing.
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        const { type } = event.data.action;
        if (type === "REPLACE") return;
        if (!closedRef.current && blockBackRef.current && (type === "GO_BACK" || type === "POP")) {
          event.preventDefault();
          setError(undefined);
          setSelectedProject(undefined);
          return;
        }
        closedRef.current = true;
        createAbortRef.current?.abort();
      }),
    [navigation],
  );

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <KeyboardAvoidingView behavior="padding" style={styles.keyboardView}>
        <View style={[styles.header, largeText && styles.headerLargeText]}>
          <View style={[styles.headerSide, largeText && styles.headerSideLargeText]}>
            <Pressable
              accessibilityRole="button"
              android_ripple={
                Platform.OS === "android"
                  ? { color: "rgba(255,255,255,0.12)", borderless: true }
                  : undefined
              }
              onPress={close}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && Platform.OS === "ios" && styles.pressed,
              ]}
            >
              <Text dynamicTypeRamp={typeRamp.navTitle} style={styles.cancelLabel}>
                Cancel
              </Text>
            </Pressable>
          </View>
          <View style={[styles.heading, largeText && styles.headingLargeText]}>
            <Text
              accessibilityRole="header"
              dynamicTypeRamp={typeRamp.navTitle}
              style={[styles.title, largeText && styles.headingTextLargeText]}
            >
              {selectedProject ? "Choose location" : "New session"}
            </Text>
            <Text
              dynamicTypeRamp={typeRamp.footnote}
              style={[styles.subtitle, largeText && styles.headingTextLargeText]}
            >
              {selectedProject
                ? projectLabel(selectedProject)
                : "Choose where this session should start."}
            </Text>
          </View>
          {largeText ? null : <View style={styles.headerSide} />}
        </View>

        {selectedProject ? (
          <View style={styles.body}>
            {!followed.has(selectedProject.id) ? (
              <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.followingCopy}>
                Starting here will add this project to Sessions on this device.
              </Text>
            ) : null}
            <Button
              accessibilityLabel="Back to projects"
              disabled={disabled}
              icon="chevron-left"
              label="Projects"
              onPress={() => {
                setError(undefined);
                setSelectedProject(undefined);
              }}
              variant="text"
            />
            <FlatList
              contentContainerStyle={styles.listContent}
              data={selectedLocations}
              ItemSeparatorComponent={RowSeparator}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(choice) => choice.key}
              renderItem={({ item: choice }) => (
                <LocationButton
                  busy={
                    creating?.project.id === selectedProject.id &&
                    locationKey(creating.requested) === choice.key
                  }
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
            <Text
              accessibilityRole="alert"
              dynamicTypeRamp={typeRamp.subheadline}
              style={styles.error}
            >
              Project locations could not be loaded from this connection.
            </Text>
            <Button
              align="center"
              label="Retry"
              onPress={() => {
                setError(undefined);
                void Promise.all([selection.refetch(), defaultLocationQuery.refetch()]);
              }}
            />
          </View>
        ) : selection.projects.length === 0 ? (
          <View style={styles.state}>
            <Text dynamicTypeRamp={typeRamp.headline} style={styles.stateTitle}>
              No server projects found
            </Text>
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateCopy}>
              OpenCode did not return any known projects.
            </Text>
            <Button align="center" label="Retry" onPress={() => void selection.refetch()} />
          </View>
        ) : (
          <View style={styles.body}>
            <SearchField
              clearAccessibilityLabel="Clear project search"
              onChangeText={setSearch}
              placeholder="Search projects"
              returnKeyType="search"
              value={search}
            />
            <FlatList
              contentContainerStyle={styles.listContent}
              data={rows}
              ItemSeparatorComponent={RowSeparator}
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(row) => row.id}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text dynamicTypeRamp={typeRamp.headline} style={styles.stateTitle}>
                    {deferredSearch
                      ? `No projects match "${search.trim()}"`
                      : "No followed projects"}
                  </Text>
                  <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateCopy}>
                    {deferredSearch
                      ? "Try a project name or path."
                      : "Browse server projects to start a session."}
                  </Text>
                </View>
              }
              renderItem={({ item }) =>
                item.type === "section" ? (
                  <Text
                    accessibilityRole="header"
                    dynamicTypeRamp={typeRamp.sectionLabel}
                    style={styles.sectionTitle}
                  >
                    {item.title}
                  </Text>
                ) : item.project ? (
                  <ProjectButton
                    busy={creating?.project.id === item.project.id}
                    disabled={disabled}
                    followed={followed.has(item.project.id)}
                    onPress={() => chooseProject(item.project as Project)}
                    project={item.project}
                  />
                ) : null
              }
            />
            {!showOtherProjects && otherProjectCount > 0 ? (
              <Button fullWidth label="Browse all projects" onPress={showAllProjects} />
            ) : null}
          </View>
        )}

        {error ? (
          <Text
            accessibilityRole="alert"
            dynamicTypeRamp={typeRamp.subheadline}
            style={styles.footerError}
          >
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
      label: "Server's working directory",
      location: defaultRef,
    });
  }
  for (const directory of project.sandboxes) {
    if (choices.some((choice) => choice.location.directory === directory)) continue;
    const location = { directory };
    choices.push({
      key: locationKey(location),
      label: directory.split(/[\\/]/).filter(Boolean).at(-1) || directory,
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
  busy,
  disabled,
  followed,
  onPress,
  project,
}: {
  busy: boolean;
  disabled: boolean;
  followed: boolean;
  onPress: () => void;
  project: Project;
}) {
  const label = projectLabel(project);
  const path = sanitizeTranscriptText(project.canonical, 1_024);
  return (
    <ChoiceRow
      accessibilityLabel={`${label}, ${followed ? "followed" : "not followed, will be added to Sessions"}, ${path}`}
      busy={busy}
      disabled={disabled}
      onPress={onPress}
    >
      <Text dynamicTypeRamp={typeRamp.body} style={styles.projectTitle}>
        {label}
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.projectPath}>
        {path}
      </Text>
      {!followed ? (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.followNote}>
          Will be added to Sessions
        </Text>
      ) : null}
    </ChoiceRow>
  );
}

function LocationButton({
  busy,
  directory,
  disabled,
  label,
  onPress,
}: {
  busy: boolean;
  directory: string;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  const path = sanitizeTranscriptText(directory, 1_024);
  return (
    <ChoiceRow
      accessibilityLabel={`${label}, ${path}`}
      busy={busy}
      disabled={disabled}
      onPress={onPress}
    >
      <Text dynamicTypeRamp={typeRamp.body} style={styles.projectTitle}>
        {label}
      </Text>
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.projectPath}>
        {path}
      </Text>
    </ChoiceRow>
  );
}

function ChoiceRow({
  accessibilityLabel,
  busy,
  children,
  disabled,
  onPress,
}: {
  accessibilityLabel: string;
  busy: boolean;
  children: ReactNode;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={busy ? `${accessibilityLabel}, creating session` : accessibilityLabel}
      accessibilityLiveRegion={busy ? "polite" : "none"}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      android_ripple={rowRipple}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.project,
        disabled && !busy && styles.disabled,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
    >
      <View style={styles.projectCopy}>{children}</View>
      {busy ? <ActivityIndicator color={palette.signal} /> : null}
    </Pressable>
  );
}

function StateMessage({ label, loading }: { label: string; loading?: boolean }) {
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator accessibilityLabel={label} color={palette.signal} /> : null}
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateCopy}>
        {label}
      </Text>
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

const rowRipple = Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)" } : undefined;

const styles = StyleSheet.create({
  body: { flex: 1, gap: space.md, padding: space.lg, paddingTop: space.md },
  cancelButton: {
    justifyContent: "center",
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  cancelLabel: { ...typography.navTitle, color: palette.signal },
  disabled: { opacity: disabledOpacity },
  emptyState: { alignItems: "center", gap: space.xs, paddingVertical: space.xl },
  error: { ...typography.subheadline, color: palette.danger, textAlign: "center" },
  followNote: { ...typography.footnote, color: palette.signal, marginTop: space.xs },
  followingCopy: { ...typography.subheadline, color: palette.dim },
  footerError: {
    ...typography.subheadline,
    color: palette.danger,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  header: {
    alignItems: "center",
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.md,
  },
  headerSide: { alignItems: "flex-start", flex: 1 },
  headerSideLargeText: { flex: 0 },
  heading: { alignItems: "center", flexShrink: 1, maxWidth: "50%" },
  headingTextLargeText: { textAlign: "left" },
  headerLargeText: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: space.xs,
    paddingVertical: space.sm,
  },
  headingLargeText: { alignItems: "flex-start", maxWidth: "100%", width: "100%" },
  keyboardView: { flex: 1 },
  listContent: { paddingBottom: space.xl },
  pressed: { opacity: pressedOpacity },
  project: {
    ...cardSurface,
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    minHeight: 64,
    overflow: "hidden",
  },
  projectCopy: { flex: 1, minWidth: 0 },
  projectPath: {
    ...typography.footnote,
    color: palette.dim,
    fontFamily: typography.code.fontFamily,
    marginTop: 2,
  },
  projectTitle: { ...typography.body, color: palette.ink },
  screen: { backgroundColor: palette.background, flex: 1 },
  sectionTitle: {
    ...typography.sectionLabel,
    color: palette.dim,
    paddingBottom: space.xs,
    paddingTop: space.sm,
  },
  separator: { height: space.sm },
  state: {
    alignItems: "center",
    flex: 1,
    gap: space.sm,
    justifyContent: "center",
    padding: space.xl,
  },
  stateCopy: { ...typography.subheadline, color: palette.dim, textAlign: "center" },
  stateTitle: { ...typography.headline, color: palette.ink, textAlign: "center" },
  subtitle: { ...typography.footnote, color: palette.dim, marginTop: 2, textAlign: "center" },
  title: { ...typography.navTitle, color: palette.ink, textAlign: "center" },
});
