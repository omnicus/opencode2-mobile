import { beforeEach, expect, jest, test } from "@jest/globals";
import type { SessionInfo } from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { Alert, Modal, Platform } from "react-native";
import { SessionActionSheet } from "./session-action-sheet";

jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => undefined) }));

const mockRename = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockRemove = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockCleanup = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockArchive = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockMcpList = jest.fn(async () => ({ data: [] }));
jest.mock("./app-shell", () => {
  const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ActionButton: ({
      label,
      onPress,
      disabled,
    }: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
      >
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});
let mockRuntime = { connectionId: "first", status: "connected", restClient: {} };
jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  listOpenCodeMcpServers: () => mockMcpList(),
  renameOpenCodeSession: (...args: unknown[]) => mockRename(...args),
  removeOpenCodeSession: (...args: unknown[]) => mockRemove(...args),
}));
jest.mock("./session-deletion", () => ({
  loadOpenCodeSessionTreeIds: async () => ["ses_one", "ses_child"],
}));
jest.mock("../storage/prompt-admission-repository", () => ({
  deleteSessionLocalState: (...args: unknown[]) => mockCleanup(...args),
}));
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => ({}) }));
jest.mock("../state/connection-runtime-context", () => ({
  useConnectionRuntime: () => mockRuntime,
}));
jest.mock("../state/workspace-selection-context", () => ({
  useWorkspaceSelection: () => ({
    archiveSession: mockArchive,
    projects: [{ canonical: "/workspace", id: "project-1", name: "Orbit" }],
  }),
}));
jest.mock("../connections/connections-context", () => ({
  useConnections: () => ({ profiles: [{ id: "first", name: "Studio Mac" }] }),
}));
const session = {
  id: "ses_one",
  projectID: "project-1",
  title: "Original",
  location: { directory: "/workspace" },
  time: { created: 1, updated: 1 },
} as SessionInfo;

beforeEach(() => {
  mockRuntime = { connectionId: "first", status: "connected", restClient: {} };
  mockRename.mockReset().mockResolvedValue(undefined);
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockCleanup.mockReset().mockResolvedValue(undefined);
  mockArchive.mockReset().mockResolvedValue(undefined);
  mockMcpList.mockClear();
});

function mount(
  target: SessionInfo = session,
  props: Partial<Parameters<typeof SessionActionSheet>[0]> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const onClose = jest.fn();
  const onDeleted = jest.fn();
  const content = () => (
    <QueryClientProvider client={client}>
      <SessionActionSheet
        connectionId="first"
        session={target}
        onClose={onClose}
        onDeleted={onDeleted}
        {...props}
      />
    </QueryClientProvider>
  );
  const view = render(content());
  return {
    ...view,
    content,
    onClose,
    onDeleted,
    cleanup() {
      view.unmount();
      client.clear();
    },
  };
}

test("renames through the adapter and closes only after confirmation", async () => {
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    fireEvent.changeText(screen.getByLabelText("Session name"), " New title ");
    fireEvent.press(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    expect(mockRename).toHaveBeenCalledWith(
      {},
      "ses_one",
      "New title",
      expect.objectContaining({ signal: expect.anything() }),
    );
  } finally {
    view.cleanup();
  }
});

test("the keyboard Done key saves the name, but not an unchanged one", async () => {
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Session name");
    expect(input.props).toMatchObject({ keyboardAppearance: "dark", returnKeyType: "done" });
    fireEvent(input, "submitEditing");
    expect(mockRename).not.toHaveBeenCalled();
    fireEvent.changeText(input, "Typed title");
    fireEvent(input, "submitEditing");
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    expect(mockRename).toHaveBeenCalledWith(
      {},
      "ses_one",
      "Typed title",
      expect.objectContaining({ signal: expect.anything() }),
    );
  } finally {
    view.cleanup();
  }
});

test("MCP servers open within the session menu without another overflow button", async () => {
  const view = mount();
  try {
    expect(mockMcpList).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "MCP servers" }));
    expect(screen.getByRole("header", { name: "MCP servers" })).toBeOnTheScreen();
    expect(
      await screen.findByText("No MCP servers configured for this location."),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Location options" })).toBeNull();
    expect(screen.getByText(/Changes affect all sessions at this location/)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Back to session actions" }));
    expect(screen.getByRole("button", { name: "Rename" })).toBeOnTheScreen();
  } finally {
    view.cleanup();
  }
});

test("Android back steps from a page to the menu, then closes", () => {
  const platform = jest.replaceProperty(Platform, "OS", "android");
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    fireEvent.changeText(screen.getByLabelText("Session name"), "Abandoned");
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(screen.getByRole("header", { name: "Session actions" })).toBeOnTheScreen();
    expect(view.onClose).not.toHaveBeenCalled();
    // An abandoned rename does not come back when the page reopens.
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByLabelText("Session name").props.value).toBe("Original");
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(view.onClose).toHaveBeenCalledTimes(1);
  } finally {
    view.cleanup();
    platform.restore();
  }
});

test("an iOS swipe that dismissed a page closes the whole sheet", () => {
  const platform = jest.replaceProperty(Platform, "OS", "ios");
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(view.onClose).toHaveBeenCalledTimes(1);
  } finally {
    view.cleanup();
    platform.restore();
  }
});

test("summarizes the session above the actions", () => {
  const view = mount({
    ...session,
    agent: "build",
    model: { id: "claude-opus-5", providerID: "anthropic" },
    time: { created: Date.now(), updated: Date.now() },
  } as SessionInfo);
  try {
    expect(screen.getByText("build · claude-opus-5 · Updated just now")).toBeOnTheScreen();
  } finally {
    view.cleanup();
  }
});

test("offers the parent session only to a subagent session with a handler", () => {
  const onOpenParent = jest.fn();
  const first = mount(session, { onOpenParent });
  try {
    expect(screen.queryByRole("button", { name: "Open parent session" })).toBeNull();
  } finally {
    first.cleanup();
  }
  const child = { ...session, parentID: "ses_parent" } as SessionInfo;
  const second = mount(child, { onOpenParent });
  try {
    fireEvent.press(screen.getByRole("button", { name: "Open parent session" }));
    expect(onOpenParent).toHaveBeenCalledTimes(1);
  } finally {
    second.cleanup();
  }
  const third = mount(child);
  try {
    expect(screen.queryByRole("button", { name: "Open parent session" })).toBeNull();
  } finally {
    third.cleanup();
  }
  mockRuntime.status = "offline";
  const offline = mount(child, { onOpenParent });
  try {
    expect(screen.getByRole("button", { name: "Open parent session" })).toBeDisabled();
  } finally {
    offline.cleanup();
  }
});

test("a confirmed archive leaves without waiting for the refetch", async () => {
  // A refetch that never settles must not hold the navigation back.
  const invalidate = jest
    .spyOn(QueryClient.prototype, "invalidateQueries")
    .mockReturnValue(new Promise<void>(() => undefined));
  const onArchived = jest.fn();
  const view = mount(session, { onArchived });
  try {
    fireEvent.press(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(onArchived).toHaveBeenCalledWith(true));
    expect(invalidate).toHaveBeenCalled();
  } finally {
    invalidate.mockRestore();
    view.cleanup();
  }
});

test("failed rename retains the entered name and does not close", async () => {
  mockRename.mockRejectedValue(new Error("private error"));
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    fireEvent.changeText(screen.getByLabelText("Session name"), "Keep this");
    fireEvent.press(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private error");
    expect(view.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Session name").props.value).toBe("Keep this");
  } finally {
    view.cleanup();
  }
});

test("the menu offers rename, archive, MCP servers and delete", () => {
  const view = mount();
  try {
    for (const name of ["Rename", "Archive", "MCP servers", "Delete"])
      expect(screen.getByRole("button", { name })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Unarchive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dev tools" })).toBeNull();
  } finally {
    view.cleanup();
  }
});

test("archives on the server and closes once it succeeds", async () => {
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(view.onClose).toHaveBeenCalled());
    expect(mockArchive).toHaveBeenCalledWith(session, true);
    expect(Haptics.selectionAsync).toHaveBeenCalled();
  } finally {
    view.cleanup();
  }
});

test("hands a confirmed archive to the caller instead of closing", async () => {
  const onArchived = jest.fn();
  const view = mount(session, { onArchived });
  try {
    fireEvent.press(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(onArchived).toHaveBeenCalledWith(true));
    expect(view.onClose).not.toHaveBeenCalled();
  } finally {
    view.cleanup();
  }
});

test("an archived session offers Unarchive, and a failure keeps the sheet open", async () => {
  mockArchive.mockRejectedValueOnce(new Error("offline"));
  const archived = { ...session, time: { ...session.time, archived: 5 } } as SessionInfo;
  const view = mount(archived);
  try {
    fireEvent.press(screen.getByRole("button", { name: "Unarchive" }));
    expect(
      await screen.findByText(
        "Could not confirm the change. Refresh the session before trying again.",
      ),
    ).toBeOnTheScreen();
    expect(mockArchive).toHaveBeenCalledWith(archived, false);
    expect(view.onClose).not.toHaveBeenCalled();
  } finally {
    view.cleanup();
  }
});

test("deletion requires confirmation and cleans up descendants after server success", async () => {
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Delete" }));
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Delete session" }));
    await waitFor(() => expect(view.onDeleted).toHaveBeenCalled());
    expect(mockRemove).toHaveBeenCalledWith({}, "ses_one", expect.anything());
    expect(mockCleanup).toHaveBeenCalledWith({}, "first", ["ses_one", "ses_child"]);
  } finally {
    view.cleanup();
  }
});

test("a switched connection disables remote and local actions", () => {
  mockRuntime.connectionId = "other";
  const view = mount();
  try {
    for (const name of ["Rename", "Delete", "MCP servers"])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    fireEvent.press(screen.getByRole("button", { name: "Delete" }));
    expect(mockRemove).not.toHaveBeenCalled();
  } finally {
    view.cleanup();
  }
});

test("failed deletion retains the session and never removes local state", async () => {
  mockRemove.mockRejectedValue(new Error("private server detail"));
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Delete" }));
    fireEvent.press(screen.getByRole("button", { name: "Delete session" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private server detail");
    expect(mockCleanup).not.toHaveBeenCalled();
    expect(view.onDeleted).not.toHaveBeenCalled();
  } finally {
    view.cleanup();
  }
});

test("titles each page and returns to the menu", () => {
  const view = mount();
  try {
    expect(screen.getByRole("header", { name: "Session actions" })).toBeOnTheScreen();
    expect(screen.getByText("Original")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("header", { name: "Delete session?" })).toBeOnTheScreen();
    expect(screen.getByText("Cancel")).toBeOnTheScreen();
    expect(screen.getByText(/any subagent sessions it started/)).toBeOnTheScreen();
    // The confirmation names the whole target before the destructive action.
    expect(screen.getByText("Server: Studio Mac")).toBeOnTheScreen();
    expect(screen.getByText("Project: Orbit")).toBeOnTheScreen();
    expect(screen.getByText("/workspace")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Back to session actions" }));
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("header", { name: "Rename session" })).toBeOnTheScreen();
    expect(screen.getByText("Cancel")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    fireEvent.changeText(screen.getByLabelText("Session name"), "  ");
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    fireEvent.press(screen.getByRole("button", { name: "Close Rename session" }));
    expect(view.onClose).toHaveBeenCalledTimes(1);
  } finally {
    view.cleanup();
  }
});

test("names an untitled session and renames it", async () => {
  const view = mount({ ...session, title: "" } as SessionInfo);
  try {
    expect(screen.getByText("Untitled session")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByLabelText("Session name").props.value).toBe("");
    fireEvent.changeText(screen.getByLabelText("Session name"), "Named");
    fireEvent.press(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    expect(mockRename).toHaveBeenCalledWith({}, "ses_one", "Named", expect.anything());
  } finally {
    view.cleanup();
  }
});

test("an offline connection blocks remote actions and says why", () => {
  mockRuntime.status = "offline";
  const view = mount();
  try {
    for (const name of ["Rename", "Archive", "MCP servers", "Delete"])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByText("Reconnect to the server to use these actions.")).toBeOnTheScreen();
  } finally {
    view.cleanup();
  }
});

test("a connected menu shows no reconnect notice", () => {
  const view = mount();
  try {
    expect(screen.queryByText(/Reconnect to the server/)).toBeNull();
  } finally {
    view.cleanup();
  }
});

test("reports incomplete local cleanup after the server deletes the session", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  mockCleanup.mockRejectedValue(new Error("locked"));
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Delete" }));
    fireEvent.press(screen.getByRole("button", { name: "Delete session" }));
    await waitFor(() => expect(view.onDeleted).toHaveBeenCalled());
    expect(alert).toHaveBeenCalledWith("Local cleanup incomplete", expect.any(String));
    expect(view.onClose).not.toHaveBeenCalled();
  } finally {
    alert.mockRestore();
    view.cleanup();
  }
});

test("keeps the sheet open while a change is in flight", async () => {
  let finish: (() => void) | undefined;
  mockRename.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    fireEvent.changeText(screen.getByLabelText("Session name"), "Next");
    fireEvent.press(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Back to session actions" })).toBeDisabled();
    fireEvent.press(screen.getByRole("button", { name: "Close Rename session" }));
    fireEvent.press(screen.getByRole("button", { name: "Saving" }));
    fireEvent(screen.getByLabelText("Session name"), "submitEditing");
    expect(view.onClose).not.toHaveBeenCalled();
    expect(mockRename).toHaveBeenCalledTimes(1);
    await act(async () => finish?.());
    expect(view.onClose).toHaveBeenCalledTimes(1);
  } finally {
    view.cleanup();
  }
});

test("switching connections aborts an in-flight change without closing", async () => {
  let finish: (() => void) | undefined;
  mockRename.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Rename" }));
    fireEvent.changeText(screen.getByLabelText("Session name"), "Next");
    fireEvent.press(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(mockRename).toHaveBeenCalledTimes(1));
    const options = mockRename.mock.calls[0]?.[3] as { signal: AbortSignal };
    mockRuntime = { ...mockRuntime, connectionId: "other" };
    view.rerender(view.content());
    expect(options.signal.aborted).toBe(true);
    await act(async () => finish?.());
    expect(view.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to session actions" })).toBeEnabled();
  } finally {
    view.cleanup();
  }
});

test("closing the sheet aborts a deletion before the server removes anything", async () => {
  const deletion = jest.requireMock<{ loadOpenCodeSessionTreeIds: () => Promise<string[]> }>(
    "./session-deletion",
  );
  let finish: ((ids: string[]) => void) | undefined;
  const load = jest.spyOn(deletion, "loadOpenCodeSessionTreeIds").mockImplementation(
    () =>
      new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Delete" }));
    fireEvent.press(screen.getByRole("button", { name: "Delete session" }));
    await waitFor(() => expect(load).toHaveBeenCalled());
    view.unmount();
    await act(async () => finish?.(["ses_one"]));
    expect(mockRemove).not.toHaveBeenCalled();
    expect(view.onDeleted).not.toHaveBeenCalled();
  } finally {
    load.mockRestore();
    view.cleanup();
  }
});
