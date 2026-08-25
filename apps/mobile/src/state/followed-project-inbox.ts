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

export type FollowedInboxSection = "needs-you" | "recent" | "working";

export type FollowedInboxChild = {
  active: boolean;
  attentionCount: number;
  session: SessionInfo;
};

export type FollowedInboxRow = {
  active: boolean;
  activeChildCount: number;
  attentionCount: number;
  attentionOwnerSessionID?: string;
  children: FollowedInboxChild[];
  projectLabel: string;
  section: FollowedInboxSection;
  session: SessionInfo;
  targetLocation: LocationRef;
  targetSessionID: string;
};

export type FollowedInboxSections = {
  needsYou: FollowedInboxRow[];
  recent: FollowedInboxRow[];
  unmatchedSessionIDs: string[];
  working: FollowedInboxRow[];
};

export async function fetchFollowedSessionPage(
  client: OpenCodeClient,
  projectIDs: readonly string[],
  pageParam: FollowedSessionPageParam,
  options: { limit: number; search?: string; signal?: AbortSignal },
) {
  const requestedProjectIDs = projectIDs.filter((projectID) => pageParam[projectID] !== null);
  const settled = await Promise.allSettled(
    requestedProjectIDs.map((projectID) =>
      listOpenCodeProjectSessions(
        client,
        projectID,
        {
          ...(pageParam[projectID] ? { cursor: pageParam[projectID] } : {}),
          limit: options.limit,
          order: "desc",
          parentID: null,
          ...(options.search ? { search: options.search } : {}),
        },
        options.signal ? { signal: options.signal } : undefined,
      ),
    ),
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

export function buildFollowedInboxSections(input: {
  activeSessionIDs: readonly string[];
  ancestrySessions: Record<string, SessionInfo>;
  forms: readonly FormInfo[];
  permissions: readonly PermissionRequest[];
  projects: ProjectListOutput;
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
  const attentionByRoot = new Map<string, Array<{ id: string; sessionID: string }>>();
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
    })),
    ...input.forms.map((form) => ({ id: `form:${form.id}`, sessionID: form.sessionID })),
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
    const childSessionIDs = new Set([
      ...[...active].filter((sessionID) => sessionID !== session.id),
      ...attention
        .map((interaction) => interaction.sessionID)
        .filter((sessionID) => sessionID !== session.id),
    ]);
    const children = [...childSessionIDs]
      .flatMap((sessionID) => {
        const child = sessions.get(sessionID);
        return child
          ? [
              {
                active: active.has(sessionID),
                attentionCount: attention.filter(
                  (interaction) => interaction.sessionID === sessionID,
                ).length,
                session: child,
              },
            ]
          : [];
      })
      .sort((first, second) => compareSessions(first.session, second.session));
    const section: FollowedInboxSection =
      attention.length > 0 ? "needs-you" : active.size > 0 ? "working" : "recent";
    const targetSession = ownerSessionID ? (sessions.get(ownerSessionID) ?? session) : session;
    const row: FollowedInboxRow = {
      active: active.size > 0,
      activeChildCount: [...active].filter((sessionID) => sessionID !== session.id).length,
      attentionCount: attention.length,
      ...(ownerSessionID ? { attentionOwnerSessionID: ownerSessionID } : {}),
      children,
      projectLabel: labelProject(projects.get(session.projectID), session.projectID),
      section,
      session,
      targetLocation: targetSession.location,
      targetSessionID: targetSession.id,
    };
    if (section === "needs-you") sections.needsYou.push(row);
    else if (section === "working") sections.working.push(row);
    else sections.recent.push(row);
  }
  return sections;
}

export function stabilizeFollowedInboxSections(
  next: FollowedInboxSections,
  previous: FollowedInboxSections | undefined,
) {
  if (!previous) return next;
  return {
    needsYou: preserveSectionOrder(next.needsYou, previous.needsYou),
    recent: preserveSectionOrder(next.recent, previous.recent),
    unmatchedSessionIDs: next.unmatchedSessionIDs,
    working: preserveSectionOrder(next.working, previous.working),
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

function labelProject(project: ProjectListOutput[number] | undefined, fallback: string) {
  if (!project) return fallback;
  return (
    project.name?.trim() || project.canonical.split(/[\\/]/).filter(Boolean).at(-1) || project.id
  );
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
  return [...stable, ...next.filter((row) => nextByID.has(row.session.id))];
}
