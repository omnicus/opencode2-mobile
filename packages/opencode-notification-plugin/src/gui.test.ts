import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@opencode/plugin/gui", () => ({
  Command: "Command",
  createKeyed: <T>(source: () => T, fn: (value: T) => void) => fn(source()),
  Plugin: { define: <T>(plugin: T) => plugin },
  Style: "Style",
  TitlebarItem: "TitlebarItem",
}));
vi.mock("solid-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("solid-js")>()),
  onCleanup: vi.fn(),
}));

import plugin from "./gui.js";

type Item = { id: string; pressed?: boolean; run(): unknown; slash?: { name: string } };

const paused = { enabled: false, updatedAtMs: 1_000, v: 1 };
const enabled = { enabled: true, updatedAtMs: 2_000, v: 1 };
let rpc: Record<"enable" | "pause" | "status", ReturnType<typeof vi.fn>> & {
  events: { on: ReturnType<typeof vi.fn> };
};
let added: { registry: string; item: () => Item | undefined }[];
let toast: ReturnType<typeof vi.fn>;

const setup = () => {
  const cleanup = plugin.setup?.({
    add: (registry: string, item: () => Item | undefined) => added.push({ registry, item }),
    client: { rpc: () => rpc },
    t: (key: string) => key,
    toast: { show: toast },
  } as never);
  return { cleanup: cleanup as () => void };
};
const pill = () => added.find((entry) => entry.registry === "TitlebarItem")?.item();

beforeEach(() => {
  added = [];
  toast = vi.fn();
  rpc = {
    enable: vi.fn(async () => enabled),
    events: { on: vi.fn(() => () => undefined) },
    pause: vi.fn(async () => paused),
    status: vi.fn(async () => enabled),
  };
});

it("registers the slash commands the TUI offers", () => {
  const { cleanup } = setup();
  const commands = added
    .filter((entry) => entry.registry === "Command")
    .map((entry) => entry.item());
  expect(commands.map((command) => [command?.id, command?.slash?.name])).toEqual([
    ["status", "notifications-status"],
    ["pause", "notifications-pause"],
    ["enable", "notifications-enable"],
  ]);
  cleanup();
});

it("toggles delivery from the titlebar pill", async () => {
  rpc.status.mockResolvedValue(paused);
  const { cleanup } = setup();
  expect(pill()).toBeUndefined();
  await vi.waitFor(() =>
    expect(pill()).toMatchObject({ label: "titlebar.paused", pressed: false }),
  );

  pill()?.run();
  await vi.waitFor(() =>
    expect(pill()).toMatchObject({ label: "titlebar.enabled", pressed: true }),
  );
  expect(rpc.enable).toHaveBeenCalledOnce();
  expect(toast).toHaveBeenCalledWith({ title: "enabled", variant: "success" });

  pill()?.run();
  await vi.waitFor(() => expect(rpc.pause).toHaveBeenCalledOnce());
  cleanup();
});

it("colors the pill by its pressed state", () => {
  const { cleanup } = setup();
  const css = added.find((entry) => entry.registry === "Style")?.item() as unknown as string;
  expect(css).toContain(
    '[aria-label="titlebar.title"][aria-pressed="true"] { color: var(--v2-state-fg-success); }',
  );
  expect(css).toContain(
    '[aria-label="titlebar.title"][aria-pressed="false"] { color: var(--v2-state-fg-warning); }',
  );
  cleanup();
});

it("follows changes that other windows make", async () => {
  const { cleanup } = setup();
  await vi.waitFor(() => expect(pill()?.pressed).toBe(true));
  const listener = rpc.events.on.mock.calls[0]?.[1] as (event: { data: unknown }) => void;
  listener({ data: { ...paused, updatedAtMs: 3_000 } });
  expect(pill()?.pressed).toBe(false);
  cleanup();
});

it("reports an unreachable broker", async () => {
  rpc.pause.mockRejectedValue(new Error("NOTIFICATION_BROKER_UNAVAILABLE"));
  const { cleanup } = setup();
  const pause = added.find((entry) => entry.item()?.id === "pause")?.item();
  await pause?.run();
  expect(toast).toHaveBeenCalledWith({ title: "unreachable", variant: "error" });
  cleanup();
});
