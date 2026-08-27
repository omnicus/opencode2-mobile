import type { LocationRef } from "@opencode2-mobile/opencode-adapter";

export type SessionListKeyParameters = {
  limit?: number;
  order?: "asc" | "desc";
  parentID?: string | null;
  search?: string;
};

export type MessageListKeyParameters = {
  limit?: number;
  order?: "asc" | "desc";
};

export const openCodeQueryKeys = {
  activeSessions(connectionId: string) {
    return [...connectionKey(connectionId), "sessions-active"] as const;
  },
  agents(connectionId: string, location: LocationRef) {
    return [...locationKey(connectionId, location), "agents"] as const;
  },
  connection(connectionId: string) {
    return connectionKey(connectionId);
  },
  defaultLocation(connectionId: string) {
    return [...connectionKey(connectionId), "location-default"] as const;
  },
  forms(connectionId: string, location: LocationRef) {
    return [...locationKey(connectionId, location), "forms"] as const;
  },
  followedProjectSessions(
    connectionId: string,
    projectIds: readonly string[],
    parameters: SessionListKeyParameters,
    reconciliationRevision: number,
  ) {
    return [
      ...connectionKey(connectionId),
      "followed-project-sessions",
      [...projectIds],
      parameters.limit ?? null,
      parameters.order ?? null,
      parameters.search ?? null,
      parameters.parentID === undefined
        ? "parent:any"
        : parameters.parentID === null
          ? "parent:root"
          : parameters.parentID,
      reconciliationRevision,
    ] as const;
  },
  health(connectionId: string) {
    return [...connectionKey(connectionId), "health"] as const;
  },
  inbox(connectionId: string, location: LocationRef, sessionId: string) {
    return [...locationKey(connectionId, location), "inbox", sessionId] as const;
  },
  location(connectionId: string, location: LocationRef) {
    return locationKey(connectionId, location);
  },
  messages(
    connectionId: string,
    location: LocationRef,
    sessionId: string,
    parameters: MessageListKeyParameters,
  ) {
    return [
      ...messageRootKey(connectionId, location),
      sessionId,
      parameters.limit ?? null,
      parameters.order ?? null,
    ] as const;
  },
  messageRoot(connectionId: string, location: LocationRef, sessionId?: string) {
    return [
      ...messageRootKey(connectionId, location),
      ...(sessionId === undefined ? [] : [sessionId]),
    ] as const;
  },
  models(connectionId: string, location: LocationRef) {
    return [...locationKey(connectionId, location), "models"] as const;
  },
  permissions(connectionId: string, location: LocationRef) {
    return [...locationKey(connectionId, location), "permissions"] as const;
  },
  promptAdmissions(connectionId: string, location: LocationRef, sessionId: string) {
    return [...locationKey(connectionId, location), "prompt-admissions", sessionId] as const;
  },
  projects(connectionId: string) {
    return [...connectionKey(connectionId), "projects"] as const;
  },
  projectSessions(connectionId: string, projectId: string, parameters: SessionListKeyParameters) {
    return [
      ...connectionKey(connectionId),
      "project",
      projectId,
      "sessions",
      parameters.limit ?? null,
      parameters.order ?? null,
      parameters.search ?? null,
      parameters.parentID === undefined
        ? "parent:any"
        : parameters.parentID === null
          ? "parent:root"
          : parameters.parentID,
    ] as const;
  },
  resolvedLocation(connectionId: string, location: LocationRef) {
    return [...locationKey(connectionId, location), "resolved"] as const;
  },
  sessionAncestries(
    connectionId: string,
    purpose: "active" | "interactions",
    sessionIds: readonly string[],
    reconciliationRevision: number,
  ) {
    return [
      ...connectionKey(connectionId),
      "session-ancestries",
      purpose,
      [...sessionIds],
      reconciliationRevision,
    ] as const;
  },
  eventLocations(
    connectionId: string,
    locations: readonly LocationRef[],
    reconciliationRevision: number,
  ) {
    return [
      ...connectionKey(connectionId),
      "event-locations",
      locations.map((location) => [location.directory, location.workspaceID ?? null]),
      reconciliationRevision,
    ] as const;
  },
  session(connectionId: string, location: LocationRef, sessionId: string) {
    return [...sessionRootKey(connectionId, location), "detail", sessionId] as const;
  },
  sessionRoot(connectionId: string, location: LocationRef) {
    return sessionRootKey(connectionId, location);
  },
  vcs(connectionId: string, location: LocationRef) {
    return [...locationKey(connectionId, location), "vcs"] as const;
  },
  vcsDiff(connectionId: string, location: LocationRef, mode: "branch" | "working") {
    return [...locationKey(connectionId, location), "vcs-diff", mode] as const;
  },
  sessions(connectionId: string, location: LocationRef, parameters: SessionListKeyParameters) {
    return [
      ...sessionRootKey(connectionId, location),
      parameters.limit ?? null,
      parameters.order ?? null,
      parameters.search ?? null,
      parameters.parentID === undefined
        ? "parent:any"
        : parameters.parentID === null
          ? "parent:root"
          : parameters.parentID,
    ] as const;
  },
};

function connectionKey(connectionId: string) {
  return ["opencode", connectionId] as const;
}

function locationKey(connectionId: string, location: LocationRef) {
  return [
    ...connectionKey(connectionId),
    "location",
    location.directory,
    location.workspaceID ?? null,
  ] as const;
}

function sessionRootKey(connectionId: string, location: LocationRef) {
  return [...locationKey(connectionId, location), "sessions"] as const;
}

function messageRootKey(connectionId: string, location: LocationRef) {
  return [...locationKey(connectionId, location), "messages"] as const;
}
