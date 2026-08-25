import { beforeEach, expect, jest, test } from "@jest/globals";
import type { OpenCodeClient } from "@opencode2-mobile/opencode-adapter";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";

import { useLifecycleTransportProbe } from "./use-lifecycle-transport-probe";

const mockStartEventStreamProbe = jest.fn();

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  startEventStreamProbe: (...args: unknown[]) => mockStartEventStreamProbe(...args),
}));

beforeEach(() => {
  jest.restoreAllMocks();
  mockStartEventStreamProbe.mockReset();
});

test("cancels on background and opens one fresh stream after foreground health", async () => {
  let appStateListener: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove } as NativeEventSubscription;
  });
  const initialStop = jest.fn(async () => undefined);
  const recoveryStop = jest.fn(async () => undefined);
  mockStartEventStreamProbe
    .mockReturnValueOnce({
      firstEvent: Promise.resolve({ eventType: "server.connected" }),
      stop: initialStop,
    })
    .mockReturnValueOnce({
      firstEvent: Promise.resolve({ eventType: "server.connected" }),
      stop: recoveryStop,
    });
  const healthGet = jest.fn(async () => ({ healthy: true, pid: 42, version: "test" }));
  const streamClient = {} as Pick<OpenCodeClient, "event">;
  const restClient = { health: { get: healthGet } } as Pick<OpenCodeClient, "health">;
  const hook = renderHook(() => useLifecycleTransportProbe());
  let run: Promise<unknown> | undefined;

  await act(async () => {
    run = hook.result.current.run(streamClient, restClient);
  });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready-to-background"));

  await act(async () => appStateListener?.("active"));
  expect(healthGet).not.toHaveBeenCalled();

  await act(async () => {
    appStateListener?.("inactive");
    appStateListener?.("background");
    appStateListener?.("background");
  });
  expect(initialStop).toHaveBeenCalledTimes(1);

  await act(async () => {
    appStateListener?.("active");
    appStateListener?.("active");
    await run;
  });

  expect(healthGet).toHaveBeenCalledTimes(1);
  expect(mockStartEventStreamProbe).toHaveBeenCalledTimes(2);
  expect(recoveryStop).toHaveBeenCalledTimes(1);
  expect(hook.result.current.phase).toBe("passed");
  expect(hook.result.current.result).toEqual({
    backgroundCancellation: true,
    foregroundHealth: true,
    initialEventType: "server.connected",
    reconnectEventType: "server.connected",
  });
});

test("removes the AppState listener and stops transport on unmount", async () => {
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => {
    return { remove } as NativeEventSubscription;
  });
  const stop = jest.fn(async () => undefined);
  mockStartEventStreamProbe.mockReturnValue({
    firstEvent: Promise.resolve({ eventType: "server.connected" }),
    stop,
  });
  const streamClient = {} as Pick<OpenCodeClient, "event">;
  const restClient = {
    health: { get: jest.fn(async () => ({ healthy: true, pid: 42, version: "test" })) },
  } as Pick<OpenCodeClient, "health">;
  const hook = renderHook(() => useLifecycleTransportProbe());
  let run: Promise<unknown> | undefined;

  await act(async () => {
    run = hook.result.current.run(streamClient, restClient);
  });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready-to-background"));
  hook.unmount();

  await expect(run).rejects.toThrow("LIFECYCLE_PROBE_CANCELLED");
  expect(remove).toHaveBeenCalled();
  expect(stop).toHaveBeenCalled();
});
