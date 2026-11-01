import { renderHook } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import { announceOnIOS, useAnnouncement } from "./use-announcement";

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("announces on iOS only when the message changes to text", () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation();
  const hook = renderHook(
    ({ message }: { message: string | undefined }) => useAnnouncement(message),
    {
      initialProps: { message: undefined as string | undefined },
    },
  );
  expect(announce).not.toHaveBeenCalled();
  hook.rerender({ message: "Saved" });
  hook.rerender({ message: "Saved" });
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith("Saved");
});

test("leaves Android to live regions", () => {
  jest.replaceProperty(Platform, "OS", "android");
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation();
  announceOnIOS("Saved");
  expect(announce).not.toHaveBeenCalled();
});
