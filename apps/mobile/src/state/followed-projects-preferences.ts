import type { LocationRef, ProjectListOutput } from "@opencode2-mobile/opencode-adapter";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  hasFollowedProjectPreference,
  readFollowedProjectIds,
  replaceFollowedProjectIds,
} from "../storage/followed-project-repository";
import { startSessionInbox, writeWorkingShelfExpanded } from "../storage/session-inbox-repository";
import {
  type InboxPreferenceState,
  inboxPreferencesFor,
  initialFollowedProjectID,
  type LocationSelection,
  nextLocationSelection,
  withWorkingExpanded,
} from "./followed-projects-model";

type PreferenceState = {
  connectionKey: string;
  hasPreference: boolean;
  loadFailed: boolean;
  projectIDs: string[];
};

type PreferenceWriter = {
  connectionID: string | undefined;
  connectionKey: string | undefined;
  connectionUpdatedAtMs: number | undefined;
  db: SQLiteDatabase;
  latestConnectionKeyRef: RefObject<string | undefined>;
  preferencesSaving: boolean;
  setPreferenceState: Dispatch<SetStateAction<PreferenceState | undefined>>;
  setPreferencesSaving: Dispatch<SetStateAction<boolean>>;
};

export function useFollowedProjectPreferences(
  db: SQLiteDatabase,
  connectionID: string | undefined,
  connectionKey: string | undefined,
  connectionUpdatedAtMs: number | undefined,
) {
  const latestConnectionKeyRef = useRef(connectionKey);
  latestConnectionKeyRef.current = connectionKey;
  const [preferenceState, setPreferenceState] = useState<PreferenceState>();
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<LocationSelection>();
  const preferenceReady = Boolean(
    connectionKey && preferenceState?.connectionKey === connectionKey,
  );

  useEffect(() => {
    setPreferenceState(undefined);
    setPreferencesSaving(false);
    setSearch("");
    setSelection(undefined);
    if (!connectionID || !connectionKey) return;
    let active = true;
    Promise.all([
      readFollowedProjectIds(db, connectionID),
      hasFollowedProjectPreference(db, connectionID),
    ])
      .then(([projectIDs, hasPreference]) => {
        if (active) {
          setPreferenceState({ connectionKey, hasPreference, loadFailed: false, projectIDs });
        }
      })
      .catch(() => {
        if (active) {
          setPreferenceState({
            connectionKey,
            hasPreference: true,
            loadFailed: true,
            projectIDs: [],
          });
        }
      });
    return () => {
      active = false;
    };
  }, [connectionID, connectionKey, db]);

  const setLocation = useCallback(
    (nextLocation: LocationRef | undefined) => {
      setSelection((current) => nextLocationSelection(current, nextLocation, connectionKey));
    },
    [connectionKey],
  );

  return {
    followedProjectIds: preferenceReady ? (preferenceState?.projectIDs ?? []) : [],
    hasPreference: preferenceState?.hasPreference,
    location:
      selection && selection.connectionKey === connectionKey ? selection.location : undefined,
    preferenceReady,
    preferencesError: Boolean(preferenceState?.loadFailed),
    preferencesSaving,
    search,
    setLocation,
    setSearch,
    writer: {
      connectionID,
      connectionKey,
      connectionUpdatedAtMs,
      db,
      latestConnectionKeyRef,
      preferencesSaving,
      setPreferenceState,
      setPreferencesSaving,
    } satisfies PreferenceWriter,
  };
}

export function useSessionInboxPreferences(
  db: SQLiteDatabase,
  connectionID: string | undefined,
  connectionKey: string | undefined,
  connectionUpdatedAtMs: number | undefined,
) {
  const [inboxPreferenceState, setInboxPreferenceState] = useState<InboxPreferenceState>();
  useEffect(() => {
    setInboxPreferenceState(undefined);
    if (!connectionID || !connectionKey || connectionUpdatedAtMs === undefined) return;
    let active = true;
    const nowMs = Date.now();
    // A device that cannot store its inbox start still shows one, starting now.
    void startSessionInbox(db, connectionID, connectionUpdatedAtMs, nowMs)
      .catch(() => ({ sinceMs: nowMs, workingExpanded: true }))
      .then((preferences) => {
        if (active) setInboxPreferenceState({ connectionKey, preferences });
      });
    return () => {
      active = false;
    };
  }, [connectionID, connectionKey, connectionUpdatedAtMs, db]);
  const inboxPreferences = inboxPreferencesFor(inboxPreferenceState, connectionKey);

  const setWorkingExpanded = useCallback(
    (expanded: boolean) => {
      if (!connectionID || !connectionKey) return;
      setInboxPreferenceState((current) => withWorkingExpanded(current, connectionKey, expanded));
      if (connectionUpdatedAtMs === undefined) return;
      // The shelf follows the tap even when the device cannot store it.
      void writeWorkingShelfExpanded(db, connectionID, connectionUpdatedAtMs, expanded).catch(
        () => undefined,
      );
    },
    [connectionID, connectionKey, connectionUpdatedAtMs, db],
  );

  return {
    inboxSinceMs: inboxPreferences?.sinceMs,
    setWorkingExpanded,
    workingExpanded: inboxPreferences?.workingExpanded ?? true,
  };
}

export function useInitialFollowedProject(
  writer: PreferenceWriter,
  input: {
    defaultProjectID: string | undefined;
    hasPreference: boolean | undefined;
    preferenceReady: boolean;
    projects: ProjectListOutput;
  },
) {
  const {
    connectionID,
    connectionKey,
    connectionUpdatedAtMs,
    db,
    latestConnectionKeyRef,
    preferencesSaving,
    setPreferenceState,
    setPreferencesSaving,
  } = writer;
  const { defaultProjectID, hasPreference, preferenceReady, projects } = input;
  useEffect(() => {
    if (
      !connectionID ||
      !connectionKey ||
      !preferenceReady ||
      hasPreference !== false ||
      projects.length === 0 ||
      preferencesSaving
    ) {
      return;
    }
    const initialProjectID = initialFollowedProjectID(projects, defaultProjectID);
    if (!initialProjectID) return;
    setPreferencesSaving(true);
    void replaceFollowedProjectIds(db, connectionID, [initialProjectID], connectionUpdatedAtMs)
      .then(() => {
        if (latestConnectionKeyRef.current !== connectionKey) return;
        setPreferenceState({
          connectionKey,
          hasPreference: true,
          loadFailed: false,
          projectIDs: [initialProjectID],
        });
      })
      .catch(() => {
        if (latestConnectionKeyRef.current !== connectionKey) return;
        setPreferenceState({
          connectionKey,
          hasPreference: true,
          loadFailed: true,
          projectIDs: [],
        });
      })
      .finally(() => {
        if (latestConnectionKeyRef.current === connectionKey) setPreferencesSaving(false);
      });
  }, [
    connectionID,
    connectionKey,
    connectionUpdatedAtMs,
    db,
    defaultProjectID,
    hasPreference,
    latestConnectionKeyRef,
    preferenceReady,
    preferencesSaving,
    projects,
    setPreferenceState,
    setPreferencesSaving,
  ]);
}

export function useSetFollowedProjectIds(writer: PreferenceWriter) {
  const {
    connectionID,
    connectionKey,
    connectionUpdatedAtMs,
    db,
    latestConnectionKeyRef,
    preferencesSaving,
    setPreferenceState,
    setPreferencesSaving,
  } = writer;
  return useCallback(
    async (projectIDs: readonly string[]) => {
      if (!connectionID || !connectionKey || preferencesSaving) return;
      setPreferencesSaving(true);
      try {
        await replaceFollowedProjectIds(db, connectionID, projectIDs, connectionUpdatedAtMs);
        if (latestConnectionKeyRef.current !== connectionKey) return;
        setPreferenceState({
          connectionKey,
          hasPreference: true,
          loadFailed: false,
          projectIDs: [...projectIDs],
        });
      } finally {
        if (latestConnectionKeyRef.current === connectionKey) setPreferencesSaving(false);
      }
    },
    [
      connectionID,
      connectionKey,
      connectionUpdatedAtMs,
      db,
      latestConnectionKeyRef,
      preferencesSaving,
      setPreferenceState,
      setPreferencesSaving,
    ],
  );
}
