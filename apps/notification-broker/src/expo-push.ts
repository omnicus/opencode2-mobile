import type { SQLInputValue } from "node:sqlite";

import type { BrokerDatabase } from "./database.js";

const expoSendUrl = "https://exp.host/--/api/v2/push/send";
const expoReceiptsUrl = "https://exp.host/--/api/v2/push/getReceipts";

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
    for (const row of this.database.nextQueued()) {
      const id = asString(row.id);
      const bindingID = asString(row.binding_id);
      if (this.mode === "fake") {
        this.database.markDelivered(id);
        continue;
      }
      try {
        const response = await fetch(expoSendUrl, {
          body: JSON.stringify({
            body: "OpenCode needs your attention.",
            channelId: "opencode-attention",
            collapseId: asString(row.collapse_id),
            data: JSON.parse(asString(row.push_data_json)),
            priority: "high",
            sound: "default",
            tag: asString(row.collapse_id),
            title: "OpenCode",
            to: this.database.decryptExpoToken(row),
            ttl: 7 * 24 * 60 * 60,
          }),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          },
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 429 || response.status >= 500) {
          this.database.markRetry(
            id,
            response.status === 429 ? "RATE_LIMITED" : "EXPO_UNAVAILABLE",
          );
          continue;
        }
        if (!response.ok) {
          this.database.markFailed(id, "EXPO_REJECTED");
          continue;
        }
        const ticket = parseTicket(await response.json());
        if (ticket.status === "ok") this.database.markTicketed(id, ticket.id);
        else if (ticket.error === "DeviceNotRegistered") {
          this.database.disableDevice(bindingID, "provider-unregistered");
          this.database.markFailed(id, "DEVICE_NOT_REGISTERED");
        } else if (ticket.error === "MessageRateExceeded") {
          this.database.markRetry(id, "MESSAGE_RATE_EXCEEDED");
        } else this.database.markFailed(id, "EXPO_TICKET_ERROR");
      } catch {
        this.database.markRetry(id, "NETWORK_ERROR");
      }
    }
  }

  private async checkReceipts() {
    const rows = this.database.nextReceipts();
    if (rows.length === 0 || this.mode === "fake") return;
    const ids = rows.map((row) => asString(row.ticket_id));
    try {
      const response = await fetch(expoReceiptsUrl, {
        body: JSON.stringify({ ids }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        for (const row of rows) this.database.deferReceipt(asString(row.id), 5 * 60_000);
        return;
      }
      const receipts = parseReceipts(await response.json());
      for (const row of rows) {
        const receipt = receipts[asString(row.ticket_id)];
        const id = asString(row.id);
        if (!receipt) {
          const createdAtMs = asNumber(row.created_at_ms);
          if (Date.now() - createdAtMs >= 24 * 60 * 60_000) {
            this.database.markFailed(id, "RECEIPT_EXPIRED");
          } else {
            this.database.deferReceipt(id, 15 * 60_000);
          }
          continue;
        }
        if (receipt.status === "ok") this.database.markDelivered(id);
        else if (receipt.error === "DeviceNotRegistered") {
          this.database.disableDevice(asString(row.binding_id), "provider-unregistered");
          this.database.markFailed(id, "DEVICE_NOT_REGISTERED");
        } else if (receipt.error === "MessageRateExceeded") {
          this.database.markRetry(id, "MESSAGE_RATE_EXCEEDED");
        } else this.database.markFailed(id, "EXPO_RECEIPT_ERROR");
      }
    } catch {
      for (const row of rows) this.database.deferReceipt(asString(row.id), 5 * 60_000);
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
