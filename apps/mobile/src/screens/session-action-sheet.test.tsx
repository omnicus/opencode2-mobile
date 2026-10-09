import { beforeEach, expect, jest, test } from "@jest/globals";
import type { SessionInfo } from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SessionActionSheet } from "./session-action-sheet";

const mockRename = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockRemove = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockArchive = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockCleanup = jest.fn<(...args: unknown[]) => Promise<void>>();
let mockRuntime = { connectionId: "first", status: "connected", restClient: {} };
jest.mock("@opencode2-mobile/opencode-adapter", () => ({
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
jest.mock("../state/use-session-archives", () => ({
  useSessionArchives: () => ({
    ids: [],
    loaded: true,
    busy: false,
    error: false,
    setArchived: (...args: unknown[]) => mockArchive(...args),
  }),
}));
const session = {
  id: "ses_one",
  title: "Original",
  location: { directory: "/workspace" },
} as SessionInfo;

beforeEach(() => {
  mockRuntime = { connectionId: "first", status: "connected", restClient: {} };
  mockRename.mockReset().mockResolvedValue(undefined);
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockArchive.mockReset().mockResolvedValue(undefined);
  mockCleanup.mockReset().mockResolvedValue(undefined);
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const onClose = jest.fn();
  const onDeleted = jest.fn();
  const content = () => (
    <QueryClientProvider client={client}>
      <SessionActionSheet
        connectionId="first"
        session={session}
        onClose={onClose}
        onDeleted={onDeleted}
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

test("archive stays device-local and never removes the remote session", async () => {
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(view.onClose).toHaveBeenCalled());
    expect(mockArchive).toHaveBeenCalledWith("ses_one", true);
    expect(mockRemove).not.toHaveBeenCalled();
  } finally {
    view.cleanup();
  }
});

test("deletion requires confirmation and cleans up descendants after server success", async () => {
  const view = mount();
  try {
    fireEvent.press(screen.getByRole("button", { name: "Delete" }));
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Confirm delete" }));
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
    for (const name of ["Rename", "Archive", "Delete"])
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
    fireEvent.press(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private server detail");
    expect(mockCleanup).not.toHaveBeenCalled();
    expect(view.onDeleted).not.toHaveBeenCalled();
  } finally {
    view.cleanup();
  }
});
