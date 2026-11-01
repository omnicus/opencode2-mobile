import { parseNotificationPushData } from "@opencode2-mobile/notification-protocol";
import {
  getOpenCodeSession,
  type LocationRef,
  listOpenCodeFormRequests,
  listOpenCodePermissionRequests,
  type OpenCodeClient,
} from "@opencode2-mobile/opencode-adapter";
import type { QueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import type { SQLiteDatabase } from "expo-sqlite";

import type { useConnections } from "../connections/connections-context";
import { rootNavigationRef } from "../navigation/navigation-ref";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { decryptNotificationRoute, sendNotificationDeviceCommand } from "./notification-client";
import {
  getNotificationPairingByBindingID,
  listNotificationPairings,
  type NotificationPairing,
  readNotificationPairingSecret,
} from "./notification-pairing-repository";
import { getExistingOpenCodePushRegistration } from "./notification-registration";
import {
  markNotificationEventHandled,
  wasNotificationEventHandled,
} from "./notification-replay-repository";
import {
  isNotificationRequestPending,
  isRoutableNotification,
  notificationReplayKey,
  type PendingInteractionRoute,
  type PendingRoute,
  type PendingSessionDoneRoute,
  pendingNotificationRoute,
} from "./notification-routing-model";

export type NotificationResponseContext = {
  connections: ReturnType<typeof useConnections>;
  db: SQLiteDatabase;
  handledResponses: Set<string>;
  isActive: () => boolean;
  processingEvents: Set<string>;
  setPending: (route: PendingRoute | undefined) => void;
};

export type PendingRouteContext = {
  db: SQLiteDatabase;
  includeAttentionLocation: (location: LocationRef) => void;
  isActive: () => boolean;
  processingEvents: Set<string>;
  queryClient: QueryClient;
  restClient: OpenCodeClient;
  setPending: (route: PendingRoute | undefined) => void;
};

type OpenCodeSession = Awaited<ReturnType<typeof getOpenCodeSession>>;

export async function refreshNotificationPushTokens(db: SQLiteDatabase, isActive: () => boolean) {
  const registration = await getExistingOpenCodePushRegistration();
  if (!registration || !isActive()) return;
  const pairings = await listNotificationPairings(db);
  await Promise.all(
    pairings.map((pairing) => sendNotificationPushToken(pairing, registration.expoPushToken)),
  );
}

async function sendNotificationPushToken(pairing: NotificationPairing, expoPushToken: string) {
  const secret = await readNotificationPairingSecret(pairing);
  await sendNotificationDeviceCommand({
    bindingID: pairing.bindingID,
    brokerOrigin: pairing.brokerOrigin,
    deviceKey: secret.deviceKey,
    expoPushToken,
    operation: "token",
  });
}

export function acceptLastNotificationResponse(
  response: Notifications.NotificationResponse | null,
  context: NotificationResponseContext,
) {
  if (!response || !context.isActive()) return;
  acceptAndClearNotificationResponse(response, context);
}

export function acceptAndClearNotificationResponse(
  response: Notifications.NotificationResponse,
  context: NotificationResponseContext,
) {
  void acceptNotificationResponse(response, context).finally(() => {
    void Notifications.clearLastNotificationResponseAsync();
  });
}

async function acceptNotificationResponse(
  response: Notifications.NotificationResponse,
  context: NotificationResponseContext,
) {
  const responseID = response.notification.request.identifier;
  if (context.handledResponses.has(responseID)) return;
  context.handledResponses.add(responseID);
  try {
    await routeNotificationResponse(response, context);
  } catch {
    // Invalid, stale, or locally revoked notification data is ignored.
  }
}

async function routeNotificationResponse(
  response: Notifications.NotificationResponse,
  context: NotificationResponseContext,
) {
  const data = response.notification.request.content.data;
  const push = parseNotificationPushData(data);
  const pairing = await getNotificationPairingByBindingID(context.db, push.bindingID);
  if (!pairing) return;
  const secret = await readNotificationPairingSecret(pairing);
  const route = decryptNotificationRoute(data, secret.deviceKey);
  if (!context.isActive() || !isRoutableNotification(route, Date.now())) return;
  const replayKey = notificationReplayKey(pairing.bindingID, route.eventID);
  if (
    context.processingEvents.has(replayKey) ||
    (await wasNotificationEventHandled(context.db, pairing.bindingID, route.eventID))
  ) {
    return;
  }
  context.processingEvents.add(replayKey);
  context.setPending(pendingNotificationRoute(pairing, route));
  if (context.connections.selectedProfileId !== pairing.connectionId) {
    await context.connections.select(pairing.connectionId);
  }
}

export async function openPendingNotificationRoute(
  route: PendingRoute,
  context: PendingRouteContext,
) {
  const replayKey = notificationReplayKey(route.bindingID, route.eventID);
  try {
    if (!(await openNotificationRoute(route, context))) return;
    await markNotificationEventHandled(context.db, route.bindingID, route.eventID);
    context.processingEvents.delete(replayKey);
    if (context.isActive()) context.setPending(undefined);
  } catch {
    context.processingEvents.delete(replayKey);
    if (context.isActive()) context.setPending(undefined);
  }
}

function openNotificationRoute(route: PendingRoute, context: PendingRouteContext) {
  if (route.kind === "session-done") return openSessionDoneRoute(route, context);
  if (route.sessionID === "global") return openGlobalInteractionRoute(route, context);
  return openSessionInteractionRoute(route, context);
}

async function openSessionDoneRoute(route: PendingSessionDoneRoute, context: PendingRouteContext) {
  const session = await getOpenCodeSession(context.restClient, route.sessionID);
  if (!context.isActive()) return false;
  cacheNotificationSession(context.queryClient, route.connectionId, session);
  await navigateToNotificationSession(route.connectionId, session, context.isActive);
  return true;
}

async function openGlobalInteractionRoute(
  route: PendingInteractionRoute,
  context: PendingRouteContext,
) {
  if (!route.location) throw new Error("NOTIFICATION_LOCATION_REQUIRED");
  const forms = await listOpenCodeFormRequests(context.restClient, route.location);
  context.queryClient.setQueryData(
    openCodeQueryKeys.forms(route.connectionId, route.location),
    forms,
  );
  if (!forms.data.some((form) => form.id === route.requestID)) return true;
  context.includeAttentionLocation(route.location);
  await waitForNavigation();
  if (context.isActive()) rootNavigationRef.navigate("Pending");
  return true;
}

async function openSessionInteractionRoute(
  route: PendingInteractionRoute,
  context: PendingRouteContext,
) {
  const session = await getOpenCodeSession(context.restClient, route.sessionID);
  if (!context.isActive()) return false;
  cacheNotificationSession(context.queryClient, route.connectionId, session);
  const [permissions, forms] = await Promise.all([
    listOpenCodePermissionRequests(context.restClient, session.location),
    listOpenCodeFormRequests(context.restClient, session.location),
  ]);
  context.queryClient.setQueryData(
    openCodeQueryKeys.permissions(route.connectionId, session.location),
    permissions,
  );
  context.queryClient.setQueryData(
    openCodeQueryKeys.forms(route.connectionId, session.location),
    forms,
  );
  if (!isNotificationRequestPending(route, permissions.data, forms.data)) return true;
  await navigateToNotificationSession(route.connectionId, session, context.isActive);
  return true;
}

function cacheNotificationSession(
  queryClient: QueryClient,
  connectionId: string,
  session: OpenCodeSession,
) {
  queryClient.setQueryData(
    openCodeQueryKeys.session(connectionId, session.location, session.id),
    session,
  );
}

async function navigateToNotificationSession(
  connectionId: string,
  session: OpenCodeSession,
  isActive: () => boolean,
) {
  await waitForNavigation();
  if (isActive()) {
    rootNavigationRef.navigate("Session", {
      connectionId,
      location: session.location,
      sessionID: session.id,
    });
  }
}

async function waitForNavigation() {
  const deadline = Date.now() + 5_000;
  while (!rootNavigationRef.isReady()) {
    if (Date.now() >= deadline) throw new Error("NAVIGATION_NOT_READY");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
