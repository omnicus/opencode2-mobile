import { Plugin } from "@opencode-ai/plugin/tui";

import { readBrokerAccess, requestNotificationDeliveryState } from "./broker.js";

export default Plugin.define({
  id: "opencode-mobile-notifications",
  async setup(context) {
    const access = await readBrokerAccess(context.options);
    const run = async (operation: "enable" | "pause" | "status") => {
      try {
        const state = await requestNotificationDeliveryState(access, operation);
        context.ui.toast.show({
          message: `Mobile notifications ${state.enabled ? "enabled" : "paused"}`,
          variant: "success",
        });
      } catch {
        context.ui.toast.show({
          message: "The notification broker could not be reached",
          variant: "error",
        });
      }
    };
    return context.ui.slot({
      append: "sidebar.footer",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              group: "Notifications",
              id: "opencode-mobile-notifications.status",
              palette: true,
              run: () => run("status"),
              slash: { name: "notifications-status" },
              title: "Show mobile notification status",
            },
            {
              group: "Notifications",
              id: "opencode-mobile-notifications.pause",
              palette: true,
              run: () => run("pause"),
              slash: { name: "notifications-pause" },
              title: "Pause mobile notifications",
            },
            {
              group: "Notifications",
              id: "opencode-mobile-notifications.enable",
              palette: true,
              run: () => run("enable"),
              slash: { name: "notifications-enable" },
              title: "Enable mobile notifications",
            },
          ],
        }));
        return null;
      },
    });
  },
});
