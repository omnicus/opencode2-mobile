import {
  type OpenCodeClient,
  removeOpenCodeSession,
  renameOpenCodeSession,
  type SessionInfo,
} from "@opencode2-mobile/opencode-adapter";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type SQLiteDatabase, useSQLiteContext } from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput } from "react-native";
import { Button } from "../components/button";
import { MenuGroup, MenuRow } from "../components/menu-row";
import { ModalSheet } from "../components/modal-sheet";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { useWorkspaceSelection } from "../state/workspace-selection-context";
import { deleteSessionLocalState } from "../storage/prompt-admission-repository";
import { minTouchTarget, palette, radius, space, typeRamp, typography } from "../theme";
import {
  canSaveSessionName,
  type SessionAction,
  type SessionSheetPage,
  sessionActionReady,
  sessionArchiveLabel,
  sessionSheetSize,
  sessionSheetTitles,
} from "./session-action-sheet-model";
import { loadOpenCodeSessionTreeIds } from "./session-deletion";
import { SessionDevTools } from "./session-location-options";
import { sanitizeTranscriptText } from "./session-transcript-model";

export function SessionActionSheet({
  connectionId,
  session,
  onClose,
  onDeleted,
  branch,
  branchStale = false,
}: {
  connectionId: string;
  session: SessionInfo;
  onClose: () => void;
  onDeleted: () => void;
  branch?: string | undefined;
  branchStale?: boolean;
}) {
  const runtime = useConnectionRuntime();
  const archived = session.time.archived !== undefined;
  const [page, setPage] = useState<SessionSheetPage>("menu");
  const [title, setTitle] = useState(session.title ?? "");
  const sameConnection = runtime.connectionId === connectionId;
  const connected = sameConnection && runtime.status === "connected" && Boolean(runtime.restClient);
  const { busy, controllerRef, error, perform, setError } = useSessionActionRunner({
    archived,
    connected,
    connectionId,
    onClose,
    onDeleted,
    runtime,
    session,
    title,
  });

  return (
    <ModalSheet
      title={sessionSheetTitles[page]}
      subtitle={session.title || "Untitled session"}
      visible
      onClose={() => {
        if (!controllerRef.current) onClose();
      }}
      size={sessionSheetSize(page)}
      // Done closes the menu; Cancel when closing abandons a rename or a delete.
      closeLabel={page === "rename" || page === "delete" ? "Cancel" : "Done"}
    >
      {page !== "menu" ? (
        <Button
          accessibilityLabel="Back to session actions"
          disabled={busy}
          icon="chevron-left"
          label="Session actions"
          onPress={() => {
            setPage("menu");
            setError(undefined);
          }}
          variant="text"
        />
      ) : null}
      {page === "menu" ? (
        <SessionMenuPage
          archived={archived}
          busy={busy}
          connected={connected}
          onArchive={() => void perform("archive")}
          onPage={setPage}
          sameConnection={sameConnection}
        />
      ) : null}
      {page === "rename" ? (
        <SessionRenamePage
          busy={busy}
          canSave={canSaveSessionName(connected, title, session.title)}
          onChangeTitle={setTitle}
          onSave={() => void perform("rename")}
          title={title}
        />
      ) : null}
      {page === "delete" ? (
        <SessionDeletePage
          busy={busy}
          connected={connected}
          directory={session.location.directory}
          onConfirm={() => void perform("delete")}
        />
      ) : null}
      <SessionDevTools
        connectionId={connectionId}
        location={session.location}
        ready={sameConnection}
        visible={page === "devtools"}
        branch={branch}
        branchStale={branchStale}
      />
      {error ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
          {error}
        </Text>
      ) : null}
    </ModalSheet>
  );
}

function useSessionActionRunner({
  archived,
  connected,
  connectionId,
  onClose,
  onDeleted,
  runtime,
  session,
  title,
}: {
  archived: boolean;
  connected: boolean;
  connectionId: string;
  onClose: () => void;
  onDeleted: () => void;
  runtime: ReturnType<typeof useConnectionRuntime>;
  session: SessionInfo;
  title: string;
}) {
  const queryClient = useQueryClient();
  const db = useSQLiteContext();
  const workspaceSelection = useWorkspaceSelection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (runtime.connectionId !== connectionId) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setBusy(false);
    }
    return () => {
      controllerRef.current?.abort();
    };
  }, [connectionId, runtime.connectionId]);

  async function perform(action: SessionAction) {
    const client = runtime.restClient;
    if (controllerRef.current || runtime.connectionId !== connectionId) return;
    if (!client || !sessionActionReady(action, { connected, title })) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const cleanupIncomplete = await applySessionAction(action, {
        archiveSession: workspaceSelection.archiveSession,
        archived,
        client,
        connectionId,
        db,
        queryClient,
        session,
        signal: controller.signal,
        title,
      });
      if (controller.signal.aborted) return;
      await queryClient.invalidateQueries({ queryKey: openCodeQueryKeys.connection(connectionId) });
      if (controller.signal.aborted) return;
      if (action === "delete") onDeleted();
      else onClose();
      if (cleanupIncomplete)
        Alert.alert(
          "Local cleanup incomplete",
          "The server deleted the session, but encrypted local state could not be removed. Removing this connection profile will clear it.",
        );
    } catch {
      if (!controller.signal.aborted) {
        setError("Could not confirm the change. Refresh the session before trying again.");
        void queryClient.invalidateQueries({
          queryKey: openCodeQueryKeys.connection(connectionId),
        });
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        controllerRef.current = null;
      }
    }
  }

  return { busy, controllerRef, error, perform, setError };
}

type SessionActionContext = {
  archiveSession: ReturnType<typeof useWorkspaceSelection>["archiveSession"];
  archived: boolean;
  client: OpenCodeClient;
  connectionId: string;
  db: SQLiteDatabase;
  queryClient: QueryClient;
  session: SessionInfo;
  signal: AbortSignal;
  title: string;
};

// Resolves whether local cleanup was incomplete after a deletion.
async function applySessionAction(action: SessionAction, context: SessionActionContext) {
  const { client, session, signal } = context;
  if (action === "delete") return deleteSessionTree(context);
  // Archive state is shared with every client, including OpenCode desktop.
  if (action === "archive") {
    await context.archiveSession(session, !context.archived);
    return false;
  }
  await renameOpenCodeSession(client, session.id, context.title.trim(), { signal });
  return false;
}

async function deleteSessionTree(context: SessionActionContext) {
  const { client, connectionId, db, queryClient, session, signal } = context;
  const ids = await loadOpenCodeSessionTreeIds(client, session.location, session.id, signal);
  if (signal.aborted) return false;
  await removeOpenCodeSession(client, session.id, { signal });
  let cleanupIncomplete = false;
  await deleteSessionLocalState(db, connectionId, ids).catch(() => {
    cleanupIncomplete = true;
  });
  for (const id of ids) {
    queryClient.removeQueries({
      queryKey: openCodeQueryKeys.session(connectionId, session.location, id),
    });
    queryClient.removeQueries({
      queryKey: openCodeQueryKeys.messageRoot(connectionId, session.location, id),
    });
    queryClient.removeQueries({
      queryKey: openCodeQueryKeys.inbox(connectionId, session.location, id),
    });
    queryClient.removeQueries({
      queryKey: openCodeQueryKeys.promptAdmissions(connectionId, session.location, id),
    });
  }
  return cleanupIncomplete;
}

function SessionMenuPage({
  archived,
  busy,
  connected,
  onArchive,
  onPage,
  sameConnection,
}: {
  archived: boolean;
  busy: boolean;
  connected: boolean;
  onArchive: () => void;
  onPage: (page: SessionSheetPage) => void;
  sameConnection: boolean;
}) {
  return (
    <>
      <MenuGroup>
        <MenuRow
          icon="edit-2"
          label="Rename"
          disabled={busy || !connected}
          onPress={() => onPage("rename")}
        />
        <MenuRow
          icon="archive"
          last
          disclosure={false}
          label={sessionArchiveLabel(archived)}
          description="Applies on every device"
          disabled={busy || !connected}
          onPress={onArchive}
        />
      </MenuGroup>
      <MenuGroup>
        <MenuRow
          icon="tool"
          last
          label="Dev tools"
          description="Branch and MCP servers for this location"
          disabled={busy || !sameConnection}
          onPress={() => onPage("devtools")}
        />
      </MenuGroup>
      <MenuGroup>
        <MenuRow
          icon="trash-2"
          last
          label="Delete"
          danger
          disabled={busy || !connected}
          onPress={() => onPage("delete")}
        />
      </MenuGroup>
    </>
  );
}

function SessionRenamePage({
  busy,
  canSave,
  onChangeTitle,
  onSave,
  title,
}: {
  busy: boolean;
  canSave: boolean;
  onChangeTitle: (title: string) => void;
  onSave: () => void;
  title: string;
}) {
  return (
    <>
      <TextInput
        accessibilityLabel="Session name"
        autoFocus
        value={title}
        onChangeText={onChangeTitle}
        editable={!busy}
        keyboardAppearance="dark"
        maxLength={512}
        onSubmitEditing={() => {
          if (canSave) onSave();
        }}
        returnKeyType="done"
        style={styles.input}
      />
      <Button
        busy={busy}
        disabled={!canSave}
        fullWidth
        label={busy ? "Saving" : "Save name"}
        onPress={onSave}
        variant="primary"
      />
    </>
  );
}

function SessionDeletePage({
  busy,
  connected,
  directory,
  onConfirm,
}: {
  busy: boolean;
  connected: boolean;
  directory: string;
  onConfirm: () => void;
}) {
  return (
    <>
      <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.copy}>
        This deletes the remote session and its child sessions. It cannot be undone.
      </Text>
      {/* Name the target location before the destructive action. */}
      <Text dynamicTypeRamp={typeRamp.footnote} selectable style={styles.deletePath}>
        {sanitizeTranscriptText(directory, 1_024)}
      </Text>
      <Button
        busy={busy}
        disabled={!connected}
        fullWidth
        label={busy ? "Deleting" : "Delete session"}
        onPress={onConfirm}
        variant="danger"
      />
    </>
  );
}

const styles = StyleSheet.create({
  input: {
    ...typography.body,
    minHeight: minTouchTarget,
    color: palette.ink,
    backgroundColor: palette.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
  },
  copy: { ...typography.subheadline, color: palette.ink },
  deletePath: {
    ...typography.footnote,
    color: palette.dim,
    fontFamily: typography.code.fontFamily,
  },
  error: { ...typography.subheadline, color: palette.danger },
});
