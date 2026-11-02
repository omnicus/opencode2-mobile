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
// last run finished, or that were created with no finished run, at or after `recentSince`;
// "all" lists every finished root (search).
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
  const unmatchedSessionIDs = new Set<string>();
  const resolveRoot = rootResolver(sessions, unmatchedSessionIDs);
  const activeByRoot = groupActiveByRoot(input.activeSessionIDs, resolveRoot);
  const attentionByRoot = groupAttentionByRoot(inboxInteractions(input), resolveRoot);

  const context: InboxRowContext = {
    activeByRoot,
    attentionByRoot,
    projects: new Map(input.projects.map((project) => [project.id, project])),
    sessions,
  };
  const sections: FollowedInboxSections = {
    archived: [],
    needsYou: [],
    recent: [],
    unmatchedSessionIDs: [...unmatchedSessionIDs].sort(),
    working: [],
  };
  for (const session of inboxRowSessions(input.rootSessions, context)) {
    const row = buildInboxRow(session, context);
    if (isOutsideRecentWindow(row, input.recentSince)) continue;
    sections[sectionKeys.get(row.section) ?? "recent"].push(row);
  }
  sortInboxSections(sections, input.recentSince);
  return sections;
}

type InboxInteraction = { id: string; sessionID: string; kind: "form" | "permission" };

type InboxRowContext = {
  activeByRoot: ReadonlyMap<string, ReadonlySet<string>>;
  attentionByRoot: ReadonlyMap<string, readonly InboxInteraction[]>;
  projects: ReadonlyMap<string, ProjectListOutput[number]>;
  sessions: ReadonlyMap<string, SessionInfo>;
};

const sectionKeys = new Map<
  FollowedInboxSection,
  keyof Omit<FollowedInboxSections, "unmatchedSessionIDs">
>([
  ["archived", "archived"],
  ["needs-you", "needsYou"],
  ["recent", "recent"],
  ["working", "working"],
]);

// Resolves a session to its root, recording the sessions whose family is not loaded.
function rootResolver(sessions: ReadonlyMap<string, SessionInfo>, unmatched: Set<string>) {
  const rootIDs = new Set(
    [...sessions.values()].filter((session) => !session.parentID).map((session) => session.id),
  );
  return (sessionID: string) => {
    const rootID = resolveRootSessionID(sessionID, sessions, rootIDs);
    if (!rootID) unmatched.add(sessionID);
    return rootID;
  };
}

function groupActiveByRoot(
  activeSessionIDs: readonly string[],
  resolveRoot: (sessionID: string) => string | undefined,
) {
  const activeByRoot = new Map<string, Set<string>>();
  for (const sessionID of new Set(activeSessionIDs)) {
    const rootID = resolveRoot(sessionID);
    if (!rootID) continue;
    const active = activeByRoot.get(rootID) ?? new Set<string>();
    active.add(sessionID);
    activeByRoot.set(rootID, active);
  }
  return activeByRoot;
}

function inboxInteractions(input: {
  forms: readonly FormInfo[];
  permissions: readonly PermissionRequest[];
}): InboxInteraction[] {
  return [
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
  ];
}

function groupAttentionByRoot(
  interactions: readonly InboxInteraction[],
  resolveRoot: (sessionID: string) => string | undefined,
) {
  const attentionByRoot = new Map<string, InboxInteraction[]>();
  for (const interaction of interactions) {
    if (interaction.sessionID === "global") continue;
    const rootID = resolveRoot(interaction.sessionID);
    if (!rootID) continue;
    const interactions = attentionByRoot.get(rootID) ?? [];
    if (!interactions.some((current) => current.id === interaction.id))
      interactions.push(interaction);
    attentionByRoot.set(rootID, interactions);
  }
  return attentionByRoot;
}

// Listed roots plus active or blocked roots known only from ancestry, newest update first.
function inboxRowSessions(rootSessions: readonly SessionInfo[], context: InboxRowContext) {
  const rowSessions = new Map(rootSessions.map((session) => [session.id, session]));
  for (const rootID of new Set([
    ...context.activeByRoot.keys(),
    ...context.attentionByRoot.keys(),
  ])) {
    const session = context.sessions.get(rootID);
    if (session && !rowSessions.has(rootID)) rowSessions.set(rootID, session);
  }
  return [...rowSessions.values()].sort(compareSessions);
}

function buildInboxRow(session: SessionInfo, context: InboxRowContext): FollowedInboxRow {
  const attention = context.attentionByRoot.get(session.id) ?? [];
  const active = (context.activeByRoot.get(session.id)?.size ?? 0) > 0;
  const ownerSessionID = attention[0]?.sessionID;
  const archived = session.time.archived !== undefined;
  const targetSession = ownerSessionID
    ? (context.sessions.get(ownerSessionID) ?? session)
    : session;
  const project = context.projects.get(session.projectID);
  const worktreeLabel = labelWorktree(project, session.location.directory);
  return {
    active,
    archived,
    attentionCount: attention.length,
    ...(ownerSessionID ? { attentionOwnerSessionID: ownerSessionID } : {}),
    ...(project?.icon ? { projectIcon: project.icon } : {}),
    projectLabel: labelProject(project, session.projectID),
    section: inboxSection(attention, active, archived),
    session,
    status: inboxStatus(session, attention, active),
    targetLocation: targetSession.location,
    targetSessionID: targetSession.id,
    ...(worktreeLabel ? { worktreeLabel } : {}),
  };
}

function inboxStatus(
  session: SessionInfo,
  attention: readonly InboxInteraction[],
  active: boolean,
): FollowedInboxStatus {
  if (attention.some((request) => request.kind === "permission")) return "approval";
  if (attention.length > 0) return "input";
  if (active) return "working";
  if (!isSessionUnread(session)) return "ready";
  return session.outcome === "failed" ? "failed" : "done";
}

function inboxSection(
  attention: readonly InboxInteraction[],
  active: boolean,
  archived: boolean,
): FollowedInboxSection {
  if (attention.length > 0) return "needs-you";
  if (active) return "working";
  return archived ? "archived" : "recent";
}

function isOutsideRecentWindow(row: FollowedInboxRow, recentSince: number | "all" | undefined) {
  if (row.section !== "recent" && row.section !== "archived") return false;
  if (recentSince === "all") return false;
  return recentSince === undefined || finishedOrCreated(row.session) < recentSince;
}

// When a session last finished a run, or when it was created if no run has finished yet. A new
// session lists from its creation, before its first prompt, as on OpenCode desktop.
function finishedOrCreated(session: SessionInfo) {
  return session.time.idle ?? session.time.created;
}

// Search keeps finished rows in update order.
function sortInboxSections(
  sections: FollowedInboxSections,
  recentSince: number | "all" | undefined,
) {
  sections.working.sort(compareWorking);
  if (recentSince === "all") return;
  sections.recent.sort(compareFinished);
  sections.archived.sort(compareFinished);
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

// The most recently finished or created session first.
function compareFinished(first: FollowedInboxRow, second: FollowedInboxRow) {
  return (
    finishedOrCreated(second.session) - finishedOrCreated(first.session) ||
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
