import type { NotificationRoutingEnvelope } from "@opencode2-mobile/notification-protocol";

import type { NotificationPairing } from "./notification-pairing-repository";

export type PendingRoute =
  | {
      bindingID: string;
      connectionId: string;
      eventID: string;
      expiresAtMs: number;
      interaction: "form" | "permission";
      kind: "interaction";
      location?: { directory: string; workspaceID?: string };
      requestID: string;
      sessionID: string;
    }
  | {
      bindingID: string;
      connectionId: string;
      eventID: string;
      expiresAtMs: number;
      kind: "session-done";
      sessionID: string;
    };

export type PendingInteractionRoute = Extract<PendingRoute, { kind: "interaction" }>;

export type PendingSessionDoneRoute = Extract<PendingRoute, { kind: "session-done" }>;

type RoutableNotification = Exclude<NotificationRoutingEnvelope, { kind: "test" }>;

export function notificationReplayKey(bindingID: string, eventID: string) {
  return `${bindingID}\u0000${eventID}`;
}

export function isRoutableNotification(
  route: NotificationRoutingEnvelope,
  nowMs: number,
): route is RoutableNotification {
  return route.expiresAtMs >= nowMs && route.kind !== "test";
}

export function pendingNotificationRoute(
  pairing: NotificationPairing,
  route: RoutableNotification,
): PendingRoute {
  if (route.kind === "session-done") {
    return {
      bindingID: pairing.bindingID,
      connectionId: pairing.connectionId,
      eventID: route.eventID,
      expiresAtMs: route.expiresAtMs,
      kind: "session-done",
      sessionID: route.sessionID,
    };
  }
  return {
    bindingID: pairing.bindingID,
    connectionId: pairing.connectionId,
    eventID: route.eventID,
    expiresAtMs: route.expiresAtMs,
    interaction: route.interaction,
    kind: "interaction",
    ...(route.location ? { location: route.location } : {}),
    requestID: route.requestID,
    sessionID: route.sessionID,
  };
}

export function isPendingRouteOpenable(
  route: PendingRoute,
  connectionId: string | undefined,
  nowMs: number,
) {
  return route.expiresAtMs >= nowMs && connectionId === route.connectionId;
}

export function isNotificationRequestPending(
  route: PendingInteractionRoute,
  permissions: ReadonlyArray<{ id: string }>,
  forms: ReadonlyArray<{ id: string }>,
) {
  return route.interaction === "permission"
    ? permissions.some((permission) => permission.id === route.requestID)
    : forms.some((form) => form.id === route.requestID);
}
