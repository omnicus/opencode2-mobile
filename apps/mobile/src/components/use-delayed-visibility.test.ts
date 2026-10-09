import { expect, jest, test } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";
import { useDelayedVisibility } from "./use-delayed-visibility";

test("shows persistent work after one second, clears immediately, and does not cross scopes", () => {
  jest.useFakeTimers();
  const view = renderHook(
    ({ pending, scope }: { pending: boolean; scope: string }) =>
      useDelayedVisibility(pending, scope),
    {
      initialProps: { pending: true, scope: "first" },
    },
  );
  try {
    expect(view.result.current).toBe(false);
    act(() => jest.advanceTimersByTime(999));
    expect(view.result.current).toBe(false);
    act(() => jest.advanceTimersByTime(1));
    expect(view.result.current).toBe(true);
    view.rerender({ pending: true, scope: "second" });
    expect(view.result.current).toBe(false);
    act(() => jest.advanceTimersByTime(500));
    view.rerender({ pending: false, scope: "second" });
    expect(view.result.current).toBe(false);
    act(() => jest.advanceTimersByTime(1000));
    expect(view.result.current).toBe(false);
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test("cancels its pending timer on unmount", () => {
  jest.useFakeTimers();
  const view = renderHook(() => useDelayedVisibility(true, "first"));
  try {
    expect(jest.getTimerCount()).toBe(1);
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
