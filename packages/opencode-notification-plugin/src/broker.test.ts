import { afterEach, describe, expect, it, vi } from "vitest";

import { requestNotificationDeliveryState } from "./broker.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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
