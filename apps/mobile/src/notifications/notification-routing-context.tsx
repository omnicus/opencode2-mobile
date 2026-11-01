import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useSQLiteContext } from "expo-sqlite";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useConnections } from "../connections/connections-context";
import { useConnectionRuntime } from "../state/connection-runtime-context";
import {
  acceptAndClearNotificationResponse,
  acceptLastNotificationResponse,
  type NotificationResponseContext,
  openPendingNotificationRoute,
  refreshNotificationPushTokens,
} from "./notification-routing-actions";
import { isPendingRouteOpenable, type PendingRoute } from "./notification-routing-model";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

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
    void refreshNotificationPushTokens(db, () => active).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [db]);

  useEffect(() => {
    let active = true;
    const context: NotificationResponseContext = {
      connections,
      db,
      handledResponses: handledResponses.current,
      isActive: () => active,
      processingEvents: processingEvents.current,
      setPending,
    };
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      acceptAndClearNotificationResponse(response, context);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      acceptLastNotificationResponse(response, context);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [connections, db]);

  useEffect(() => {
    if (!pending || !isPendingRouteOpenable(pending, connectionId, Date.now()) || !restClient) {
      return;
    }
    let active = true;
    void openPendingNotificationRoute(pending, {
      db,
      includeAttentionLocation: runtime.includeAttentionLocation,
      isActive: () => active,
      processingEvents: processingEvents.current,
      queryClient,
      restClient,
      setPending,
    });
    return () => {
      active = false;
    };
  }, [connectionId, db, pending, queryClient, restClient, runtime.includeAttentionLocation]);

  return children;
}
