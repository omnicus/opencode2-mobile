import { readFile } from "node:fs/promises";

import {
  type NotificationDeliveryState,
  parseNotificationDeliveryState,
} from "@opencode2-mobile/notification-protocol";

export type BrokerAccess = { brokerOrigin: string; ingestToken: string };

export async function readBrokerAccess(options: Readonly<Record<string, unknown>>) {
  const brokerOrigin = options.brokerOrigin;
  const tokenFile = options.tokenFile;
  if (typeof brokerOrigin !== "string" || typeof tokenFile !== "string") {
    throw new Error("NOTIFICATION_PLUGIN_OPTIONS_REQUIRED");
  }
  const url = new URL(brokerOrigin);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("INVALID_NOTIFICATION_BROKER_ORIGIN");
  }
  const ingestToken = (await readFile(tokenFile, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(ingestToken)) throw new Error("INVALID_INGEST_TOKEN");
  return { brokerOrigin: url.origin, ingestToken } satisfies BrokerAccess;
}

export async function requestNotificationDeliveryState(
  access: BrokerAccess,
  operation: "enable" | "pause" | "status",
): Promise<NotificationDeliveryState> {
  const response = await fetch(`${access.brokerOrigin}/v1/plugin/${operation}`, {
    headers: { Authorization: `Bearer ${access.ingestToken}` },
    method: operation === "status" ? "GET" : "POST",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("NOTIFICATION_BROKER_UNAVAILABLE");
  return parseNotificationDeliveryState(await response.json());
}
