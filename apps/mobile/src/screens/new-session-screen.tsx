import Feather from "@expo/vector-icons/Feather";
import {
  createOpenCodeSession,
  findOpenCodeFiles,
  getDefaultOpenCodeAgent,
  getDefaultOpenCodeLocation,
  getDefaultOpenCodeModel,
  getOpenCodeLocation,
  type LocationRef,
  listOpenCodeAgents,
  listOpenCodeCommands,
  listOpenCodeModels,
  listOpenCodeSkills,
  type ModelRef,
  type OpenCodeClient,
} from "@opencode2-mobile/opencode-adapter";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useSQLiteContext } from "expo-sqlite";
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
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../components/button";
import { SearchField } from "../components/search-field";
import { useAnnouncement } from "../components/use-announcement";
import type { RootStackParamList } from "../navigation/root-navigation";
import { SessionHeaderTitle } from "../navigation/session-header-title";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { useModelFavorites } from "../state/use-model-favorites";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { type SessionDraftMention, writeSessionDraft } from "../storage/draft-repository";
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
import { isTabletShell } from "./app-shell";
import { FormKeyboardAvoidingView } from "./form-keyboard-avoiding-view";
import {
  createSessionFailure,
  emptyProjectListCopy,
  initialLocationKey,
  initialProjectID,
  type LocationChoice,
  matchingProjects,
  newSessionDraftID,
  orderProjects,
  type Project,
  pickerProjects,
  projectBrowserState,
  projectLabel,
  projectLocations,
} from "./new-session-screen-model";
import { SessionComposer } from "./session-composer";
import {
  mentionableAgents,
  modelRef,
  primaryAgents,
  resolveSessionAgent,
  selectableModels,
} from "./session-execution-model";
import { sanitizeTranscriptText } from "./session-transcript-model";
import { useSessionDraft } from "./use-session-draft";
import { mentionFileState } from "./workspace-screen-model";

type Props = NativeStackScreenProps<RootStackParamList, "NewSession">;
type Navigation = Props["navigation"];
type WorkspaceSelection = ReturnType<typeof useWorkspaceSelection>;
type DefaultLocationQuery = ReturnType<typeof useDefaultLocationQuery>;
type CreateRequest = {
  agent: string | undefined;
  mentions: SessionDraftMention[];
  model: ModelRef | undefined;
  project: Project;
  requested: LocationRef;
  text: string;
};

const mentionFileLimit = 20;

// A new session reads like an empty chat: the projects sit above the composer, the selected
// one is highlighted, and sending the first message creates the session there.
export function NewSessionScreen({ navigation }: Props) {
  const { fontScale, width } = useWindowDimensions();
  const largeText = usesLargeTextLayout(fontScale);
  const tablet = isTabletShell(width);
  const runtime = useConnectionRuntime();
  const selection = useWorkspaceSelection();
  const connectionID = runtime.connectionId;
  const client = runtime.restClient ?? undefined;
  const favorites = useModelFavorites(connectionID, runtime.connectionUpdatedAtMs);
  const draft = useSessionDraft(connectionID ?? "unselected", newSessionDraftID);
  const createAbortRef = useRef<AbortController>(null);
  const closedRef = useRef(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [chosenProjectID, setChosenProjectID] = useState<string>();
  const [chosenLocationKey, setChosenLocationKey] = useState<string>();
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const defaultLocationQuery = useDefaultLocationQuery(client, connectionID);

  useEffect(() => {
    void connectionID;
    closedRef.current = false;
    createAbortRef.current?.abort();
    setError(undefined);
    setSearch("");
    setBrowsing(false);
    setChosenProjectID(undefined);
    setChosenLocationKey(undefined);
    return () => createAbortRef.current?.abort();
  }, [connectionID]);

  const { locationChoice, locations, project } = resolveNewSessionTarget(
    selection,
    defaultLocationQuery.data,
    chosenProjectID,
    chosenLocationKey,
  );

  const createMutation = useCreateSessionMutation({
    client,
    closedRef,
    connectionID,
    createAbortRef,
    defaultLocationQuery,
    navigation,
    onDraftHandedOff: draft.clearDraft,
    selection,
    setChosenProjectID,
    setError,
  });
  const creating = createMutation.isPending;
  const browserState = newSessionBrowserState(selection, defaultLocationQuery);
  const ready = browserState === "projects" && Boolean(project && locationChoice);
  const pickerDisabled = creating || selection.preferencesSaving;

  function chooseProject(next: Project) {
    if (pickerDisabled) return;
    setError(undefined);
    setChosenProjectID(next.id);
    setChosenLocationKey(undefined);
    setBrowsing(false);
    setSearch("");
  }

  function close() {
    closedRef.current = true;
    createAbortRef.current?.abort();
    navigation.goBack();
  }

  useAnnouncement(creating && "Creating session");
  useAnnouncement(error);
  useAbortOnLeave(navigation, closedRef, createAbortRef);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <FormKeyboardAvoidingView style={styles.keyboardView}>
        <NewSessionHeader
          largeText={largeText}
          modal={tablet}
          onClose={close}
          subtitle={project ? projectLabel(project) : undefined}
        />
        <NewSessionPicker
          browserState={browserState}
          browsing={browsing}
          deferredSearch={deferredSearch}
          disabled={pickerDisabled}
          followedProjectIds={selection.followedProjectIds}
          locationKey={locationChoice?.key}
          locations={locations}
          onBrowse={() => setBrowsing(true)}
          onChooseLocation={(key) => {
            if (pickerDisabled) return;
            setError(undefined);
            setChosenLocationKey(key);
          }}
          onChooseProject={chooseProject}
          onCloseSearch={() => {
            setBrowsing(false);
            setSearch("");
          }}
          onRetry={() => {
            setError(undefined);
            void Promise.all([selection.refetch(), defaultLocationQuery.refetch()]);
          }}
          onSearch={setSearch}
          projects={selection.projects}
          search={search}
          selectedProjectID={project?.id}
        />
        <NewSessionStatus creating={creating} error={error} />
        {browsing ? null : (
          <NewSessionComposer
            client={client}
            connectionID={connectionID}
            creating={creating}
            disabled={!ready || creating || selection.preferencesSaving}
            draft={draft}
            favorites={favorites}
            // Agent, model, and mention choices belong to one connection's catalog.
            key={connectionID ?? "unselected"}
            largeText={largeText}
            location={locationChoice?.location}
            onSubmit={(agent, model) => {
              if (!project || !locationChoice) return;
              createMutation.mutate({
                agent,
                mentions: draft.mentions,
                model,
                project,
                requested: locationChoice.location,
                text: draft.draft,
              });
            }}
          />
        )}
      </FormKeyboardAvoidingView>
    </SafeAreaView>
  );
}

// The project and location a new session would start in: the user's choice, or else the
// project last worked in and its matching location.
function resolveNewSessionTarget(
  selection: WorkspaceSelection,
  defaultLocation: DefaultLocationQuery["data"],
  chosenProjectID: string | undefined,
  chosenLocationKey: string | undefined,
) {
  const projectID =
    chosenProjectID ??
    initialProjectID(
      selection.projects,
      selection.followedProjectIds,
      selection.location,
      defaultLocation,
    );
  const project = selection.projects.find((candidate) => candidate.id === projectID);
  const locations = projectLocations(project, defaultLocation);
  const locationChoice =
    locations.find((choice) => choice.key === chosenLocationKey) ??
    locations.find((choice) => choice.key === initialLocationKey(locations, selection.location));
  return { locationChoice, locations, project };
}

function newSessionBrowserState(
  selection: WorkspaceSelection,
  defaultLocationQuery: DefaultLocationQuery,
) {
  return projectBrowserState({
    loadFailed: Boolean(
      selection.projectsError || selection.preferencesError || defaultLocationQuery.isError,
    ),
    loading:
      selection.preferencesLoading || selection.projectsLoading || defaultLocationQuery.isPending,
    projectCount: selection.projects.length,
  });
}

function NewSessionPicker({
  browserState,
  browsing,
  deferredSearch,
  disabled,
  followedProjectIds,
  locationKey,
  locations,
  onBrowse,
  onChooseLocation,
  onChooseProject,
  onCloseSearch,
  onRetry,
  onSearch,
  projects,
  search,
  selectedProjectID,
}: {
  browserState: ReturnType<typeof projectBrowserState>;
  browsing: boolean;
  deferredSearch: string;
  disabled: boolean;
  followedProjectIds: string[];
  locationKey: string | undefined;
  locations: LocationChoice[];
  onBrowse: () => void;
  onChooseLocation: (key: string) => void;
  onChooseProject: (project: Project) => void;
  onCloseSearch: () => void;
  onRetry: () => void;
  onSearch: (search: string) => void;
  projects: Project[];
  search: string;
  selectedProjectID: string | undefined;
}) {
  const followed = new Set(followedProjectIds);
  let content: ReactNode;
  if (browserState !== "projects") {
    content = <ProjectLoadState onRetry={onRetry} state={browserState} />;
  } else if (browsing) {
    content = (
      <ProjectSearch
        deferredSearch={deferredSearch}
        followed={followed}
        followedProjectIds={followedProjectIds}
        onChoose={onChooseProject}
        onClose={onCloseSearch}
        onSearch={onSearch}
        projects={projects}
        search={search}
      />
    );
  } else {
    content = (
      <ProjectPicker
        disabled={disabled}
        followed={followed}
        locationKey={locationKey}
        locations={locations}
        onBrowse={onBrowse}
        onChooseLocation={onChooseLocation}
        onChooseProject={onChooseProject}
        projects={pickerProjects(projects, followedProjectIds, selectedProjectID)}
        selectedProjectID={selectedProjectID}
      />
    );
  }
  return (
    <ScrollView
      contentContainerStyle={styles.pickerContent}
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
      style={styles.picker}
    >
      {content}
    </ScrollView>
  );
}

function NewSessionStatus({ creating, error }: { creating: boolean; error: string | undefined }) {
  return (
    <>
      {creating ? (
        <View style={styles.creating}>
          <ActivityIndicator color={palette.signal} />
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.creatingCopy}>
            Creating session
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          dynamicTypeRamp={typeRamp.subheadline}
          style={styles.footerError}
        >
          {error}
        </Text>
      ) : null}
    </>
  );
}

function NewSessionComposer({
  client,
  connectionID,
  creating,
  disabled,
  draft,
  favorites,
  largeText,
  location,
  onSubmit,
}: {
  client: OpenCodeClient | undefined;
  connectionID: string | undefined;
  creating: boolean;
  disabled: boolean;
  draft: ReturnType<typeof useSessionDraft>;
  favorites: ReturnType<typeof useModelFavorites>;
  largeText: boolean;
  location: LocationRef | undefined;
  onSubmit: (agent: string | undefined, model: ModelRef | undefined) => void;
}) {
  const [agentOverride, setAgentOverride] = useState<string>();
  const [modelOverride, setModelOverride] = useState<ModelRef>();
  const [mentionSearch, setMentionSearch] = useState<string>();
  const deferredMentionSearch = useDeferredValue(mentionSearch);
  const catalog = useNewSessionCatalog({
    client,
    connectionID,
    location,
    mentionSearch: deferredMentionSearch,
  });
  const agent = resolveSessionAgent(
    agentOverride,
    catalog.defaultAgent,
    catalog.agents.map((candidate) => candidate.id),
  );
  const agentModel = catalog.agents.find((candidate) => candidate.id === agent)?.model;
  const model = modelOverride ?? agentModel ?? catalog.defaultModel;
  const mentions = mentionFileState({
    deferredSearch: deferredMentionSearch,
    executionLoading: catalog.mentionLoading,
    executionUnavailable: catalog.mentionUnavailable,
    files: catalog.mentionFiles.data?.data,
    filesError: catalog.mentionFiles.isError,
    filesPending: catalog.mentionFiles.isPending,
    search: mentionSearch,
  });
  return (
    <SessionComposer
      active={false}
      agent={agent}
      agentCatalog={catalog.agentCatalog}
      agents={catalog.agents}
      alwaysExpanded
      commands={catalog.commands}
      completionLoading={catalog.completionLoading}
      completionUnavailable={catalog.completionUnavailable}
      disabled={disabled || !draft.loaded}
      draft={draft.draft}
      editable={draft.loaded && !creating}
      error={draft.error}
      favorites={favorites}
      largeText={largeText}
      location={location ?? { directory: "" }}
      mentionAgents={catalog.mentionAgents}
      mentionFiles={mentions.files}
      mentionLoading={mentions.loading}
      mentions={draft.mentions}
      mentionUnavailable={mentions.unavailable}
      model={model}
      modelCatalog={catalog.modelCatalog}
      models={catalog.models}
      onAgentChange={setAgentOverride}
      onDraftChange={draft.setDraft}
      onMentionSearchChange={setMentionSearch}
      onModelChange={setModelOverride}
      onSubmit={() => onSubmit(agent, model)}
      skills={catalog.skills}
    />
  );
}

function useDefaultLocationQuery(client: OpenCodeClient | undefined, connectionID?: string) {
  return useQuery({
    enabled: Boolean(client && connectionID),
    queryFn: ({ signal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return getDefaultOpenCodeLocation(client, { signal });
    },
    queryKey: openCodeQueryKeys.defaultLocation(connectionID ?? "unselected"),
  });
}

// The agents, models, and completions for the chosen location. The keys match the session
// screen's, so the catalog is already warm when the new session opens.
function useNewSessionCatalog({
  client,
  connectionID,
  location,
  mentionSearch,
}: {
  client: OpenCodeClient | undefined;
  connectionID: string | undefined;
  location: LocationRef | undefined;
  mentionSearch: string | undefined;
}) {
  const scope = connectionID ?? "unselected";
  const at = location ?? { directory: "" };
  const enabled = Boolean(client && connectionID && location);
  const load =
    <T,>(request: (ready: OpenCodeClient, signal: AbortSignal) => Promise<T>) =>
    ({ signal }: { signal: AbortSignal }) => {
      if (!client) throw new Error("CONNECTION_NOT_READY");
      return request(client, signal);
    };
  const agentsQuery = useQuery({
    enabled,
    queryFn: load((ready, signal) => listOpenCodeAgents(ready, at, { signal })),
    queryKey: openCodeQueryKeys.agents(scope, at),
  });
  const defaultAgentQuery = useQuery({
    enabled,
    queryFn: load((ready, signal) => getDefaultOpenCodeAgent(ready, at, { signal })),
    queryKey: [...openCodeQueryKeys.agents(scope, at), "default"],
  });
  const modelsQuery = useQuery({
    enabled,
    queryFn: load((ready, signal) => listOpenCodeModels(ready, at, { signal })),
    queryKey: openCodeQueryKeys.models(scope, at),
  });
  const defaultModelQuery = useQuery({
    enabled,
    queryFn: load((ready, signal) => getDefaultOpenCodeModel(ready, at, { signal })),
    queryKey: [...openCodeQueryKeys.models(scope, at), "default"],
  });
  const commandsQuery = useQuery({
    enabled,
    queryFn: load((ready, signal) => listOpenCodeCommands(ready, at, { signal })),
    queryKey: openCodeQueryKeys.commands(scope, at),
  });
  const skillsQuery = useQuery({
    enabled,
    queryFn: load((ready, signal) => listOpenCodeSkills(ready, at, { signal })),
    queryKey: openCodeQueryKeys.skills(scope, at),
  });
  const mentionFiles = useQuery({
    enabled: enabled && mentionSearch !== undefined,
    queryFn: load((ready, signal) =>
      findOpenCodeFiles(ready, at, mentionSearch ?? "", { limit: mentionFileLimit, signal }),
    ),
    queryKey: openCodeQueryKeys.fileFind(scope, at, mentionSearch ?? "", mentionFileLimit),
  });
  return {
    agentCatalog: {
      error: agentsQuery.isError,
      loading: agentsQuery.isPending,
      retry: () => void agentsQuery.refetch(),
    },
    agents: primaryAgents(agentsQuery.data?.data ?? []),
    commands: commandsQuery.data?.data ?? [],
    completionLoading: commandsQuery.isPending,
    completionUnavailable: commandsQuery.isError,
    defaultAgent: defaultAgentQuery.data,
    defaultModel: modelRef(defaultModelQuery.data?.data),
    mentionAgents: mentionableAgents(agentsQuery.data?.data ?? []),
    mentionFiles,
    mentionLoading: agentsQuery.isPending || skillsQuery.isPending,
    mentionUnavailable: agentsQuery.isError || skillsQuery.isError,
    modelCatalog: {
      error: modelsQuery.isError,
      loading: modelsQuery.isPending,
      retry: () => void modelsQuery.refetch(),
    },
    models: selectableModels(modelsQuery.data?.data ?? []),
    skills: skillsQuery.data?.data ?? [],
  };
}

function useCreateSessionMutation({
  client,
  closedRef,
  connectionID,
  createAbortRef,
  defaultLocationQuery,
  navigation,
  onDraftHandedOff,
  selection,
  setChosenProjectID,
  setError,
}: {
  client: OpenCodeClient | undefined;
  closedRef: RefObject<boolean>;
  connectionID: string | undefined;
  createAbortRef: RefObject<AbortController | null>;
  defaultLocationQuery: DefaultLocationQuery;
  navigation: Navigation;
  onDraftHandedOff: () => void;
  selection: WorkspaceSelection;
  setChosenProjectID: (projectID: string | undefined) => void;
  setError: (error: string | undefined) => void;
}) {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: CreateRequest) => {
      if (!client || !connectionID) throw new Error("CONNECTION_NOT_READY");
      const controller = new AbortController();
      createAbortRef.current?.abort();
      createAbortRef.current = controller;
      try {
        const created = await createSessionInProject(client, selection, request, controller);
        // The message moves to the new session's encrypted draft, and the session screen
        // sends it from there, so a failed send leaves the text in its composer.
        const handedOff = await writeSessionDraft(db, {
          connectionId: connectionID,
          content: request.text,
          mentions: request.mentions,
          revision: 1,
          sessionId: created.session.id,
        }).then(
          () => true,
          () => false,
        );
        return { ...created, handedOff };
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
        setChosenProjectID(undefined);
        setError("The project list changed. Choose the project again.");
        void Promise.all([selection.refetch(), defaultLocationQuery.refetch()]);
        return;
      }
      setError(
        "The session could not be created. Check this project and connection, then try again.",
      );
    },
    onMutate: () => setError(undefined),
    onSuccess: ({ handedOff, location, session }) => {
      if (!connectionID) return;
      queryClient.setQueryData(
        openCodeQueryKeys.session(connectionID, location, session.id),
        session,
      );
      void selection.refetch();
      if (handedOff) onDraftHandedOff();
      if (closedRef.current) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      navigation.replace("Session", {
        connectionId: connectionID,
        location,
        sessionID: session.id,
        ...(handedOff ? { sendDraft: true } : { focusComposer: true }),
      });
    },
  });
}

async function createSessionInProject(
  client: OpenCodeClient,
  selection: WorkspaceSelection,
  { agent, model, project, requested }: CreateRequest,
  controller: AbortController,
) {
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
    { ...(agent ? { agent } : {}), ...(model ? { model } : {}) },
    { signal: controller.signal },
  );
  return { location, session };
}

function useAbortOnLeave(
  navigation: Navigation,
  closedRef: RefObject<boolean>,
  createAbortRef: RefObject<AbortController | null>,
) {
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (event.data.action.type === "REPLACE") return;
        closedRef.current = true;
        createAbortRef.current?.abort();
      }),
    [closedRef, createAbortRef, navigation],
  );
}

function NewSessionHeader({
  largeText,
  modal,
  onClose,
  subtitle,
}: {
  largeText: boolean;
  modal: boolean;
  onClose: () => void;
  subtitle: string | undefined;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel={modal ? "Cancel" : "Back to Sessions"}
        accessibilityRole="button"
        android_ripple={rippleFeedback.borderless}
        onPress={onClose}
        style={({ pressed }) => [
          modal ? styles.cancelButton : styles.headerSide,
          pressed && Platform.OS === "ios" && styles.pressed,
        ]}
      >
        {modal ? (
          <Text dynamicTypeRamp={typeRamp.navTitle} style={styles.cancelLabel}>
            Cancel
          </Text>
        ) : (
          <Feather
            accessible={false}
            color={palette.signal}
            name={Platform.OS === "android" ? "arrow-left" : "chevron-left"}
            size={Platform.OS === "android" ? 24 : 28}
          />
        )}
      </Pressable>
      <View style={[styles.headerTitle, largeText && styles.headerTitleLargeText]}>
        <SessionHeaderTitle subtitle={subtitle} title="New session" />
      </View>
      {largeText ? null : <View style={modal ? styles.cancelButton : styles.headerSide} />}
    </View>
  );
}

function ProjectPicker({
  disabled,
  followed,
  locationKey,
  locations,
  onBrowse,
  onChooseLocation,
  onChooseProject,
  projects,
  selectedProjectID,
}: {
  disabled: boolean;
  followed: ReadonlySet<string>;
  locationKey: string | undefined;
  locations: LocationChoice[];
  onBrowse: () => void;
  onChooseLocation: (key: string) => void;
  onChooseProject: (project: Project) => void;
  projects: Project[];
  selectedProjectID: string | undefined;
}) {
  return (
    <View accessibilityLabel="Projects" style={styles.list}>
      {projects.map((project) => {
        const selected = project.id === selectedProjectID;
        return (
          <View key={project.id}>
            <PickerRow
              accessibilityHint={selected ? undefined : "Starts the new session in this project"}
              disabled={disabled}
              icon="folder"
              label={projectLabel(project)}
              note={followed.has(project.id) ? undefined : "Will be added to Sessions"}
              onPress={() => onChooseProject(project)}
              selected={selected}
            />
            {selected && locations.length > 1
              ? locations.map((choice) => (
                  <PickerRow
                    accessibilityHint="Starts the new session in this location"
                    disabled={disabled}
                    icon="git-branch"
                    inset
                    key={choice.key}
                    label={choice.label}
                    note={sanitizeTranscriptText(choice.location.directory, 1_024)}
                    onPress={() => onChooseLocation(choice.key)}
                    selected={choice.key === locationKey}
                  />
                ))
              : null}
          </View>
        );
      })}
      <PickerRow
        accessibilityHint="Search every project on this server"
        disabled={disabled}
        icon="search"
        label="All projects"
        onPress={onBrowse}
        selected={false}
      />
    </View>
  );
}

function PickerRow({
  accessibilityHint,
  disabled,
  icon,
  inset = false,
  label,
  note,
  onPress,
  selected,
}: {
  accessibilityHint?: string | undefined;
  disabled: boolean;
  icon: "folder" | "git-branch" | "search";
  inset?: boolean;
  label: string;
  note?: string | undefined;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={note ? `${label}, ${note}` : label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      android_ripple={rippleFeedback.row}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        inset && styles.rowInset,
        selected && styles.rowSelected,
        disabled && styles.disabled,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
    >
      <Feather
        accessible={false}
        color={selected ? palette.accent : palette.dim}
        name={icon}
        size={inset ? 16 : 20}
      />
      <View style={styles.rowCopy}>
        <Text
          dynamicTypeRamp={typeRamp.body}
          numberOfLines={1}
          style={[styles.rowLabel, selected && styles.rowLabelSelected]}
        >
          {label}
        </Text>
        {note ? (
          <Text dynamicTypeRamp={typeRamp.footnote} numberOfLines={1} style={styles.rowNote}>
            {note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function ProjectSearch({
  deferredSearch,
  followed,
  followedProjectIds,
  onChoose,
  onClose,
  onSearch,
  projects,
  search,
}: {
  deferredSearch: string;
  followed: ReadonlySet<string>;
  followedProjectIds: string[];
  onChoose: (project: Project) => void;
  onClose: () => void;
  onSearch: (search: string) => void;
  projects: Project[];
  search: string;
}) {
  const matches = matchingProjects(orderProjects(projects, followedProjectIds), deferredSearch);
  const emptyCopy = emptyProjectListCopy(true, search);
  return (
    <View style={styles.search}>
      <View style={styles.searchHeader}>
        <View style={styles.searchField}>
          <SearchField
            autoFocus
            clearAccessibilityLabel="Clear project search"
            onChangeText={onSearch}
            placeholder="Search projects"
            returnKeyType="search"
            value={search}
          />
        </View>
        <Button label="Done" onPress={onClose} variant="text" />
      </View>
      {matches.length === 0 ? (
        <View style={styles.state}>
          <Text dynamicTypeRamp={typeRamp.headline} style={styles.stateTitle}>
            {emptyCopy.title}
          </Text>
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateCopy}>
            {emptyCopy.copy}
          </Text>
        </View>
      ) : (
        matches.map((project) => (
          <PickerRow
            accessibilityHint="Starts the new session in this project"
            disabled={false}
            icon="folder"
            key={project.id}
            label={projectLabel(project)}
            note={
              followed.has(project.id)
                ? sanitizeTranscriptText(project.canonical, 1_024)
                : `${sanitizeTranscriptText(project.canonical, 1_024)} · Will be added to Sessions`
            }
            onPress={() => onChoose(project)}
            selected={false}
          />
        ))
      )}
    </View>
  );
}

function ProjectLoadState({
  onRetry,
  state,
}: {
  onRetry: () => void;
  state: "empty" | "error" | "loading";
}) {
  switch (state) {
    case "loading":
      return (
        <View style={styles.state}>
          <ActivityIndicator accessibilityLabel="Loading projects" color={palette.signal} />
          <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.stateCopy}>
            Loading projects
          </Text>
        </View>
      );
    case "error":
      return (
        <View style={styles.state}>
          <Text
            accessibilityRole="alert"
            dynamicTypeRamp={typeRamp.subheadline}
            style={styles.error}
          >
            Project locations could not be loaded from this connection.
          </Text>
          <Button align="center" label="Retry" onPress={onRetry} />
        </View>
      );
    case "empty":
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
}

const styles = StyleSheet.create({
  cancelButton: {
    justifyContent: "center",
    minHeight: minTouchTarget,
    minWidth: 72,
  },
  cancelLabel: { ...typography.navTitle, color: palette.signal },
  creating: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "center",
    paddingVertical: space.xs,
  },
  creatingCopy: { ...typography.subheadline, color: palette.dim },
  disabled: { opacity: disabledOpacity },
  error: { ...typography.subheadline, color: palette.danger, textAlign: "center" },
  footerError: {
    ...typography.subheadline,
    color: palette.danger,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: 8,
  },
  headerSide: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  headerTitle: { alignItems: "center", flex: 1, minWidth: 0 },
  headerTitleLargeText: { alignItems: "flex-start" },
  keyboardView: { flex: 1 },
  list: { gap: 2 },
  picker: { flex: 1 },
  // Rows gather at the bottom, next to the composer, like the last lines of a chat.
  pickerContent: {
    alignSelf: "center",
    flexGrow: 1,
    justifyContent: "flex-end",
    maxWidth: 720,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    width: "100%",
  },
  pressed: { opacity: pressedOpacity },
  row: {
    alignItems: "center",
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: space.md,
    minHeight: minTouchTarget,
    overflow: "hidden",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowInset: { marginLeft: space.lg, minHeight: 44 },
  rowLabel: { ...typography.body, color: palette.dim },
  rowLabelSelected: { ...typography.headline, color: palette.ink },
  rowNote: {
    ...typography.footnote,
    color: palette.dim,
    fontFamily: typography.code.fontFamily,
  },
  rowSelected: { backgroundColor: palette.card },
  screen: { backgroundColor: palette.background, flex: 1 },
  search: { gap: space.xs },
  searchField: { flex: 1 },
  searchHeader: { alignItems: "center", flexDirection: "row", gap: space.sm },
  state: {
    alignItems: "center",
    gap: space.sm,
    justifyContent: "center",
    padding: space.xl,
  },
  stateCopy: { ...typography.subheadline, color: palette.dim, textAlign: "center" },
  stateTitle: { ...typography.headline, color: palette.ink, textAlign: "center" },
});
