import { parseNotificationPushData } from "@opencode2-mobile/notification-protocol";
import {
  getOpenCodeSession,
  listOpenCodeFormRequests,
  listOpenCodePermissionRequests,
} from "@opencode2-mobile/opencode-adapter";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useSQLiteContext } from "expo-sqlite";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useConnections } from "../connections/connections-context";
import { rootNavigationRef } from "../navigation/navigation-ref";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import { openCodeQueryKeys } from "../state/open-code-query-keys";
import { decryptNotificationRoute, sendNotificationDeviceCommand } from "./notification-client";
import {
  getNotificationPairingByBindingID,
  listNotificationPairings,
  readNotificationPairingSecret,
} from "./notification-pairing-repository";
import { getExistingOpenCodePushRegistration } from "./notification-registration";
import {
  markNotificationEventHandled,
  wasNotificationEventHandled,
} from "./notification-replay-repository";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

type PendingRoute =
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

export function NotificationRoutingProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const connections = useConnections();
  const runtime = useConnectionRuntime();
  const queryClient = useQueryClient();
  const connectionId = runtime.connectionId;
  const restClient = runtime.restClient;
  const handledResponses = useRef(new Set<string>());
  const processingEvents = useRef(new Set<string>());
  const [pending, setPending] = useState<PendingRoute>();

  useEffect(() => {
    let active = true;
    void getExistingOpenCodePushRegistration()
      .then(async (registration) => {
        if (!registration || !active) return;
        const pairings = await listNotificationPairings(db);
        await Promise.all(
          pairings.map(async (pairing) => {
            const secret = await readNotificationPairingSecret(pairing);
            await sendNotificationDeviceCommand({
              bindingID: pairing.bindingID,
              brokerOrigin: pairing.brokerOrigin,
              deviceKey: secret.deviceKey,
              expoPushToken: registration.expoPushToken,
              operation: "token",
            });
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [db]);

  useEffect(() => {
    let active = true;
    async function accept(response: Notifications.NotificationResponse) {
      const responseID = response.notification.request.identifier;
      if (handledResponses.current.has(responseID)) return;
      handledResponses.current.add(responseID);
      try {
        const data = response.notification.request.content.data;
        const push = parseNotificationPushData(data);
        const pairing = await getNotificationPairingByBindingID(db, push.bindingID);
        if (!pairing) return;
        const secret = await readNotificationPairingSecret(pairing);
        const route = decryptNotificationRoute(data, secret.deviceKey);
        if (!active || route.expiresAtMs < Date.now() || route.kind === "test") return;
        const replayKey = `${pairing.bindingID}\u0000${route.eventID}`;
        if (
          processingEvents.current.has(replayKey) ||
          (await wasNotificationEventHandled(db, pairing.bindingID, route.eventID))
        ) {
          return;
        }
        processingEvents.current.add(replayKey);
        setPending(
          route.kind === "session-done"
            ? {
                bindingID: pairing.bindingID,
                connectionId: pairing.connectionId,
                eventID: route.eventID,
                expiresAtMs: route.expiresAtMs,
                kind: "session-done",
                sessionID: route.sessionID,
              }
            : {
                bindingID: pairing.bindingID,
                connectionId: pairing.connectionId,
                eventID: route.eventID,
                expiresAtMs: route.expiresAtMs,
                interaction: route.interaction,
                kind: "interaction",
                ...(route.location ? { location: route.location } : {}),
                requestID: route.requestID,
                sessionID: route.sessionID,
              },
        );
        if (connections.selectedProfileId !== pairing.connectionId) {
          await connections.select(pairing.connectionId);
        }
      } catch {
        // Invalid, stale, or locally revoked notification data is ignored.
      }
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void accept(response).finally(() => {
        void Notifications.clearLastNotificationResponseAsync();
      });
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response || !active) return;
      void accept(response).finally(() => {
        void Notifications.clearLastNotificationResponseAsync();
      });
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [connections, db]);

  useEffect(() => {
    if (
      !pending ||
      pending.expiresAtMs < Date.now() ||
      connectionId !== pending.connectionId ||
      !restClient
    ) {
      return;
    }
    let active = true;
    const route = pending;
    void (async () => {
      const finishRoute = async () => {
        await markNotificationEventHandled(db, route.bindingID, route.eventID);
        processingEvents.current.delete(`${route.bindingID}\u0000${route.eventID}`);
        if (active) setPending(undefined);
      };
      if (route.kind === "session-done") {
        const session = await getOpenCodeSession(restClient, route.sessionID);
        if (!active) return;
        queryClient.setQueryData(
          openCodeQueryKeys.session(route.connectionId, session.location, session.id),
          session,
        );
        await waitForNavigation();
        if (active) {
          rootNavigationRef.navigate("Session", {
            connectionId: route.connectionId,
            location: session.location,
            sessionID: session.id,
          });
        }
      } else if (route.sessionID === "global") {
        if (!route.location) throw new Error("NOTIFICATION_LOCATION_REQUIRED");
        const forms = await listOpenCodeFormRequests(restClient, route.location);
        queryClient.setQueryData(
          openCodeQueryKeys.forms(route.connectionId, route.location),
          forms,
        );
        if (!forms.data.some((form) => form.id === route.requestID)) {
          await finishRoute();
          return;
        }
        runtime.includeAttentionLocation(route.location);
        await waitForNavigation();
        if (active) rootNavigationRef.navigate("Pending");
      } else {
        const session = await getOpenCodeSession(restClient, route.sessionID);
        if (!active) return;
        queryClient.setQueryData(
          openCodeQueryKeys.session(route.connectionId, session.location, session.id),
          session,
        );
        const [permissions, forms] = await Promise.all([
          listOpenCodePermissionRequests(restClient, session.location),
          listOpenCodeFormRequests(restClient, session.location),
        ]);
        queryClient.setQueryData(
          openCodeQueryKeys.permissions(route.connectionId, session.location),
          permissions,
        );
        queryClient.setQueryData(
          openCodeQueryKeys.forms(route.connectionId, session.location),
          forms,
        );
        const requestIsPending =
          route.interaction === "permission"
            ? permissions.data.some((permission) => permission.id === route.requestID)
            : forms.data.some((form) => form.id === route.requestID);
        if (!requestIsPending) {
          await finishRoute();
          return;
        }
        await waitForNavigation();
        if (active) {
          rootNavigationRef.navigate("Session", {
            connectionId: route.connectionId,
            location: session.location,
            sessionID: session.id,
          });
        }
      }
      await finishRoute();
    })().catch(() => {
      processingEvents.current.delete(`${route.bindingID}\u0000${route.eventID}`);
      if (active) setPending(undefined);
    });
    return () => {
      active = false;
    };
  }, [connectionId, db, pending, queryClient, restClient, runtime.includeAttentionLocation]);

  return children;
}

async function waitForNavigation() {
  const deadline = Date.now() + 5_000;
  while (!rootNavigationRef.isReady()) {
    if (Date.now() >= deadline) throw new Error("NAVIGATION_NOT_READY");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
