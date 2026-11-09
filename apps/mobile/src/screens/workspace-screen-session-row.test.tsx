import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type { SessionInfo } from "@opencode2-mobile/opencode-adapter";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import type { FollowedInboxRow } from "../state/followed-project-inbox";
import { palette, pressedOpacity } from "../theme";
import {
  runSessionRowAction,
  SessionRow,
  sessionAccessibilityLabel,
} from "./workspace-screen-session-row";

const mockClose = jest.fn();

jest.mock("@opencode2-mobile/opencode-adapter", () => ({}));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => undefined) }));
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({
  __esModule: true,
  default: ({
    children,
    onSwipeableWillOpen,
    renderRightActions,
  }: {
    children: ReactNode;
    onSwipeableWillOpen: () => void;
    renderRightActions: (progress: unknown, translation: unknown, swipeable: unknown) => ReactNode;
  }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return React.createElement(
      React.Fragment,
      null,
      children,
      React.createElement(
        Pressable,
        {
          accessibilityLabel: "Open swipe actions",
          accessibilityRole: "button",
          onPress: onSwipeableWillOpen,
        },
        React.createElement(Text, null, "Swipe"),
      ),
      renderRightActions(undefined, undefined, { close: mockClose }),
    );
  },
}));

const now = Date.UTC(2026, 10, 1, 12);

type Handlers = {
  onActions: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onPress: () => void;
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"], now });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

test("the swipe action closes the row before archiving it", () => {
  const view = renderRow(row());

  fireEvent.press(screen.getByRole("button", { name: "Open swipe actions" }));
  expect(Haptics.selectionAsync).toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Archive Build the app" }));
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(view.onArchive).toHaveBeenCalledTimes(1);
  expect(view.onDelete).not.toHaveBeenCalled();
  expect(view.onPress).not.toHaveBeenCalled();

  view.rerender(rowElement(row({ archived: true }), view.handlers));
  expect(screen.getByRole("button", { name: "Unarchive Build the app" })).toBeOnTheScreen();
});

test("pressing opens the session and a long press opens its actions", () => {
  const handlers = renderRow(row());
  const button = screen.getByRole("button", { name: /^Open session Build the app/ });

  fireEvent.press(button);
  expect(handlers.onPress).toHaveBeenCalledTimes(1);
  fireEvent(button, "longPress");
  expect(handlers.onActions).toHaveBeenCalledTimes(1);
});

test("accessibility actions open, archive, delete, or show actions for the session", () => {
  const view = renderRow(row());
  const button = () => screen.getByRole("button", { name: /^Open session Build the app/ });

  expect(button().props.accessibilityActions).toEqual([
    { name: "activate" },
    { label: "Archive session", name: "archive" },
    { label: "Delete session", name: "delete" },
    { label: "Session actions", name: "options" },
  ]);
  for (const actionName of ["activate", "archive", "delete", "options", "unknown"]) {
    fireEvent(button(), "accessibilityAction", { nativeEvent: { actionName } });
  }
  expect(view.onPress).toHaveBeenCalledTimes(1);
  expect(view.onArchive).toHaveBeenCalledTimes(1);
  expect(view.onDelete).toHaveBeenCalledTimes(1);
  expect(view.onActions).toHaveBeenCalledTimes(1);

  view.rerender(rowElement(row({ archived: true }), view.handlers));
  expect(button().props.accessibilityActions).toContainEqual({
    label: "Unarchive session",
    name: "archive",
  });
});

test("runs only the handler named by the action", () => {
  const handlers = {
    onActions: jest.fn(),
    onArchive: jest.fn(),
    onDelete: jest.fn(),
    onPress: jest.fn(),
  };

  runSessionRowAction("options", handlers);
  expect(handlers.onActions).toHaveBeenCalledTimes(1);
  expect(handlers.onArchive).not.toHaveBeenCalled();
  expect(handlers.onDelete).not.toHaveBeenCalled();
  expect(handlers.onPress).not.toHaveBeenCalled();
});

test("dims the row and the archive action while pressed on iOS", () => {
  renderRow(row());
  const pressedStyle = (label: (value: string) => boolean) => {
    const [pressable] = screen.UNSAFE_root.findAll(
      (element: { props: Record<string, unknown> }) =>
        typeof element.props.style === "function" &&
        label(String(element.props.accessibilityLabel)),
    );
    return StyleSheet.flatten(pressable?.props.style({ pressed: true }));
  };

  expect(pressedStyle((label) => label.startsWith("Open session"))).toMatchObject({
    opacity: pressedOpacity,
  });
  expect(pressedStyle((label) => label === "Archive Build the app")).toMatchObject({
    opacity: pressedOpacity,
  });
});

test("a waiting or finished row names its status instead of the time", () => {
  const view = renderRow(row({ status: "approval" }));
  expect(screen.getByTestId("session-row-status-approval")).toHaveTextContent("Approval");
  expect(screen.queryByText("5m")).toBeNull();

  for (const [status, label] of [
    ["input", "Question"],
    ["done", "Done"],
    ["failed", "Failed"],
  ] as const) {
    view.rerender(rowElement(row({ status }), view.handlers));
    expect(screen.getByTestId(`session-row-status-${status}`)).toHaveTextContent(label);
  }
});

test("a working row counts the run's duration every second", () => {
  const view = renderRow(
    row({
      session: session({ time: { busy: now - 5_000, created: 1, updated: now } }),
      status: "working",
    }),
  );
  const status = () => screen.getByTestId("session-row-status-working");

  expect(status()).toHaveTextContent("Working 5s");
  expect(status().props.accessibilityLabel).toBe("Working");
  act(() => jest.advanceTimersByTime(2_000));
  expect(status()).toHaveTextContent("Working 7s");

  view.rerender(rowElement(row({ status: "working" }), view.handlers));
  expect(status()).toHaveTextContent(/^Working$/);
});

test("a read row shows how long ago its last run finished", () => {
  const view = renderRow(row());
  expect(screen.getByText("5m")).toBeOnTheScreen();

  view.rerender(
    rowElement(
      row({ session: session({ time: { created: 1, idle: now - 3 * 3_600_000, updated: now } }) }),
      view.handlers,
    ),
  );
  expect(screen.getByText("3h")).toBeOnTheScreen();
});

test("the third line shows the branch, else the worktree, else nothing", () => {
  const view = renderRow(row({ worktreeLabel: "feature-tree" }), "main");
  expect(screen.getByTestId("session-row-branch")).toHaveTextContent("main");

  view.rerender(rowElement(row({ worktreeLabel: "feature-tree" }), view.handlers));
  expect(screen.getByTestId("session-row-branch")).toHaveTextContent("feature-tree");

  view.rerender(rowElement(row(), view.handlers));
  expect(screen.queryByTestId("session-row-branch")).toBeNull();
  expect(screen.getByText("Project")).toBeOnTheScreen();
});

test("unread titles are semibold, working rows and archived rows recede", () => {
  const view = renderRow(row({ status: "done" }));
  const title = () => StyleSheet.flatten(screen.getByText("Build the app").props.style);
  const copy = () => StyleSheet.flatten(screen.getByTestId("session-row-copy").props.style);
  expect(title()).toMatchObject({ color: palette.ink, fontWeight: "600" });
  expect(copy()).not.toHaveProperty("opacity");

  view.rerender(rowElement(row(), view.handlers));
  expect(title()).toMatchObject({ color: palette.dim });

  // Faded rows start from brighter text so the composite still clears 4.5:1.
  view.rerender(rowElement(row({ status: "working" }), view.handlers));
  expect(title()).toMatchObject({ color: "#b0b0b0" });
  expect(copy()).toMatchObject({ opacity: 0.7 });

  view.rerender(rowElement(row({ archived: true }), view.handlers));
  expect(title()).toMatchObject({ color: palette.ink });
  expect(copy()).toMatchObject({ opacity: 0.5 });
});

test("large text gives the title and branch more lines", () => {
  const view = renderRow(row(), "main");
  expect(screen.getByText("Build the app").props.numberOfLines).toBe(1);
  expect(screen.getByText("main").props.numberOfLines).toBe(1);

  view.rerender(rowElement(row(), view.handlers, true, "main"));
  expect(screen.getByText("Build the app").props.numberOfLines).toBe(3);
  expect(screen.getByText("main").props.numberOfLines).toBe(2);
});

test("untitled sessions get a readable title", () => {
  renderRow(row({ session: session({ title: "" }) }));

  expect(screen.getByText("Untitled session")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Archive Untitled session" })).toBeOnTheScreen();
});

test("the accessibility label lists the branch or worktree, status, read state, archive, and time", () => {
  expect(sessionAccessibilityLabel(row(), undefined)).toBe(
    "Open session Build the app. Project. Updated 5 minutes ago",
  );
  expect(
    sessionAccessibilityLabel(
      row({
        archived: true,
        session: session({ time: { created: 1, idle: now, updated: now - 60_000 } }),
        status: "failed",
        worktreeLabel: "feature-tree",
      }),
      undefined,
    ),
  ).toBe(
    "Open session Build the app. Project. Worktree feature-tree. Failed. Unread. Archived. Updated just now",
  );
  expect(
    sessionAccessibilityLabel(
      row({ session: session({ title: "" }), status: "input", worktreeLabel: "feature-tree" }),
      "main",
    ),
  ).toBe("Open session Untitled session. Project. Branch main. Question. Updated 5 minutes ago");
});

function renderRow(input: FollowedInboxRow, branch?: string) {
  const handlers = {
    onActions: jest.fn(),
    onArchive: jest.fn(),
    onDelete: jest.fn(),
    onPress: jest.fn(),
  };
  const view = render(rowElement(input, handlers, false, branch));
  return { ...view, handlers, ...handlers };
}

function rowElement(
  input: FollowedInboxRow,
  handlers: Handlers,
  largeText = false,
  branch?: string,
) {
  return <SessionRow branch={branch} largeText={largeText} row={input} {...handlers} />;
}

function row(input: Partial<FollowedInboxRow> = {}): FollowedInboxRow {
  const item = input.session ?? session();
  return {
    active: false,
    archived: false,
    attentionCount: 0,
    projectLabel: "Project",
    section: "recent",
    session: item,
    status: "ready",
    targetLocation: item.location,
    targetSessionID: item.id,
    ...input,
  };
}

function session(input: Partial<SessionInfo> = {}): SessionInfo {
  return {
    cost: 0,
    id: "ses_build",
    location: { directory: "/project" },
    projectID: "project-1",
    time: { created: 1, updated: now - 5 * 60_000 },
    title: "Build the app",
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
    ...input,
  } as SessionInfo;
}
