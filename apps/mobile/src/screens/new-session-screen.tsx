import Feather from "@expo/vector-icons/Feather";
import {
  createOpenCodeSession,
  getDefaultOpenCodeLocation,
  getOpenCodeLocation,
  type LocationRef,
} from "@opencode2-mobile/opencode-adapter";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  type ReactNode,
  type RefObject,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../components/button";
import { ProjectAvatar } from "../components/project-avatar";
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
  rippleFeedback,
  space,
  typeRamp,
  typography,
  usesLargeTextLayout,
} from "../theme";
import { FormKeyboardAvoidingView } from "./form-keyboard-avoiding-view";
import {
  type CreateRequest,
  createSessionFailure,
  creatingLocationKey,
  emptyProjectListCopy,
  type LocationChoice,
  matchingProjects,
  orderProjects,
  type Project,
  type ProjectRow,
  projectBrowserState,
  projectLabel,
  projectLocations,
  projectRows,
} from "./new-session-screen-model";
import { sanitizeTranscriptText } from "./session-transcript-model";

type Props = NativeStackScreenProps<RootStackParamList, "NewSession">;
type Navigation = Props["navigation"];
type OpenCodeClient = ReturnType<typeof useConnectionRuntime>["restClient"];
type WorkspaceSelection = ReturnType<typeof useWorkspaceSelection>;
type DefaultLocationQuery = ReturnType<typeof useDefaultLocationQuery>;

export function NewSessionScreen({ navigation }: Props) {
  const { fontScale } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const runtime = useConnectionRuntime();
  const selection = useWorkspaceSelection();
  const createAbortRef = useRef<AbortController>(null);
  const closedRef = useRef(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project>();
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const connectionID = runtime.connectionId;
  const client = runtime.restClient;
  const defaultLocationQuery = useDefaultLocationQuery(client, connectionID);
  const followed = new Set(selection.followedProjectIds);

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

  const createMutation = useCreateSessionMutation({
    client,
    closedRef,
    connectionID,
    createAbortRef,
    defaultLocationQuery,
    navigation,
    selection,
    setError,
    setSelectedProject,
  });
  const disabled = createMutation.isPending || selection.preferencesSaving;
  const creating = createMutation.isPending ? createMutation.variables : undefined;

  function chooseProject(project: Project) {
    if (disabled) return;
    Keyboard.dismiss();
    const locations = projectLocations(project, defaultLocationQuery.data);
    if (locations.length === 1 && locations[0]) {
      createMutation.mutate({ project, requested: locations[0].location });
      return;
    }
    setError(undefined);
    setSelectedProject(project);
  }

  function close() {
    closedRef.current = true;
    createAbortRef.current?.abort();
    navigation.goBack();
  }

  useAnnouncement(createMutation.isPending && "Creating session");
  useAnnouncement(error);
  useLocationStepBack({
    closedRef,
    createAbortRef,
    navigation,
    onLocationStep: Boolean(selectedProject),
    pending: createMutation.isPending,
    setError,
    setSelectedProject,
  });

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <FormKeyboardAvoidingView style={styles.keyboardView}>
        <NewSessionHeader largeText={largeText} onClose={close} selectedProject={selectedProject} />
        {selectedProject ? (
          <LocationPicker
            busyKey={creatingLocationKey(creating, selectedProject)}
            disabled={disabled}
            followed={followed.has(selectedProject.id)}
            locations={projectLocations(selectedProject, defaultLocationQuery.data)}
            onBack={() => {
              setError(undefined);
              setSelectedProject(undefined);
            }}
            onChoose={(requested) => createMutation.mutate({ project: selectedProject, requested })}
          />
        ) : (
          <ProjectBrowser
            browseAll={browseAll}
            creatingProjectID={creating?.project.id}
            defaultLocationQuery={defaultLocationQuery}
            deferredSearch={deferredSearch}
            disabled={disabled}
            followed={followed}
            onBrowseAll={() => setBrowseAll(true)}
            onChooseProject={chooseProject}
            onRetry={() => setError(undefined)}
            onSearch={setSearch}
            search={search}
            selection={selection}
          />
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
      </FormKeyboardAvoidingView>
    </SafeAreaView>
  );
}

function useDefaultLocationQuery(client: OpenCodeClient, connectionID: string | undefined) {
  return useQuery({
    enabled: Boolean(client && connectionID),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getDefaultOpenCodeLocation(client, { signal });
    },
    queryKey: openCodeQueryKeys.defaultLocation(connectionID ?? "unselected"),
  });
}

function useCreateSessionMutation({
  client,
  closedRef,
  connectionID,
  createAbortRef,
  defaultLocationQuery,
  navigation,
  selection,
  setError,
  setSelectedProject,
}: {
  client: OpenCodeClient;
  closedRef: RefObject<boolean>;
  connectionID: string | undefined;
  createAbortRef: RefObject<AbortController | null>;
  defaultLocationQuery: DefaultLocationQuery;
  navigation: Navigation;
  selection: WorkspaceSelection;
  setError: (error: string | undefined) => void;
  setSelectedProject: (project: Project | undefined) => void;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ project, requested }: CreateRequest) => {
      if (!client || !connectionID) throw new Error("CONNECTION_NOT_READY");
      const controller = new AbortController();
      createAbortRef.current?.abort();
      createAbortRef.current = controller;
      try {
        return await createSessionInProject(client, selection, project, requested, controller);
      } catch (caught) {
        if (controller.signal.aborted) throw new Error("REQUEST_ABORTED");
        throw caught;
      } finally {
        if (createAbortRef.current === controller) createAbortRef.current = null;
      }
    },
    onError: (caught) => {
      const failure = createSessionFailure(caught);
      if (failure === "aborted") return;
      if (failure === "project-changed") {
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
}

async function createSessionInProject(
  client: NonNullable<OpenCodeClient>,
  selection: WorkspaceSelection,
  project: Project,
  requested: LocationRef,
  controller: AbortController,
) {
  const location = await getOpenCodeLocation(client, requested, {
    signal: controller.signal,
  });
  if (location.project.id !== project.id) throw new Error("LOCATION_PROJECT_MISMATCH");
  if (!selection.followedProjectIds.includes(project.id)) {
    await selection.setFollowedProjectIds([...selection.followedProjectIds, project.id]);
  }
  const session = await createOpenCodeSession(client, location, {}, { signal: controller.signal });
  return { location, session };
}

function useLocationStepBack({
  closedRef,
  createAbortRef,
  navigation,
  onLocationStep,
  pending,
  setError,
  setSelectedProject,
}: {
  closedRef: RefObject<boolean>;
  createAbortRef: RefObject<AbortController | null>;
  navigation: Navigation;
  onLocationStep: boolean;
  pending: boolean;
  setError: (error: string | undefined) => void;
  setSelectedProject: (project: Project | undefined) => void;
}) {
  const blockBackRef = useRef(false);
  blockBackRef.current = onLocationStep && !pending;

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !onLocationStep || pending });
  }, [pending, navigation, onLocationStep]);

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
    [closedRef, createAbortRef, navigation, setError, setSelectedProject],
  );
}

function NewSessionHeader({
  largeText,
  onClose,
  selectedProject,
}: {
  largeText: boolean;
  onClose: () => void;
  selectedProject: Project | undefined;
}) {
  return (
    <View style={[styles.header, largeText && styles.headerLargeText]}>
      <View style={[styles.headerSide, largeText && styles.headerSideLargeText]}>
        <Pressable
          accessibilityRole="button"
          android_ripple={rippleFeedback.borderless}
          onPress={onClose}
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
          {selectedProject ? projectLabel(selectedProject) : "Choose a project"}
        </Text>
      </View>
      {largeText ? null : <View style={styles.headerSide} />}
    </View>
  );
}

function LocationPicker({
  busyKey,
  disabled,
  followed,
  locations,
  onBack,
  onChoose,
}: {
  busyKey: string | undefined;
  disabled: boolean;
  followed: boolean;
  locations: LocationChoice[];
  onBack: () => void;
  onChoose: (location: LocationRef) => void;
}) {
  return (
    <View style={styles.body}>
      {!followed ? (
        <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.followingCopy}>
          Starting here will add this project to Sessions on this device.
        </Text>
      ) : null}
      <Button
        accessibilityLabel="Back to projects"
        disabled={disabled}
        icon="chevron-left"
        label="Projects"
        onPress={onBack}
        variant="text"
      />
      <FlatList
        contentContainerStyle={styles.listContent}
        data={locations}
        ItemSeparatorComponent={RowSeparator}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(choice) => choice.key}
        renderItem={({ item: choice }) => (
          <LocationButton
            busy={busyKey === choice.key}
            disabled={disabled}
            directory={choice.location.directory}
            label={choice.label}
            onPress={() => onChoose(choice.location)}
          />
        )}
      />
    </View>
  );
}

function ProjectBrowser({
  defaultLocationQuery,
  onRetry,
  selection,
  ...listProps
}: {
  browseAll: boolean;
  creatingProjectID: string | undefined;
  defaultLocationQuery: DefaultLocationQuery;
  deferredSearch: string;
  disabled: boolean;
  followed: ReadonlySet<string>;
  onBrowseAll: () => void;
  onChooseProject: (project: Project) => void;
  onRetry: () => void;
  onSearch: (search: string) => void;
  search: string;
  selection: WorkspaceSelection;
}) {
  const state = projectBrowserState({
    loadFailed: Boolean(
      selection.projectsError || selection.preferencesError || defaultLocationQuery.isError,
    ),
    loading:
      selection.preferencesLoading || selection.projectsLoading || defaultLocationQuery.isPending,
    projectCount: selection.projects.length,
  });
  switch (state) {
    case "loading":
      return <StateMessage label="Loading projects" loading />;
    case "error":
      return (
        <LoadErrorState
          onRetry={() => {
            onRetry();
            void Promise.all([selection.refetch(), defaultLocationQuery.refetch()]);
          }}
        />
      );
    case "empty":
      return <NoProjectsState onRetry={() => void selection.refetch()} />;
    case "projects":
      return (
        <ProjectList
          {...listProps}
          followedProjectIds={selection.followedProjectIds}
          projects={selection.projects}
        />
      );
  }
}

function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.state}>
      <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
        Project locations could not be loaded from this connection.
      </Text>
      <Button align="center" label="Retry" onPress={onRetry} />
    </View>
  );
}

function NoProjectsState({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.state}>
      <Text dynamicTypeRamp={typeRamp.headline} style={styles.stateTitle}>
        No server projects found
      </Text>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateCopy}>
        OpenCode did not return any known projects.
      </Text>
      <Button align="center" label="Retry" onPress={onRetry} />
    </View>
  );
}

function ProjectList({
  browseAll,
  creatingProjectID,
  deferredSearch,
  disabled,
  followed,
  followedProjectIds,
  onBrowseAll,
  onChooseProject,
  onSearch,
  projects,
  search,
}: {
  browseAll: boolean;
  creatingProjectID: string | undefined;
  deferredSearch: string;
  disabled: boolean;
  followed: ReadonlySet<string>;
  followedProjectIds: string[];
  onBrowseAll: () => void;
  onChooseProject: (project: Project) => void;
  onSearch: (search: string) => void;
  projects: Project[];
  search: string;
}) {
  const showOtherProjects = browseAll || Boolean(deferredSearch);
  const rows = projectRows(
    matchingProjects(orderProjects(projects, followedProjectIds), deferredSearch),
    followed,
    showOtherProjects,
  );
  const otherProjectCount = projects.filter((project) => !followed.has(project.id)).length;
  const emptyCopy = emptyProjectListCopy(Boolean(deferredSearch), search);
  return (
    <View style={styles.body}>
      <SearchField
        clearAccessibilityLabel="Clear project search"
        onChangeText={onSearch}
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
              {emptyCopy.title}
            </Text>
            <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateCopy}>
              {emptyCopy.copy}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ProjectListRow
            creatingProjectID={creatingProjectID}
            disabled={disabled}
            followed={followed}
            onChooseProject={onChooseProject}
            row={item}
          />
        )}
      />
      {!showOtherProjects && otherProjectCount > 0 ? (
        <Button fullWidth label="Browse all projects" onPress={onBrowseAll} />
      ) : null}
    </View>
  );
}

function ProjectListRow({
  creatingProjectID,
  disabled,
  followed,
  onChooseProject,
  row,
}: {
  creatingProjectID: string | undefined;
  disabled: boolean;
  followed: ReadonlySet<string>;
  onChooseProject: (project: Project) => void;
  row: ProjectRow;
}) {
  const project = row.project;
  if (row.type === "section") {
    return (
      <Text
        accessibilityRole="header"
        dynamicTypeRamp={typeRamp.sectionLabel}
        style={styles.sectionTitle}
      >
        {row.title}
      </Text>
    );
  }
  if (!project) return null;
  return (
    <ProjectButton
      busy={creatingProjectID === project.id}
      disabled={disabled}
      followed={followed.has(project.id)}
      onPress={() => onChooseProject(project)}
      project={project}
    />
  );
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
  const { fontScale } = useWindowDimensions();
  const label = projectLabel(project);
  const path = sanitizeTranscriptText(project.canonical, 1_024);
  return (
    <ChoiceRow
      accessibilityLabel={`${label}, ${followed ? "followed" : "not followed, will be added to Sessions"}, ${path}`}
      busy={busy}
      disabled={disabled}
      onPress={onPress}
    >
      <View style={styles.projectTitleRow}>
        <ProjectAvatar
          icon={project.icon}
          lineHeight={typography.body.lineHeight * fontScale}
          name={label}
        />
        <Text
          dynamicTypeRamp={typeRamp.body}
          style={[styles.projectTitle, styles.projectTitleText]}
        >
          {label}
        </Text>
      </View>
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
      {busy ? (
        <ActivityIndicator color={palette.signal} />
      ) : (
        <Feather accessible={false} color={palette.dim} name="chevron-right" size={18} />
      )}
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
const rowRipple = rippleFeedback.row;

const styles = StyleSheet.create({
  body: { flex: 1, gap: space.md, padding: space.md },
  cancelButton: {
    justifyContent: "center",
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  cancelLabel: { ...typography.navTitle, color: palette.signal },
  disabled: { opacity: disabledOpacity },
  emptyState: { alignItems: "center", gap: space.xs, paddingVertical: space.xl },
  error: { ...typography.subheadline, color: palette.danger, textAlign: "center" },
  followNote: { ...typography.footnote, color: palette.info, marginTop: space.xs },
  followingCopy: { ...typography.subheadline, color: palette.dim },
  footerError: {
    ...typography.subheadline,
    color: palette.danger,
    paddingHorizontal: space.md,
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
  heading: { alignItems: "center", flex: 2, minWidth: 0 },
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
  projectTitleRow: { alignItems: "flex-start", flexDirection: "row", gap: space.sm },
  projectTitleText: { flex: 1, minWidth: 0 },
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
