import { beforeEach, expect, jest, test } from "@jest/globals";
import type { FileDiffInfo } from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { diffPalette } from "../theme";
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
let mockRuntime = {
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
      "Current working tree. This may include changes made after the selected tool call.",
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
  fireEvent.press(screen.getByRole("button", { name: "Collapse all" }));
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
