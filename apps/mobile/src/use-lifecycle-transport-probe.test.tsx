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
  const healthGet = jest.fn(async () => ({ urls: [], pid: 42, version: "test" }));
  const streamClient = {} as Pick<OpenCodeClient, "event">;
  const restClient = { server: { status: healthGet } } as Pick<OpenCodeClient, "server">;
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
    server: { status: jest.fn(async () => ({ urls: [], pid: 42, version: "test" })) },
  } as Pick<OpenCodeClient, "server">;
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

test("rejects a second run and ignores reset while a probe is active", async () => {
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => {
    return { remove: jest.fn() } as NativeEventSubscription;
  });
  mockStartEventStreamProbe.mockReturnValue({
    firstEvent: Promise.resolve({ eventType: "server.connected" }),
    stop: jest.fn(async () => undefined),
  });
  const streamClient = {} as Pick<OpenCodeClient, "event">;
  const restClient = { server: { status: jest.fn() } } as unknown as Pick<OpenCodeClient, "server">;
  const hook = renderHook(() => useLifecycleTransportProbe());
  let run: Promise<unknown> | undefined;

  await act(async () => {
    run = hook.result.current.run(streamClient, restClient);
  });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready-to-background"));
  expect(hook.result.current.running).toBe(true);

  await expect(hook.result.current.run(streamClient, restClient)).rejects.toThrow(
    "LIFECYCLE_PROBE_ALREADY_RUNNING",
  );
  act(() => hook.result.current.reset());
  expect(hook.result.current.phase).toBe("ready-to-background");

  hook.unmount();
  await expect(run).rejects.toThrow("LIFECYCLE_PROBE_CANCELLED");
});

test("fails when background cancellation fails and can then be reset", async () => {
  let appStateListener: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove } as NativeEventSubscription;
  });
  const stopError = new Error("STOP_FAILED");
  const stop = jest.fn(async () => {
    throw stopError;
  });
  mockStartEventStreamProbe.mockReturnValue({
    firstEvent: Promise.resolve({ eventType: "server.connected" }),
    stop,
  });
  const healthGet = jest.fn();
  const streamClient = {} as Pick<OpenCodeClient, "event">;
  const restClient = { server: { status: healthGet } } as unknown as Pick<OpenCodeClient, "server">;
  const hook = renderHook(() => useLifecycleTransportProbe());
  let run: Promise<unknown> | undefined;

  await act(async () => {
    run = hook.result.current.run(streamClient, restClient);
  });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready-to-background"));
  await act(async () => {
    appStateListener?.("background");
    await expect(run).rejects.toBe(stopError);
  });

  expect(hook.result.current.phase).toBe("failed");
  expect(hook.result.current.running).toBe(false);
  expect(remove).toHaveBeenCalled();
  expect(healthGet).not.toHaveBeenCalled();
  expect(mockStartEventStreamProbe).toHaveBeenCalledTimes(1);

  act(() => hook.result.current.reset());
  expect(hook.result.current.phase).toBe("idle");
  expect(hook.result.current.result).toBeUndefined();
});

test("aborts foreground health after ten seconds without opening a recovery stream", async () => {
  jest.useFakeTimers();
  try {
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      appStateListener = listener;
      return { remove: jest.fn() } as NativeEventSubscription;
    });
    mockStartEventStreamProbe.mockReturnValue({
      firstEvent: Promise.resolve({ eventType: "server.connected" }),
      stop: jest.fn(async () => undefined),
    });
    let healthSignal: AbortSignal | undefined;
    const healthGet = jest.fn((options: { signal: AbortSignal }) => {
      healthSignal = options.signal;
      return new Promise(() => undefined);
    });
    const streamClient = {} as Pick<OpenCodeClient, "event">;
    const restClient = { server: { status: healthGet } } as unknown as Pick<
      OpenCodeClient,
      "server"
    >;
    const hook = renderHook(() => useLifecycleTransportProbe());
    let run: Promise<unknown> | undefined;

    await act(async () => {
      run = hook.result.current.run(streamClient, restClient);
    });
    expect(hook.result.current.phase).toBe("ready-to-background");
    await act(async () => {
      appStateListener?.("background");
      appStateListener?.("active");
    });
    expect(hook.result.current.phase).toBe("recovering");
    expect(healthGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(9_999);
    });
    expect(healthSignal?.aborted).toBe(false);

    const rejection = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await act(async () => {
      jest.advanceTimersByTime(1);
      await rejection;
    });
    expect(healthSignal?.aborted).toBe(true);
    expect(hook.result.current.phase).toBe("failed");
    expect(mockStartEventStreamProbe).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test("reports a failed foreground health check", async () => {
  let appStateListener: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() } as NativeEventSubscription;
  });
  mockStartEventStreamProbe.mockReturnValue({
    firstEvent: Promise.resolve({ eventType: "server.connected" }),
    stop: jest.fn(async () => undefined),
  });
  const healthError = new Error("HEALTH_FAILED");
  const streamClient = {} as Pick<OpenCodeClient, "event">;
  const restClient = {
    server: {
      status: jest.fn(async () => {
        throw healthError;
      }),
    },
  } as unknown as Pick<OpenCodeClient, "server">;
  const hook = renderHook(() => useLifecycleTransportProbe());
  let run: Promise<unknown> | undefined;

  await act(async () => {
    run = hook.result.current.run(streamClient, restClient);
  });
  await act(async () => {
    appStateListener?.("background");
    appStateListener?.("active");
    await expect(run).rejects.toBe(healthError);
  });

  expect(hook.result.current.phase).toBe("failed");
  expect(mockStartEventStreamProbe).toHaveBeenCalledTimes(1);
});

test("stops the recovery stream when unmounted during recovery", async () => {
  let appStateListener: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() } as NativeEventSubscription;
  });
  const recoveryStop = jest.fn(async () => undefined);
  mockStartEventStreamProbe
    .mockReturnValueOnce({
      firstEvent: Promise.resolve({ eventType: "server.connected" }),
      stop: jest.fn(async () => undefined),
    })
    .mockReturnValueOnce({
      firstEvent: new Promise(() => undefined),
      stop: recoveryStop,
    });
  const streamClient = {} as Pick<OpenCodeClient, "event">;
  const restClient = {
    server: { status: jest.fn(async () => ({ urls: [], pid: 42, version: "test" })) },
  } as unknown as Pick<OpenCodeClient, "server">;
  const hook = renderHook(() => useLifecycleTransportProbe());

  await act(async () => {
    void hook.result.current.run(streamClient, restClient);
  });
  await act(async () => {
    appStateListener?.("background");
    appStateListener?.("active");
  });
  await waitFor(() => expect(mockStartEventStreamProbe).toHaveBeenCalledTimes(2));

  hook.unmount();
  expect(recoveryStop).toHaveBeenCalledTimes(1);
});
