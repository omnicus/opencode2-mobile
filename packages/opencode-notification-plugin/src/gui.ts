import { Command, createKeyed, Plugin, Style, TitlebarItem } from "@opencode/plugin/gui";
import {
  type NotificationDeliveryState,
  parseNotificationDeliveryState,
} from "@opencode2-mobile/notification-protocol";
import { createSignal, onCleanup } from "solid-js";

import { MobileNotifications } from "./rpc.js";

const operations = ["status", "pause", "enable"] as const;
const statusPollMs = 60_000;

export default Plugin.define({
  i18n: {
    en: {
      "command.enable": "Enable mobile notifications",
      "command.pause": "Pause mobile notifications",
      "command.status": "Show mobile notification status",
      enabled: "Mobile notifications enabled",
      group: "Notifications",
      paused: "Mobile notifications paused",
      "titlebar.enabled": "Notifications on",
      "titlebar.paused": "Notifications paused",
      "titlebar.title": "Mobile notifications",
      unreachable: "The notification broker could not be reached",
    },
  },
  setup(ctx) {
    const [state, setState] = createSignal<NotificationDeliveryState>();
    const [busy, setBusy] = createSignal(false);
    // Keep the newest state when a poll and a command answer out of order.
    const accept = (next: NotificationDeliveryState) =>
      setState((current) => (current && current.updatedAtMs > next.updatedAtMs ? current : next));
    const request = async (operation: (typeof operations)[number]) =>
      parseNotificationDeliveryState(await ctx.client.rpc(MobileNotifications)[operation]({}));
    const refresh = () => request("status").then(accept, () => setState(undefined));
    const run = async (operation: (typeof operations)[number]) => {
      setBusy(true);
      try {
        const next = await request(operation);
        accept(next);
        ctx.toast.show({ title: ctx.t(next.enabled ? "enabled" : "paused"), variant: "success" });
      } catch {
        ctx.toast.show({ title: ctx.t("unreachable"), variant: "error" });
      } finally {
        setBusy(false);
      }
    };

    // The client changes when the server restarts, so subscribe again for each one.
    createKeyed(
      () => ctx.client,
      (client) => {
        onCleanup(
          client.rpc(MobileNotifications).events.on("changed", (event) => {
            accept(parseNotificationDeliveryState(event.data));
          }),
        );
        void refresh();
      },
    );
    // The broker CLI can pause delivery without going through this plugin.
    const poll = setInterval(() => void refresh(), statusPollMs);

    for (const operation of operations) {
      ctx.add(Command, () => ({
        group: ctx.t("group"),
        id: operation,
        run: () => run(operation),
        slash: { name: `notifications-${operation}` },
        title: ctx.t(`command.${operation}`),
      }));
    }
    // A toggle: pressed while delivery is enabled. Hidden while the broker state is unknown.
    ctx.add(TitlebarItem, (): TitlebarItem | undefined => {
      const current = state();
      if (!current) return undefined;
      return {
        busy: busy(),
        icon: "notifications",
        id: "delivery",
        label: ctx.t(current.enabled ? "titlebar.enabled" : "titlebar.paused"),
        pressed: current.enabled,
        run: () => void run(current.enabled ? "pause" : "enable"),
        title: ctx.t("titlebar.title"),
      };
    });
    // Titlebar items have no color option, so match this pill by its accessible name.
    ctx.add(Style, () => {
      const button = `[data-slot="titlebar-update"] > button[aria-label=${JSON.stringify(ctx.t("titlebar.title"))}]`;
      return [
        `${button}[aria-pressed="true"] { color: var(--v2-state-fg-success); }`,
        `${button}[aria-pressed="false"] { color: var(--v2-state-fg-warning); }`,
      ].join("\n");
    });

    return () => clearInterval(poll);
  },
});
