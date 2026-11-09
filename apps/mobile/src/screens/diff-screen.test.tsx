import { beforeEach, expect, jest, test } from "@jest/globals";
import type { FileDiffInfo } from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { diffPalette, palette } from "../theme";
import { buildDiffRows, DiffScreen } from "./diff-screen";

const mockGetDiff =
  jest.fn<
    (
      client: unknown,
      location: unknown,
      mode: unknown,
      options: unknown,
    ) => Promise<{ data: FileDiffInfo[] }>
  >();
let mockRuntime: { connectionId: string; restClient?: object } = {
  connectionId: "connection-1",
  restClient: {},
};

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  getOpenCodeVcsDiff: (client: unknown, location: unknown, mode: unknown, options: unknown) =>
    mockGetDiff(client, location, mode, options),
}));
jest.mock("../state/connection-runtime-context", () => ({
  useConnectionRuntime: () => mockRuntime,
}));

beforeEach(() => {
  mockGetDiff.mockReset();
  mockRuntime = { connectionId: "connection-1", restClient: {} };
});

test("renders an authoritative working-tree diff", async () => {
  mockGetDiff.mockResolvedValue({
    data: [
      {
        additions: 1,
        deletions: 1,
        file: "src/app.ts",
        patch: "@@ -1 +1 @@\n-old value\n+new value",
        status: "modified",
      },
    ],
  });

  renderDiffScreen();

  expect(await screen.findByText("src/app.ts")).toBeOnTheScreen();
  expect(screen.queryByText("+new value")).toBeNull();
  fireEvent.press(
    screen.getByRole("button", { name: "modified file, src/app.ts, 1 additions, 1 deletions" }),
  );
  expect(
    screen.getByText(
      "Uncommitted changes in the working tree right now, including edits made after any tool call.",
    ),
  ).toBeOnTheScreen();
  expect(screen.getByText("+new value")).toHaveStyle({
    backgroundColor: diffPalette.addedBackground,
    color: diffPalette.addedText,
  });
  expect(screen.getByText("-old value")).toHaveStyle({
    backgroundColor: diffPalette.removedBackground,
    color: diffPalette.removedText,
  });
  expect(mockGetDiff).toHaveBeenCalledWith(
    {},
    { directory: "/workspace" },
    "working",
    expect.objectContaining({ context: 5 }),
  );
  expect(screen.getByLabelText("Focused file diff")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Close File changes" }));
  expect(screen.queryByText("+new value")).toBeNull();
});

test("keeps later file headers reachable even when an expanded patch hits the line bound", () => {
  const files: FileDiffInfo[] = [
    {
      file: "large.ts",
      status: "modified",
      additions: 20001,
      deletions: 0,
      patch: "+line\n".repeat(20001),
    },
    { file: "later.ts", status: "added", additions: 1, deletions: 0, patch: "+later" },
  ];
  const rows = buildDiffRows(files, new Set(["large.ts"]));
  expect(rows).toContainEqual(expect.objectContaining({ type: "file", file: "later.ts" }));
  expect(rows).toContainEqual(expect.objectContaining({ key: "line:omitted" }));
  expect(buildDiffRows(files, new Set())).toHaveLength(2);
});

test("offers bounded expand all and keeps unavailable patches explicit", async () => {
  mockGetDiff.mockResolvedValue({
    data: [
      { file: "new.ts", status: "added", additions: 1, deletions: 0, patch: "+new" },
      { file: "image.png", status: "modified", additions: 0, deletions: 0, patch: "" },
    ],
  });
  renderDiffScreen();
  fireEvent.press(await screen.findByRole("button", { name: "Expand all" }));
  expect(screen.getByText("+new")).toBeOnTheScreen();
  expect(screen.getByText("Diff unavailable for this file.")).toBeOnTheScreen();
});

test("opening a file keeps the other files expanded and offers its patch to copy", async () => {
  mockGetDiff.mockResolvedValue({
    data: [
      { file: "one.ts", status: "added", additions: 1, deletions: 0, patch: "+one" },
      { file: "two.ts", status: "added", additions: 1, deletions: 0, patch: "+two" },
    ],
  });
  renderDiffScreen();
  fireEvent.press(await screen.findByRole("button", { name: "Expand all" }));
  const header = screen.getByRole("button", {
    name: "added file, one.ts, 1 additions, 0 deletions",
  });
  expect(header.props.accessibilityHint).toBe("Opens the changes for this file");
  expect(header.props.accessibilityState?.expanded).toBeUndefined();
  fireEvent.press(header);
  expect(screen.getByRole("button", { name: "Copy patch" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Close File changes" }));
  expect(screen.getByText("+one")).toBeOnTheScreen();
  expect(screen.getByText("+two")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Collapse all" })).toBeOnTheScreen();
});

test("pull to refresh is styled for the dark theme on Android", async () => {
  mockGetDiff.mockResolvedValue({
    data: [{ file: "one.ts", status: "added", additions: 1, deletions: 0, patch: "+one" }],
  });
  renderDiffScreen();
  await screen.findByText("one.ts");
  const list = screen.getByLabelText("Current working tree changes");
  const refresh = list.props.refreshControl;
  expect(refresh.props.colors).toEqual([palette.signal]);
  expect(refresh.props.progressBackgroundColor).toBe(palette.card);
});

test("shows empty and mismatched-connection states", async () => {
  mockGetDiff.mockResolvedValue({ data: [] });
  const view = renderDiffScreen();
  expect(await screen.findByText("No changes")).toBeOnTheScreen();

  mockRuntime = { connectionId: "connection-2", restClient: {} };
  view.rerender(diffElement());
  expect(await screen.findByText("Connection unavailable")).toBeOnTheScreen();
});

test("classifies unified diff lines without retaining unbounded line content", () => {
  const files: FileDiffInfo[] = [
    {
      additions: 1,
      deletions: 1,
      file: "src/app.ts",
      patch: `--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-${"a".repeat(5_000)}\n+new`,
      status: "modified",
    },
  ];

  const rows = buildDiffRows(files);
  expect(rows[0]).toMatchObject({ file: "src/app.ts", type: "file" });
  expect(rows).toContainEqual(expect.objectContaining({ kind: "hunk", type: "line" }));
  expect(rows).toContainEqual(expect.objectContaining({ kind: "addition", text: "+new" }));
  const deletion = rows.find((row) => row.type === "line" && row.kind === "deletion") as Extract<
    (typeof rows)[number],
    { type: "line" }
  >;
  expect(deletion.text).toHaveLength(4_000);
});

test("waits for the matching client before loading changes", () => {
  mockRuntime = { connectionId: "connection-1" };
  renderDiffScreen();
  expect(screen.getByLabelText("Loading current changes")).toBeOnTheScreen();
  expect(mockGetDiff).not.toHaveBeenCalled();
});

test("offers a retry when the first load fails", async () => {
  mockGetDiff.mockRejectedValueOnce(new Error("offline"));
  renderDiffScreen();
  expect(await screen.findByText("Changes unavailable")).toBeOnTheScreen();
  expect(screen.getByText("The current working-tree diff could not be loaded.")).toBeOnTheScreen();

  mockGetDiff.mockResolvedValue({
    data: [{ file: "a.ts", status: "added", additions: 1, deletions: 0, patch: "+a" }],
  });
  fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("1 file")).toBeOnTheScreen();
  expect(mockGetDiff).toHaveBeenCalledTimes(2);
});

test("keeps loaded changes on screen when a refresh fails", async () => {
  mockGetDiff.mockResolvedValueOnce({
    data: [
      { file: "a.ts", status: "modified", additions: 2, deletions: 1, patch: "+a\n+b\n-c" },
      { file: "b.ts", status: "modified", additions: 1, deletions: 3, patch: "-a\n-b\n-c\n+d" },
    ],
  });
  renderDiffScreen();
  expect(await screen.findByText("2 files")).toBeOnTheScreen();
  expect(screen.getByText("+3")).toBeOnTheScreen();
  expect(screen.getByText("-4")).toBeOnTheScreen();

  mockGetDiff.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    screen.getByLabelText("Current working tree changes").props.refreshControl.props.onRefresh();
  });
  expect(await screen.findByText("Refresh failed")).toBeOnTheScreen();
  expect(screen.getByText("Showing the last loaded changes.")).toBeOnTheScreen();
  expect(screen.getByText("a.ts")).toBeOnTheScreen();

  mockGetDiff.mockResolvedValueOnce({
    data: [{ file: "a.ts", status: "added", additions: 2, deletions: 0, patch: "+a\n+b" }],
  });
  fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("1 file")).toBeOnTheScreen();
  expect(screen.queryByText("Refresh failed")).toBeNull();
});

test("collapses expanded files and focuses one file with its own totals", async () => {
  mockGetDiff.mockResolvedValue({
    data: [
      {
        file: "src/app.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n context\n-old\n+new",
      },
      { file: "docs/readme.md", status: "added", additions: 4, deletions: 0, patch: "+doc" },
    ],
  });
  renderDiffScreen();
  fireEvent.press(await screen.findByRole("button", { name: "Expand all" }));
  expect(screen.getByLabelText("Context line:  context")).toBeOnTheScreen();
  expect(screen.getByLabelText("Diff hunk: @@ -1 +1 @@")).toBeOnTheScreen();
  expect(
    screen.getByLabelText("Diff information: diff --git a/src/app.ts b/src/app.ts"),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText("Added line: +doc")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Collapse all" }));
  expect(screen.queryByText("+doc")).toBeNull();
  expect(screen.getByRole("button", { name: "Expand all" })).toBeOnTheScreen();

  fireEvent.press(
    screen.getByRole("button", { name: "added file, docs/readme.md, 4 additions, 0 deletions" }),
  );
  expect(screen.getAllByText("docs/readme.md")).toHaveLength(2);
  expect(screen.getByText(/· Added/)).toBeOnTheScreen();
  expect(screen.getByLabelText("Added line: +doc")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Removed line: -old")).toBeNull();
});

function renderDiffScreen() {
  return render(diffElement());
}

function diffElement() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <DiffScreen
        navigation={{} as never}
        route={{
          key: "diff",
          name: "Diff",
          params: {
            connectionId: "connection-1",
            location: { directory: "/workspace" },
            mode: "working",
          },
        }}
      />
    </QueryClientProvider>
  );
}
