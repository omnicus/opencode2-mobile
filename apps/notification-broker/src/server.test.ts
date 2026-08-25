import { describe, expect, it, vi } from "vitest";

import { assertOpenCodePairingOrigin, validateOpenCodePairingCredentials } from "./server.js";

const input = {
  allowDevelopmentHttp: true,
  name: "Workstation",
  openCodeOrigin: "http://100.64.0.10:4096",
  password: "secret",
  username: "opencode",
  v: 1,
} as const;

describe("OpenCode pairing credential validation", () => {
  it("accepts only the same host on the built-in OpenCode service port", () => {
    expect(() =>
      assertOpenCodePairingOrigin("http://100.64.0.10:37100", "http://100.64.0.10:4096", [4_096]),
    ).not.toThrow();
    expect(() =>
      assertOpenCodePairingOrigin("http://100.64.0.10:37100", "http://100.64.0.11:4096", [4_096]),
    ).toThrow("PAIRING_ORIGIN_HOST_MISMATCH");
    expect(() =>
      assertOpenCodePairingOrigin("http://100.64.0.10:37100", "http://100.64.0.10:22", [4_096]),
    ).toThrow("PAIRING_OPENCODE_PORT_MISMATCH");
    expect(() =>
      assertOpenCodePairingOrigin(
        "https://code.example.test:37100",
        "https://code.example.test",
        [443],
      ),
    ).not.toThrow();
  });

  it("checks health and an authenticated session request without redirects", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));

    await validateOpenCodePairingCredentials(input, fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://100.64.0.10:4096/api/session?limit=1&order=desc"),
      expect.objectContaining({
        headers: { Authorization: "Basic b3BlbmNvZGU6c2VjcmV0" },
        redirect: "error",
      }),
    );
  });

  it("rejects invalid OpenCode credentials", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(validateOpenCodePairingCredentials(input, fetch)).rejects.toThrow(
      "PAIRING_OPENCODE_UNAUTHORIZED",
    );
  });
});
