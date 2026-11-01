import { afterEach, expect, jest, test } from "@jest/globals";
import type { OpenCodeClient, SessionInfo } from "@opencode2-mobile/opencode-adapter";
import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { useMarkSessionViewed } from "./use-mark-session-viewed";

const mockMarkViewed = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  markOpenCodeSessionViewed: (...args: unknown[]) => mockMarkViewed(...args),
}));

const client = {} as OpenCodeClient;

afterEach(() => {
  mockMarkViewed.mockClear();
  jest.restoreAllMocks();
});

function session(time: Partial<SessionInfo["time"]>): SessionInfo {
  return {
    cost: 0,
    id: "ses_open",
    location: { directory: "/project" },
    projectID: "project-1",
    time: { created: 1, updated: 1, ...time },
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  };
}

test("marks each unread finished run once while the session is visible", () => {
  const view = renderHook(
    (props: Parameters<typeof useMarkSessionViewed>[0]) => useMarkSessionViewed(props),
    {
      initialProps: { client, enabled: true, session: session({ idle: 20, viewed: 10 }) },
    },
  );
  expect(mockMarkViewed).toHaveBeenCalledWith(client, "ses_open", 20);

  view.rerender({ client, enabled: true, session: session({ idle: 20, viewed: 10 }) });
  expect(mockMarkViewed).toHaveBeenCalledTimes(1);

  // A run that ends while the session stays open is marked too.
  view.rerender({ client, enabled: true, session: session({ idle: 30, viewed: 20 }) });
  expect(mockMarkViewed).toHaveBeenLastCalledWith(client, "ses_open", 30);
  expect(mockMarkViewed).toHaveBeenCalledTimes(2);
});

test("leaves read, unfinished, and hidden sessions alone", () => {
  const view = renderHook(
    (props: Parameters<typeof useMarkSessionViewed>[0]) => useMarkSessionViewed(props),
    {
      initialProps: { client, enabled: true, session: session({ idle: 20, viewed: 20 }) },
    },
  );
  view.rerender({ client, enabled: true, session: session({}) });
  view.rerender({ client, enabled: false, session: session({ idle: 30 }) });
  view.rerender({ client: undefined, enabled: true, session: session({ idle: 30 }) });
  expect(mockMarkViewed).not.toHaveBeenCalled();
});

test("waits until the app returns to the foreground", () => {
  let listener: ((state: AppStateStatus) => void) | undefined;
  const appState = AppState as { currentState: unknown };
  const currentState = appState.currentState;
  appState.currentState = "background";
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    listener = handler as (state: AppStateStatus) => void;
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });

  renderHook(() => useMarkSessionViewed({ client, enabled: true, session: session({ idle: 20 }) }));
  expect(mockMarkViewed).not.toHaveBeenCalled();

  act(() => listener?.("active"));
  expect(mockMarkViewed).toHaveBeenCalledWith(client, "ses_open", 20);
  appState.currentState = currentState;
});
