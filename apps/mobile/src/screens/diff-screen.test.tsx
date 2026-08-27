import { beforeEach, expect, jest, test } from "@jest/globals";
import type { FileDiffInfo } from "@opencode2-mobile/opencode-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react-native";

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
  expect(
    screen.getByText(
      "Current working tree. This may include changes made after the selected tool call.",
    ),
  ).toBeOnTheScreen();
  expect(screen.getByText("+new value")).toHaveStyle({ backgroundColor: "#18230E" });
  expect(screen.getByText("-old value")).toHaveStyle({ backgroundColor: "#2A1714" });
  expect(mockGetDiff).toHaveBeenCalledWith(
    {},
    { directory: "/workspace" },
    "working",
    expect.objectContaining({ context: 5 }),
  );
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
