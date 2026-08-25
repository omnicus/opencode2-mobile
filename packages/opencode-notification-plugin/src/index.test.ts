import { describe, expect, it } from "vitest";

import { normalizeOpenCodeNotificationEvent } from "./index.js";

describe("notification plugin projection", () => {
  it("projects permission events without request content", () => {
    expect(
      normalizeOpenCodeNotificationEvent({
        created: 1_000,
        data: {
          action: "shell",
          id: "per_1",
          resources: ["private resource"],
          sessionID: "ses_1",
        },
        id: "evt_1",
        type: "permission.asked",
      }),
    ).toEqual({
      eventID: "evt_1",
      interaction: "permission",
      observedAtMs: 1_000,
      requestID: "per_1",
      sessionID: "ses_1",
      state: "pending",
      v: 1,
    });
  });

  it("retains only the location needed by a global form", () => {
    expect(
      normalizeOpenCodeNotificationEvent({
        created: 1_000,
        data: { form: { fields: [], id: "frm_1", sessionID: "global", title: "Secret" } },
        id: "evt_2",
        location: { directory: "/workspace" },
        type: "form.created",
      }),
    ).toMatchObject({
      interaction: "form",
      location: { directory: "/workspace" },
      requestID: "frm_1",
      sessionID: "global",
      state: "pending",
    });
  });
});
