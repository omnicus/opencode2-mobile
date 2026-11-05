import { Rpc } from "@opencode/plugin/rpc";

const noInput = { type: "object", additionalProperties: false } as const;
const deliveryState = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    updatedAtMs: { type: "number" },
    v: { const: 1 },
  },
  required: ["enabled", "updatedAtMs", "v"],
  additionalProperties: false,
} as const;

export const MobileNotifications = Rpc.define({
  id: "opencode-mobile-notifications",
  methods: {
    enable: { input: noInput, output: deliveryState },
    pause: { input: noInput, output: deliveryState },
    status: { input: noInput, output: deliveryState },
  },
  events: {
    changed: { schema: deliveryState },
  },
});
