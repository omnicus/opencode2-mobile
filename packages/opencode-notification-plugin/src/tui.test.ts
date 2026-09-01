import { beforeEach, expect, it, vi } from "vitest";

const { readBrokerAccess } = vi.hoisted(() => ({ readBrokerAccess: vi.fn() }));

vi.mock("@opencode-ai/plugin/tui", () => ({
  Plugin: { define: <T>(plugin: T) => plugin },
}));
vi.mock("./broker.js", () => ({
  readBrokerAccess,
  requestNotificationDeliveryState: vi.fn(),
}));

import plugin from "./tui.js";

beforeEach(() => {
  readBrokerAccess.mockResolvedValue({
    brokerOrigin: "http://127.0.0.1:37101",
    ingestToken: "test-token",
  });
});

it("registers notification commands in the always-mounted app slot", async () => {
  const layer = vi.fn();
  const slot = vi.fn((claim) => claim);

  await plugin.setup({
    keymap: { layer },
    options: {},
    ui: { slot, toast: { show: vi.fn() } },
  } as never);

  expect(slot).toHaveBeenCalledWith(expect.objectContaining({ append: "app" }));
  slot.mock.calls[0]?.[0].render({});
  expect(layer).toHaveBeenCalledOnce();
  const commands = layer.mock.calls[0]?.[0]().commands;
  expect(commands?.map((command: { id: string }) => command.id)).toEqual([
    "opencode-mobile-notifications.status",
    "opencode-mobile-notifications.pause",
    "opencode-mobile-notifications.enable",
  ]);
});
