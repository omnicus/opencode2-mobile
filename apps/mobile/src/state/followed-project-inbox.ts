import type {
  FormInfo,
  LocationRef,
  OpenCodeClient,
  PermissionRequest,
  ProjectListOutput,
  SessionInfo,
  SessionsResponse,
} from "@opencode2-mobile/opencode-adapter";
import {
  getOpenCodeSession,
  listOpenCodeProjectSessions,
} from "@opencode2-mobile/opencode-adapter";

export type FollowedSessionPage = {
  cursors: FollowedSessionPageParam;
  failures: string[];
  responses: Record<string, SessionsResponse>;
};

export type FollowedSessionPageParam = Record<string, string | null | undefined>;

export type SessionAncestryResult = {
  failures: string[];
  sessions: Record<string, SessionInfo>;
};

export type FollowedInboxSection = "archived" | "needs-you" | "recent" | "working";

// The state a person acts on, as in the OpenCode desktop inbox: a pending permission or
// question, a running session, an unread finished run, or a read one.
export type FollowedInboxStatus = "approval" | "done" | "failed" | "input" | "ready" | "working";

// Child sessions never get their own row. Their activity marks the root as working, and their
// requests make the root row open the owning child.
export type FollowedInboxRow = {
  active: boolean;
  archived: boolean;
  attentionCount: number;
  attentionOwnerSessionID?: string;
  projectIcon?: NonNullable<ProjectListOutput[number]["icon"]>;
  projectLabel: string;
  section: FollowedInboxSection;
  session: SessionInfo;
  status: FollowedInboxStatus;
  targetLocation: LocationRef;
  targetSessionID: string;
  worktreeLabel?: string;
};

export type FollowedInboxSections = {
  archived: FollowedInboxRow[];
  needsYou: FollowedInboxRow[];
  recent: FollowedInboxRow[];
  unmatchedSessionIDs: string[];
  working: FollowedInboxRow[];
};

// `time.idle` can land a few milliseconds after `time.updated`, so paging toward the inbox start
// stops a little past it.
const recentPagingMarginMs = 60_000;
const maxRecentPages = 4;

export async function fetchFollowedSessionPage(
  client: OpenCodeClient,
  projectIDs: readonly string[],
  pageParam: FollowedSessionPageParam,
  options: {
    archived?: boolean;
    limit: number;
    search?: string;
    signal?: AbortSignal;
    // Keep paging each project while its sessions may have finished after this time. Lists are
    // newest-updated first, and a session's last update is never before its last finished run.
    until?: number;
  },
) {
  const requestedProjectIDs = projectIDs.filter((projectID) => pageParam[projectID] !== null);
  const settled = await Promise.allSettled(
    requestedProjectIDs.map(async (projectID) => {
      let cursor = pageParam[projectID];
      let response: SessionsResponse | undefined;
      for (let page = 0; page < (options.until === undefined ? 1 : maxRecentPages); page += 1) {
        const next = await listOpenCodeProjectSessions(
          client,
          projectID,
          {
            ...(options.archived ? { archived: true } : {}),
            ...(cursor ? { cursor } : {}),
            limit: options.limit,
            order: "desc",
            parentID: null,
            ...(options.search ? { search: options.search } : {}),
          },
          options.signal ? { signal: options.signal } : undefined,
        );
        response = response
          ? { cursor: next.cursor, data: [...response.data, ...next.data] }
          : next;
        cursor = next.cursor.next ?? null;
        const oldest = next.data.at(-1)?.time.updated;
        if (
          !cursor ||
          options.until === undefined ||
          oldest === undefined ||
          oldest < options.until - recentPagingMarginMs
        ) {
          break;
        }
      }
      if (!response) throw new Error("SESSION_PAGE_MISSING");
      return response;
    }),
  );
  const page: FollowedSessionPage = { cursors: {}, failures: [], responses: {} };
  for (const [index, result] of settled.entries()) {
    const projectID = requestedProjectIDs[index];
    if (!projectID) continue;
    if (result.status === "fulfilled") {
      page.responses[projectID] = result.value;
      page.cursors[projectID] = result.value.cursor.next ?? null;
    } else {
      page.failures.push(projectID);
      page.cursors[projectID] = pageParam[projectID];
    }
  }
  return page;
}

export function nextFollowedSessionPageParam(page: FollowedSessionPage) {
  return Object.values(page.cursors).some((cursor) => cursor !== null) ? page.cursors : undefined;
}

export function flattenFollowedSessionPages(pages: readonly FollowedSessionPage[] | undefined) {
  const sessions = new Map<string, SessionInfo>();
  for (const page of pages ?? []) {
    for (const response of Object.values(page.responses)) {
      for (const session of response.data) {
        const current = sessions.get(session.id);
        if (!current || session.time.updated > current.time.updated)
          sessions.set(session.id, session);
      }
    }
  }
  return [...sessions.values()].sort(compareSessions);
}

// Sets a session's archive time in cached pages so its row changes section before the lists
// refetch. `undefined` unarchives it.
export function setFollowedSessionArchived(
  page: FollowedSessionPage,
  sessionID: string,
  archivedAt: number | undefined,
): FollowedSessionPage {
  let changed = false;
  const responses = Object.fromEntries(
    Object.entries(page.responses).map(([projectID, response]) => [
      projectID,
      {
        ...response,
        data: response.data.map((session) => {
          if (session.id !== sessionID) return session;
          changed = true;
          const { archived: _archived, ...time } = session.time;
          return {
            ...session,
            time: archivedAt === undefined ? time : { ...time, archived: archivedAt },
          };
        }),
      },
    ]),
  );
  return changed ? { ...page, responses } : page;
}

export function failedFollowedSessionProjects(pages: readonly FollowedSessionPage[] | undefined) {
  const failures = new Set<string>();
  for (const page of pages ?? []) {
    for (const projectID of page.failures) failures.add(projectID);
    for (const projectID of Object.keys(page.responses)) failures.delete(projectID);
  }
  return [...failures];
}

export async function loadSessionAncestries(
  client: OpenCodeClient,
  sessionIDs: readonly string[],
  signal?: AbortSignal,
) {
  const sessions = new Map<string, SessionInfo>();
  const pending = new Map<string, Promise<SessionInfo>>();

  async function load(sessionID: string, depth = 0): Promise<void> {
    if (sessions.has(sessionID)) return;
    if (depth > 32) throw new Error("SESSION_ANCESTRY_TOO_DEEP");
    let request = pending.get(sessionID);
    if (!request) {
      request = getOpenCodeSession(client, sessionID, signal ? { signal } : undefined);
      pending.set(sessionID, request);
    }
    const session = await request;
    sessions.set(session.id, session);
    if (session.parentID) await load(session.parentID, depth + 1);
  }

  const settled = await Promise.allSettled(
    [...new Set(sessionIDs)].map((sessionID) => load(sessionID)),
  );
  const failures = [...new Set(sessionIDs)].filter(
    (_sessionID, index) => settled[index]?.status === "rejected",
  );
  return { failures, sessions: Object.fromEntries(sessions) } satisfies SessionAncestryResult;
}

// Root sessions with the state a person acts on, in the OpenCode desktop inbox sections. Needs
// you and Working list every blocked or running root. Recent and Archived list only roots whose
// last run finished at or after `recentSince`; "all" lists every finished root (search).
// A root's own `time.archived` decides between Recent and Archived.
export function buildFollowedInboxSections(input: {
  activeSessionIDs: readonly string[];
  ancestrySessions: Record<string, SessionInfo>;
  forms: readonly FormInfo[];
  permissions: readonly PermissionRequest[];
  projects: ProjectListOutput;
  recentSince: number | "all" | undefined;
  rootSessions: readonly SessionInfo[];
}) {
  const sessions = new Map(
    Object.values(input.ancestrySessions).map((session) => [session.id, session]),
  );
  for (const session of input.rootSessions) sessions.set(session.id, session);
  const rootIDs = new Set(
    [...sessions.values()].filter((session) => !session.parentID).map((session) => session.id),
  );
  const activeByRoot = new Map<string, Set<string>>();
  const attentionByRoot = new Map<
    string,
    Array<{ id: string; sessionID: string; kind: "form" | "permission" }>
  >();
  const unmatchedSessionIDs = new Set<string>();

  for (const sessionID of new Set(input.activeSessionIDs)) {
    const rootID = resolveRootSessionID(sessionID, sessions, rootIDs);
    if (!rootID) {
      unmatchedSessionIDs.add(sessionID);
      continue;
    }
    const active = activeByRoot.get(rootID) ?? new Set<string>();
    active.add(sessionID);
    activeByRoot.set(rootID, active);
  }
  for (const interaction of [
    ...input.permissions.map((request) => ({
      id: `permission:${request.id}`,
      sessionID: request.sessionID,
      kind: "permission" as const,
    })),
    ...input.forms.map((form) => ({
      id: `form:${form.id}`,
      sessionID: form.sessionID,
      kind: "form" as const,
    })),
  ]) {
    if (interaction.sessionID === "global") continue;
    const rootID = resolveRootSessionID(interaction.sessionID, sessions, rootIDs);
    if (!rootID) {
      unmatchedSessionIDs.add(interaction.sessionID);
      continue;
    }
    const interactions = attentionByRoot.get(rootID) ?? [];
    if (!interactions.some((current) => current.id === interaction.id))
      interactions.push(interaction);
    attentionByRoot.set(rootID, interactions);
  }

  const projects = new Map(input.projects.map((project) => [project.id, project]));
  const sections: FollowedInboxSections = {
    archived: [],
    needsYou: [],
    recent: [],
    unmatchedSessionIDs: [...unmatchedSessionIDs].sort(),
    working: [],
  };
  const rowSessions = new Map(input.rootSessions.map((session) => [session.id, session]));
  for (const rootID of new Set([...activeByRoot.keys(), ...attentionByRoot.keys()])) {
    const session = sessions.get(rootID);
    if (session && !rowSessions.has(rootID)) rowSessions.set(rootID, session);
  }
  for (const session of [...rowSessions.values()].sort(compareSessions)) {
    const attention = attentionByRoot.get(session.id) ?? [];
    const active = activeByRoot.get(session.id) ?? new Set<string>();
    const ownerSessionID = attention[0]?.sessionID;
    const status: FollowedInboxStatus = attention.some((request) => request.kind === "permission")
      ? "approval"
      : attention.length > 0
        ? "input"
        : active.size > 0
          ? "working"
          : !isSessionUnread(session)
            ? "ready"
            : session.outcome === "failed"
              ? "failed"
              : "done";
    const archived = session.time.archived !== undefined;
    const section: FollowedInboxSection =
      attention.length > 0
        ? "needs-you"
        : active.size > 0
          ? "working"
          : archived
            ? "archived"
            : "recent";
    if (
      (section === "recent" || section === "archived") &&
      input.recentSince !== "all" &&
      (input.recentSince === undefined || (session.time.idle ?? -1) < input.recentSince)
    ) {
      continue;
    }
    const targetSession = ownerSessionID ? (sessions.get(ownerSessionID) ?? session) : session;
    const project = projects.get(session.projectID);
    const worktreeLabel = labelWorktree(project, session.location.directory);
    const row: FollowedInboxRow = {
      active: active.size > 0,
      archived,
      attentionCount: attention.length,
      ...(ownerSessionID ? { attentionOwnerSessionID: ownerSessionID } : {}),
      ...(project?.icon ? { projectIcon: project.icon } : {}),
      projectLabel: labelProject(project, session.projectID),
      section,
      session,
      status,
      targetLocation: targetSession.location,
      targetSessionID: targetSession.id,
      ...(worktreeLabel ? { worktreeLabel } : {}),
    };
    if (section === "needs-you") sections.needsYou.push(row);
    else if (section === "working") sections.working.push(row);
    else if (section === "archived") sections.archived.push(row);
    else sections.recent.push(row);
  }
  sections.working.sort(compareWorking);
  if (input.recentSince !== "all") {
    sections.recent.sort(compareFinished);
    sections.archived.sort(compareFinished);
  }
  return sections;
}

// A session is unread while its last finished run is newer than the last one any client viewed.
export function isSessionUnread(session: SessionInfo) {
  const { idle, viewed } = session.time;
  return idle !== undefined && (viewed === undefined || idle > viewed);
}

// When the current run started. Undefined while the session still holds an earlier run's start
// (that run ended at `time.idle`, after `time.busy`) or the server has not recorded one.
export function workingSince(session: SessionInfo) {
  const { busy, idle } = session.time;
  if (busy === undefined || (idle !== undefined && idle > busy)) return undefined;
  return busy;
}

// Earliest run start first, so a session that starts working joins the end and rows do not move
// while they stream. Runs with no known start go last.
function compareWorking(first: FollowedInboxRow, second: FollowedInboxRow) {
  const start =
    (workingSince(first.session) ?? Number.POSITIVE_INFINITY) -
    (workingSince(second.session) ?? Number.POSITIVE_INFINITY);
  return (Number.isNaN(start) ? 0 : start) || first.session.id.localeCompare(second.session.id);
}

// The most recently finished session first.
function compareFinished(first: FollowedInboxRow, second: FollowedInboxRow) {
  return (
    (second.session.time.idle ?? 0) - (first.session.time.idle ?? 0) ||
    first.session.id.localeCompare(second.session.id)
  );
}

// Needs you rows keep their order while their family streams. Working, Recent, and Archived
// already sort by values that only change when a run starts or ends.
export function stabilizeFollowedInboxSections(
  next: FollowedInboxSections,
  previous: FollowedInboxSections | undefined,
) {
  if (!previous) return next;
  return {
    ...next,
    needsYou: preserveSectionOrder(next.needsYou, previous.needsYou),
  } satisfies FollowedInboxSections;
}

export function uniqueLocations(locations: readonly LocationRef[]) {
  const unique = new Map<string, LocationRef>();
  for (const location of locations) {
    if (!location.directory.trim()) continue;
    unique.set(locationKey(location), location);
  }
  return [...unique.values()].sort((first, second) => {
    const firstKey = locationKey(first);
    const secondKey = locationKey(second);
    return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
  });
}

export function locationKey(location: LocationRef) {
  return `${location.directory}\u0000${location.workspaceID ?? ""}`;
}

function resolveRootSessionID(
  sessionID: string,
  sessions: ReadonlyMap<string, SessionInfo>,
  rootIDs: ReadonlySet<string>,
) {
  const seen = new Set<string>();
  let currentID: string | undefined = sessionID;
  while (currentID && !seen.has(currentID)) {
    if (rootIDs.has(currentID)) return currentID;
    seen.add(currentID);
    currentID = sessions.get(currentID)?.parentID;
  }
  return !currentID && sessions.has(sessionID) ? sessionID : undefined;
}

export function labelProject(project: ProjectListOutput[number] | undefined, fallback: string) {
  if (!project) return fallback;
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
}

function labelWorktree(project: ProjectListOutput[number] | undefined, directory: string) {
  if (!project || directory === project.canonical) return undefined;
  return directory.split(/[\\/]/).filter(Boolean).at(-1);
}

function compareSessions(first: SessionInfo, second: SessionInfo) {
  return second.time.updated - first.time.updated || first.id.localeCompare(second.id);
}

function preserveSectionOrder(next: FollowedInboxRow[], previous: FollowedInboxRow[]) {
  const nextByID = new Map(next.map((row) => [row.session.id, row]));
  const stable = previous.flatMap((row) => {
    const current = nextByID.get(row.session.id);
    if (!current) return [];
    nextByID.delete(row.session.id);
    return [current];
  });
  for (const row of next.filter((candidate) => nextByID.has(candidate.session.id))) {
    const index = stable.findIndex((current) => compareSessions(row.session, current.session) < 0);
    stable.splice(index < 0 ? stable.length : index, 0, row);
  }
  return stable;
}
