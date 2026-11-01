import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readBrokerAccess, requestNotificationDeliveryState } from "./broker.js";

const originalFetch = globalThis.fetch;
const token = "a".repeat(20) + "B9_-".repeat(5);

let root: string;
let tokenFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "notification-plugin-broker-"));
  tokenFile = join(root, "ingest-token");
  writeFileSync(tokenFile, `${token}\n`);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(root, { force: true, recursive: true });
});

describe("notification broker access", () => {
  it.each([
    ["http://127.0.0.1:37101", "http://127.0.0.1:37101"],
    ["http://localhost:37101/", "http://localhost:37101"],
    ["HTTP://LOCALHOST", "http://localhost"],
  ])("reads the trimmed ingest token for %s", async (brokerOrigin, origin) => {
    await expect(readBrokerAccess({ brokerOrigin, tokenFile })).resolves.toEqual({
      brokerOrigin: origin,
      ingestToken: token,
    });
  });

  it.each([
    [{}],
    [{ brokerOrigin: "http://127.0.0.1:37101" }],
    [{ tokenFile: "/tmp/token" }],
    [{ brokerOrigin: 37101, tokenFile: "/tmp/token" }],
    [{ brokerOrigin: "http://127.0.0.1:37101", tokenFile: ["/tmp/token"] }],
  ])("requires string options %j", async (options) => {
    await expect(readBrokerAccess(options)).rejects.toThrow("NOTIFICATION_PLUGIN_OPTIONS_REQUIRED");
  });

  it.each([
    "https://127.0.0.1:37101",
    "http://broker.example:37101",
    "http://127.0.0.2:37101",
    "http://user@127.0.0.1:37101",
    "http://:secret@127.0.0.1:37101",
    "http://127.0.0.1:37101/v1",
    "http://127.0.0.1:37101/?token=1",
    "http://127.0.0.1:37101/#token",
    // The broker's plugin port listens on IPv4 loopback only.
    "http://[::1]:37101",
    "http://[0:0:0:0:0:0:0:1]:37101",
    "http://[::ffff:127.0.0.1]:37101",
  ])("rejects the non-loopback or decorated origin %s", async (brokerOrigin) => {
    await expect(readBrokerAccess({ brokerOrigin, tokenFile })).rejects.toThrow(
      "INVALID_NOTIFICATION_BROKER_ORIGIN",
    );
  });

  it("rejects an unparseable origin", async () => {
    await expect(readBrokerAccess({ brokerOrigin: "127.0.0.1:37101", tokenFile })).rejects.toThrow(
      TypeError,
    );
  });

  it("fails when the token file is missing", async () => {
    await expect(
      readBrokerAccess({
        brokerOrigin: "http://127.0.0.1:37101",
        tokenFile: join(root, "missing"),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "",
    "a".repeat(39),
    "a".repeat(101),
    `${"a".repeat(39)}.`,
    `${"a".repeat(20)} ${"a".repeat(20)}`,
  ])("rejects the malformed ingest token %j", async (contents) => {
    writeFileSync(tokenFile, contents);
    await expect(
      readBrokerAccess({ brokerOrigin: "http://127.0.0.1:37101", tokenFile }),
    ).rejects.toThrow("INVALID_INGEST_TOKEN");
  });

  it("accepts tokens at both length limits", async () => {
    for (const contents of ["a".repeat(40), "a".repeat(100)]) {
      writeFileSync(tokenFile, contents);
      await expect(
        readBrokerAccess({ brokerOrigin: "http://127.0.0.1:37101", tokenFile }),
      ).resolves.toMatchObject({ ingestToken: contents });
    }
  });
});

describe("notification broker controls", () => {
  it("uses the authenticated loopback control endpoint", async () => {
    const fetch = vi.fn(async () => Response.json({ enabled: false, updatedAtMs: 1_000, v: 1 }));
    globalThis.fetch = fetch;

    await expect(
      requestNotificationDeliveryState(
        { brokerOrigin: "http://127.0.0.1:37101", ingestToken: "test-token" },
        "pause",
      ),
    ).resolves.toEqual({ enabled: false, updatedAtMs: 1_000, v: 1 });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:37101/v1/plugin/pause",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
        method: "POST",
      }),
    );
  });
});
