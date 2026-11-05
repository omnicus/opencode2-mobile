import { describe, expect, it, vi } from "vitest";

const { requestNotificationDeliveryState } = vi.hoisted(() => ({
  requestNotificationDeliveryState: vi.fn(),
}));

vi.mock("./broker.js", () => ({
  readBrokerAccess: async () => ({ brokerOrigin: "http://127.0.0.1:37101", ingestToken: "token" }),
  requestNotificationDeliveryState,
}));

import notificationPlugin, { normalizeOpenCodeNotificationEvent } from "./index.js";

describe("notification delivery RPC", () => {
  it("forwards delivery changes to the broker and broadcasts them", async () => {
    const emit = vi.fn();
    const dispose = vi.fn();
    const register = vi.fn(async () => ({ dispose, events: { emit } }));
    const paused = { enabled: false, updatedAtMs: 1_000, v: 1 };
    requestNotificationDeliveryState.mockResolvedValue(paused);

    const cleanup = await notificationPlugin.setup({
      event: {
        subscribe: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => ({ done: true, value: undefined }),
            return: async () => ({ done: true, value: undefined }),
          }),
        }),
      },
      options: {},
      rpc: { register },
      storage: { get: async () => undefined, set: async () => undefined },
    } as never);
    const handlers = (
      register.mock.calls[0] as unknown as [unknown, Record<string, () => unknown>]
    )[1];

    await expect(handlers.pause?.()).resolves.toEqual(paused);
    expect(requestNotificationDeliveryState).toHaveBeenLastCalledWith(expect.anything(), "pause");
    expect(emit).toHaveBeenCalledWith("changed", paused);

    emit.mockClear();
    await handlers.status?.();
    expect(requestNotificationDeliveryState).toHaveBeenLastCalledWith(expect.anything(), "status");
    expect(emit).not.toHaveBeenCalled();

    await (cleanup as () => Promise<void>)();
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("notification plugin projection", () => {
  it("defines the server notification plugin", () => {
    expect(notificationPlugin.id).toBe("opencode-mobile-notifications");
    expect(notificationPlugin.setup).toBeTypeOf("function");
  });

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
      category: "permission-shell",
      eventID: "evt_1",
      interaction: "permission",
      kind: "interaction",
      observedAtMs: 1_000,
      requestID: "per_1",
      sessionID: "ses_1",
      state: "pending",
      v: 1,
    });
  });

  it("uses a generic category for unknown permission actions", () => {
    expect(
      normalizeOpenCodeNotificationEvent({
        created: 1_000,
        data: { action: "private-plugin-action", id: "per_1", sessionID: "ses_1" },
        id: "evt_1",
        type: "permission.asked",
      }),
    ).toMatchObject({ category: "permission-other", kind: "interaction" });
  });

  it.each([
    ["edit", "permission-edit"],
    ["execute", "permission-execute"],
    ["external_directory", "permission-external-directory"],
    ["glob", "permission-glob"],
    ["grep", "permission-grep"],
    ["question", "permission-question"],
    ["read", "permission-read"],
    ["skill", "permission-skill"],
    ["subagent", "permission-subagent"],
    ["webfetch", "permission-webfetch"],
    ["websearch", "permission-websearch"],
  ])("maps the %s action to %s", (action, category) => {
    expect(
      normalizeOpenCodeNotificationEvent({
        created: 1_000,
        data: { action, id: "per_1", sessionID: "ses_1" },
        id: "evt_1",
        type: "permission.asked",
      }),
    ).toMatchObject({ category });
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
      category: "form",
      interaction: "form",
      kind: "interaction",
      location: { directory: "/workspace" },
      requestID: "frm_1",
      sessionID: "global",
      state: "pending",
    });
  });

  it("projects only successful execution completion", () => {
    expect(
      normalizeOpenCodeNotificationEvent({
        created: 1_000,
        data: { sessionID: "ses_1" },
        id: "evt_done",
        type: "session.execution.succeeded",
      }),
    ).toEqual({
      category: "session-done",
      eventID: "evt_done",
      kind: "session-done",
      observedAtMs: 1_000,
      sessionID: "ses_1",
      v: 1,
    });
    expect(
      normalizeOpenCodeNotificationEvent({
        created: 1_001,
        data: { sessionID: "ses_1", status: { type: "idle" } },
        id: "evt_idle",
        type: "session.status",
      }),
    ).toBeUndefined();
    expect(
      normalizeOpenCodeNotificationEvent({
        created: 1_002,
        data: { sessionID: "ses_1" },
        id: "evt_failed",
        type: "session.execution.failed",
      }),
    ).toBeUndefined();
  });
});
