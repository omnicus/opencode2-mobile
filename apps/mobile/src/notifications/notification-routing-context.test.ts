import { expect, jest, test } from "@jest/globals";
import * as Notifications from "expo-notifications";
import "./notification-routing-context";

jest.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
}));

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  getOpenCodeSession: jest.fn(),
  listOpenCodeFormRequests: jest.fn(),
  listOpenCodePermissionRequests: jest.fn(),
}));
jest.mock("../connections/connections-context", () => ({ useConnections: jest.fn() }));
jest.mock("../state/connection-runtime-context", () => ({ useConnectionRuntime: jest.fn() }));

test("suppresses notification presentation while the app is foregrounded", async () => {
  const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls[0]?.[0];

  await expect(handler?.handleNotification({} as never)).resolves.toEqual({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  });
});
