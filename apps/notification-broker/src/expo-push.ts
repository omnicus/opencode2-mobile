import type { SQLInputValue } from "node:sqlite";
import type { NotificationCategory } from "@opencode2-mobile/notification-protocol";

import type { BrokerDatabase } from "./database.js";

const expoSendUrl = "https://exp.host/--/api/v2/push/send";
const expoReceiptsUrl = "https://exp.host/--/api/v2/push/getReceipts";
export const notificationLifetimeMs = 15 * 60_000;

export class ExpoPushWorker {
  private running = false;
  private lastCleanupAtMs = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly database: BrokerDatabase,
    private readonly accessToken = process.env.EXPO_ACCESS_TOKEN,
    private readonly mode = process.env.OPENCODE_MOBILE_PUSH_MODE === "fake" ? "fake" : "expo",
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1_000);
    this.timer.unref();
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      if (now - this.lastCleanupAtMs >= 60 * 60_000) {
        this.database.prune(now);
        this.lastCleanupAtMs = now;
      }
      await this.sendQueued();
      await this.checkReceipts();
    } finally {
      this.running = false;
    }
  }

  private async sendQueued() {
    this.database.expireQueued();
    for (const row of this.database.nextQueued()) {
      const id = asString(row.id);
      const bindingID = asString(row.binding_id);
      if (!this.database.canSendQueued(id)) continue;
      if (this.mode === "fake") {
        this.database.markDelivered(id);
        continue;
      }
      try {
        await this.sendRow(id, bindingID, row);
      } catch {
        this.database.markRetry(id, "NETWORK_ERROR");
      }
    }
  }

  private async sendRow(id: string, bindingID: string, row: Record<string, SQLInputValue>) {
    const response = await fetch(expoSendUrl, {
      body: JSON.stringify({
        body: notificationBody(asNotificationCategory(row.notification_category)),
        channelId: "opencode-attention",
        collapseId: asString(row.collapse_id),
        data: JSON.parse(asString(row.push_data_json)),
        expiration: Math.floor((asNumber(row.created_at_ms) + notificationLifetimeMs) / 1000),
        priority: "high",
        sound: "default",
        tag: asString(row.collapse_id),
        title: "OpenCode",
        to: this.database.decryptExpoToken(row),
      }),
      headers: this.expoHeaders(),
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429 || response.status >= 500) {
      this.database.markRetry(id, response.status === 429 ? "RATE_LIMITED" : "EXPO_UNAVAILABLE");
      return;
    }
    if (!response.ok) {
      this.database.markFailed(id, "EXPO_REJECTED");
      return;
    }
    const ticket = parseTicket(await response.json());
    if (ticket.status === "ok") this.database.markTicketed(id, ticket.id);
    else this.applyExpoError(id, bindingID, ticket.error, "EXPO_TICKET_ERROR");
  }

  private async checkReceipts() {
    const rows = this.database.nextReceipts();
    if (rows.length === 0 || this.mode === "fake") return;
    const ids = rows.map((row) => asString(row.ticket_id));
    try {
      const response = await fetch(expoReceiptsUrl, {
        body: JSON.stringify({ ids }),
        headers: this.expoHeaders(),
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        this.deferReceipts(rows);
        return;
      }
      const receipts = parseReceipts(await response.json());
      for (const row of rows) this.applyReceipt(row, receipts[asString(row.ticket_id)]);
    } catch {
      this.deferReceipts(rows);
    }
  }

  private applyReceipt(row: Record<string, SQLInputValue>, receipt: ExpoResult | undefined) {
    const id = asString(row.id);
    if (!receipt) {
      const createdAtMs = asNumber(row.created_at_ms);
      if (Date.now() - createdAtMs >= 24 * 60 * 60_000) {
        this.database.markFailed(id, "RECEIPT_EXPIRED");
      } else {
        this.database.deferReceipt(id, 15 * 60_000);
      }
      return;
    }
    if (receipt.status === "ok") this.database.markDelivered(id);
    else this.applyExpoError(id, asString(row.binding_id), receipt.error, "EXPO_RECEIPT_ERROR");
  }

  private applyExpoError(
    id: string,
    bindingID: string,
    error: string | undefined,
    fallbackCode: string,
  ) {
    if (error === "DeviceNotRegistered") {
      this.database.disableDevice(bindingID, "provider-unregistered");
      this.database.markFailed(id, "DEVICE_NOT_REGISTERED");
    } else if (error === "MessageRateExceeded") {
      this.database.markRetry(id, "MESSAGE_RATE_EXCEEDED");
    } else this.database.markFailed(id, fallbackCode);
  }

  private deferReceipts(rows: Array<Record<string, SQLInputValue>>) {
    for (const row of rows) this.database.deferReceipt(asString(row.id), 5 * 60_000);
  }

  private expoHeaders() {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
    };
  }
}

export function notificationBody(category: NotificationCategory) {
  switch (category) {
    case "form":
    case "permission-question":
      return "OpenCode has a question for you";
    case "permission-edit":
      return "Permission to edit files";
    case "permission-execute":
      return "Permission to use Code Mode";
    case "permission-external-directory":
      return "Permission to access external files";
    case "permission-glob":
      return "Permission to search file paths";
    case "permission-grep":
      return "Permission to search file contents";
    case "permission-read":
      return "Permission to read a file";
    case "permission-shell":
      return "Permission to run a command";
    case "permission-skill":
      return "Permission to load a skill";
    case "permission-subagent":
      return "Permission to start a subagent";
    case "permission-webfetch":
      return "Permission to fetch a URL";
    case "permission-websearch":
      return "Permission to search the web";
    case "session-done":
      return "Session done";
    case "permission-other":
      return "Permission requested";
    case "test":
      return "OpenCode needs your attention.";
  }
}

type ExpoResult = { error?: string; id?: string; status: "error" | "ok" };

function parseTicket(
  value: unknown,
): { error?: string; id: string; status: "ok" } | { error?: string; status: "error" } {
  if (!isRecord(value)) throw new Error("INVALID_EXPO_RESPONSE");
  const data = Array.isArray(value.data) ? value.data[0] : value.data;
  const result = parseExpoResult(data);
  if (result.status === "ok") {
    if (!result.id) throw new Error("INVALID_EXPO_RESPONSE");
    return { ...(result.error ? { error: result.error } : {}), id: result.id, status: "ok" };
  }
  return { ...(result.error ? { error: result.error } : {}), status: "error" };
}

function parseReceipts(value: unknown) {
  if (!isRecord(value) || !isRecord(value.data)) throw new Error("INVALID_EXPO_RESPONSE");
  const output: Record<string, ExpoResult> = {};
  for (const [id, receipt] of Object.entries(value.data)) output[id] = parseExpoResult(receipt);
  return output;
}

function parseExpoResult(value: unknown): ExpoResult & { id?: string } {
  if (!isRecord(value) || (value.status !== "ok" && value.status !== "error")) {
    throw new Error("INVALID_EXPO_RESPONSE");
  }
  const error =
    isRecord(value.details) && typeof value.details.error === "string"
      ? value.details.error
      : undefined;
  const id = typeof value.id === "string" ? value.id : undefined;
  if (value.status === "ok" && !id && "id" in value) throw new Error("INVALID_EXPO_RESPONSE");
  return { ...(error ? { error } : {}), ...(id ? { id } : {}), status: value.status };
}

function asString(value: SQLInputValue | undefined) {
  if (typeof value !== "string") throw new Error("INVALID_BROKER_DATA");
  return value;
}

function asNumber(value: SQLInputValue | undefined) {
  if (typeof value !== "number") throw new Error("INVALID_BROKER_DATA");
  return value;
}

const notificationCategories: ReadonlySet<string> = new Set<NotificationCategory>([
  "form",
  "permission-edit",
  "permission-execute",
  "permission-external-directory",
  "permission-glob",
  "permission-grep",
  "permission-other",
  "permission-question",
  "permission-read",
  "permission-shell",
  "permission-skill",
  "permission-subagent",
  "permission-webfetch",
  "permission-websearch",
  "session-done",
  "test",
]);

function asNotificationCategory(value: SQLInputValue | undefined): NotificationCategory {
  if (typeof value !== "string" || !notificationCategories.has(value)) {
    throw new Error("INVALID_BROKER_DATA");
  }
  return value as NotificationCategory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
