import { afterEach, expect, jest, test } from "@jest/globals";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Alert, Linking, View } from "react-native";

import { resetTranscriptPerformanceMetrics } from "../state/transcript-performance";
import { markdownPalette, palette, typography } from "../theme";
import {
  activityFailureSummary,
  activitySummary,
  buildTranscriptPresentation,
  groupTranscriptMessages,
  SessionTranscriptRow,
  TranscriptActivityGroup,
  TranscriptUpdatesGroup,
} from "./session-transcript";

afterEach(resetTranscriptPerformanceMetrics);

test("assistant prose uses the shared body typography and text color", async () => {
  const message = messages.find((item) => item.type === "assistant");
  if (!message) throw new Error("fixture");
  render(
    <SessionTranscriptRow
      message={{ ...message, content: [{ type: "text", text: "Themed response" }] }}
    />,
  );
  let text = screen.getByText("Themed response");
  while (!text.props.selectable && text.parent) text = text.parent;
  expect(text).toHaveStyle({
    ...typography.chatBody,
    color: palette.ink,
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copy response" })).toBeOnTheScreen(),
  );
});

jest.mock("@opencode2-mobile/opencode-adapter", () => ({
  getOpenCodeShell: jest.fn(),
  getOpenCodeShellOutput: jest.fn(),
  isShellNotFoundError: jest.fn(() => false),
  maxShellOutputBytes: 64 * 1024,
}));

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

test("one response copy action combines prose parts without reasoning or model metadata", async () => {
  const message = messages.find((item) => item.type === "assistant");
  if (!message) throw new Error("fixture");
  render(
    <SessionTranscriptRow
      message={{
        ...message,
        content: [
          { type: "text", text: "First paragraph" },
          { type: "reasoning", text: "Private reasoning" },
          { type: "text", text: "Second paragraph" },
        ],
      }}
    />,
  );
  expect(screen.getAllByRole("button", { name: "Copy response" })).toHaveLength(1);
  fireEvent.press(screen.getByRole("button", { name: "Copy response" }));
  await waitFor(() =>
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(
      "First paragraph\n\nSecond paragraph",
    ),
  );
});

test("inline code preserves literal markup and does not create links inside code", () => {
  const message = messages.find((item) => item.type === "assistant");
  if (!message) throw new Error("fixture");
  render(
    <SessionTranscriptRow
      message={{
        ...message,
        content: [
          {
            type: "text",
            text: "Run `pnpm check`, keep `**literal**`, and inspect `https://code.test`. **Important**",
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("pnpm check")).toHaveStyle({
    color: palette.ink,
    fontFamily: "Menlo",
  });
  expect(screen.getByText("**literal**")).toBeOnTheScreen();
  expect(screen.queryByRole("link", { name: "https://code.test" })).toBeNull();
  expect(screen.getByText("Important")).toHaveStyle({ fontWeight: "700" });
});

test("message text supports native selection without separate copy or selection controls", () => {
  const message = messages.find((item) => item.type === "assistant");
  if (!message) throw new Error("fixture");
  const text = "First paragraph\n\nSecond paragraph";
  render(<SessionTranscriptRow message={{ ...message, content: [{ type: "text", text }] }} />);
  for (const paragraph of ["First paragraph", "Second paragraph"]) {
    let node = screen.getByText(paragraph);
    while (!node.props.selectable && node.parent) node = node.parent;
    expect(node.props.selectable).toBe(true);
  }
  expect(screen.queryByRole("button", { name: "Select text" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
});

test("nested activity reveals individual calls before their output", () => {
  const output = `${"shell output\n".repeat(4000)}last output line`;
  const original = messages.find((message) => message.type === "assistant");
  if (!original) throw new Error("fixture");
  const tool = original.content.find(
    (part) => part.type === "tool" && part.state.status === "completed",
  );
  if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("fixture");
  const message: SessionMessageInfo = {
    ...original,
    content: [
      {
        ...tool,
        name: "shell",
        state: {
          ...tool.state,
          input: { command: "echo nested", workdir: "/workspace", timeout: 5000 },
          content: [{ type: "text" as const, text: output }],
        },
      },
    ],
  };
  render(
    <TranscriptActivityGroup
      item={{
        type: "activity-group",
        id: "activity",
        messages: [message],
        count: 1,
        running: false,
      }}
      largeText={false}
      showReasoning
      onOpenDiff={jest.fn()}
      onOpenSubagent={jest.fn()}
    />,
  );
  expect(screen.queryByText(output)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "1 tool calls" }));
  expect(screen.queryByText(output)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: /Shell.*Show/ }));
  expect(screen.getByText(output)).toBeOnTheScreen();
  expect(screen.getAllByText("echo nested")).toHaveLength(1);
  expect(screen.getByText(/"workdir": "\/workspace"/)).toBeOnTheScreen();
  expect(screen.getByText(/"timeout": 5000/)).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  expect(screen.getByLabelText("Shell output")).toHaveStyle({ maxHeight: 240 });
  expect(screen.getByLabelText("Shell output").props.nestedScrollEnabled).toBe(true);
  expect(screen.getByRole("button", { name: "Copy shell output" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: /Shell.*Hide/ }));
  expect(screen.queryByText(output)).toBeNull();
});

test("activity summaries count operations rather than inventing file counts", () => {
  const message = messages.find((item) => item.type === "assistant");
  if (!message) throw new Error("fixture");
  const tool = message.content.find((part) => part.type === "tool");
  if (!tool) throw new Error("fixture");
  expect(
    activitySummary([
      {
        ...message,
        content: ["glob", "grep", "shell", "patch"].map((name, index) => ({
          ...tool,
          name,
          id: `tool_${index}`,
        })),
      },
    ]),
  ).toBe("Used 4 Glob, Grep, Shell, Patch");
});

test("collapsed failures distinguish interruptions without exposing server error text", () => {
  const original = messages.find((item) => item.type === "assistant");
  if (!original) throw new Error("fixture");
  const message: SessionMessageInfo = {
    ...original,
    content: ["Request aborted at /private/path", "secret failure detail"].map(
      (message, index) => ({
        type: "tool" as const,
        name: "shell",
        id: `tool_error_${index}`,
        time: { created: 1 },
        state: {
          status: "error" as const,
          input: {},
          metadata: {},
          error: { type: "ToolError", message },
        },
      }),
    ),
  };
  expect(activityFailureSummary([message])).toBe("1 failed · 1 interrupted");
  render(
    <TranscriptActivityGroup
      item={{
        type: "activity-group",
        id: "activity_errors",
        messages: [message],
        count: 2,
        running: false,
      }}
      largeText={false}
      showReasoning
      onOpenDiff={jest.fn()}
      onOpenSubagent={jest.fn()}
    />,
  );
  expect(screen.getByText("1 failed · 1 interrupted. Expand for details.")).toBeOnTheScreen();
  expect(screen.queryByText(/private\/path|secret failure detail/)).toBeNull();
});

test.each([
  [
    "execute",
    { code: "return await tools.browser.tabs.list();" },
    "return await tools.browser.tabs.list();",
  ],
  ["webfetch", { url: "https://example.test/docs" }, "https://example.test/docs"],
  ["websearch", { query: "native shell output" }, "native shell output"],
] satisfies [string, Record<string, string>, string][])(
  "collapsed %s tools show the same input preview as the web client",
  (name, input, preview) => {
    const original = messages.find((message) => message.type === "assistant");
    if (!original) throw new Error("fixture");
    render(
      <SessionTranscriptRow
        detailed
        message={{
          ...original,
          content: [
            {
              type: "tool",
              id: "tool_preview",
              name,
              time: { created: 1 },
              state: {
                status: "completed",
                input,
                content: [{ type: "text", text: "Tool result" }],
              },
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(preview)).toBeOnTheScreen();
    expect(screen.queryByText("Tool result")).toBeNull();
  },
);

test("cross-message grouping respects replies, errors, reasoning visibility and detailed mode", () => {
  const original = messages.find((message) => message.type === "assistant");
  if (!original) throw new Error("fixture");
  const tool = original.content.find(
    (part) => part.type === "tool" && part.state.status === "completed",
  );
  if (!tool) throw new Error("fixture");
  const first = { ...original, retry: undefined, content: [tool] };
  // Remove the retry field so this fixture represents a normal successful execution.
  const { retry: _retry, ...clean } = first;
  const second = { ...clean, id: "msg_second" };
  const reasoning = {
    ...clean,
    id: "msg_reasoning",
    content: [{ type: "reasoning" as const, text: "Thinking" }],
  };
  const reply = { ...clean, id: "msg_reply", content: [{ type: "text" as const, text: "Reply" }] };
  expect(groupTranscriptMessages([clean, reasoning, second], false, false)).toMatchObject([
    { type: "activity-group", count: 2 },
  ]);
  expect(groupTranscriptMessages([clean, reasoning, second], false, true)).toMatchObject([
    { type: "activity-group", count: 2, messages: [clean, reasoning, second] },
  ]);
  expect(groupTranscriptMessages([clean, reply, second], false, false)).toHaveLength(3);
  expect(groupTranscriptMessages([clean, second], true, false)).toEqual([clean, second]);
  const mixed = { ...clean, content: [{ type: "text" as const, text: "Progress" }, tool] };
  expect(groupTranscriptMessages([mixed, second], false, true)).toMatchObject([
    { type: "assistant", content: [{ type: "text", text: "Progress" }] },
    { type: "activity-group", count: 2 },
  ]);
  const failed = { ...second, error: { type: "ToolError", message: "Failed" } };
  expect(groupTranscriptMessages([clean, failed], false, false)).toMatchObject([
    { type: "activity-group", count: 1 },
    failed,
  ]);
});

test("reasoning can be hidden without hiding replies or tool failures", () => {
  const message = messages.find((item) => item.type === "assistant");
  if (!message) throw new Error("fixture");
  const view = render(<SessionTranscriptRow message={message} showReasoning={false} />);
  expect(screen.getByText("Answer")).toBeOnTheScreen();
  expect(screen.getByText("tool failed")).toBeOnTheScreen();
  expect(screen.queryByText("Reasoning detail")).toBeNull();
  view.rerender(<SessionTranscriptRow message={message} showReasoning />);
  expect(screen.getByText("Reasoning detail")).toBeOnTheScreen();
});

test("newest-first pages keep six calls before commentary and five after it", () => {
  const original = messages.find((message) => message.type === "assistant");
  if (!original) throw new Error("fixture");
  const tool = original.content.find((part) => part.type === "tool");
  if (!tool) throw new Error("fixture");
  const { retry: _retry, ...assistant } = original;
  const calls = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => ({
      ...tool,
      id: `${prefix}-${index}`,
      name: index % 2 ? "grep" : "read",
    }));
  const older = { ...assistant, id: "older", content: calls(6, "before") };
  const mixed = {
    ...assistant,
    id: "mixed",
    content: [{ type: "text" as const, text: "Progress commentary" }, ...calls(5, "after")],
  };
  const presentation = buildTranscriptPresentation([mixed, older], false, true);
  expect([...presentation.items].reverse()).toMatchObject([
    { type: "activity-group", count: 6 },
    { type: "assistant", content: [{ type: "text", text: "Progress commentary" }] },
    { type: "activity-group", count: 5 },
  ]);
  const newer = { ...assistant, id: "newer", content: calls(1, "new") };
  const streamed = buildTranscriptPresentation([newer, mixed, older], false, true);
  expect(streamed.items[0]).toMatchObject({ id: presentation.items[0]?.id, count: 6 });
  expect(
    presentation.items[0]?.type === "activity-group" &&
      presentation.items[0].messages.flatMap((message) =>
        message.type === "assistant"
          ? message.content.map((part) => (part.type === "tool" ? part.id : ""))
          : [],
      ),
  ).toEqual(["after-0", "after-1", "after-2", "after-3", "after-4"]);
});

test("updates remain inspectable and successful idle rows do not divide a turn footer", () => {
  const original = messages.find((message) => message.type === "assistant");
  if (!original) throw new Error("fixture");
  const { retry: _retry, ...assistant } = original;
  const user: SessionMessageInfo = {
    type: "user",
    id: "start",
    text: "Prompt",
    time: { created: 0 },
  };
  const first = {
    ...assistant,
    id: "first",
    content: [{ type: "text" as const, text: "Publishing" }],
    time: { created: 1000, completed: 5000 },
  };
  const idle: SessionMessageInfo = {
    type: "idle",
    id: "idle",
    outcome: "succeeded",
    time: { created: 5001 },
  };
  const update: SessionMessageInfo = {
    type: "synthetic",
    id: "update",
    description: "long background command",
    text: "Background result",
    time: { created: 6000 },
  };
  const last = {
    ...first,
    id: "last",
    content: [{ type: "text" as const, text: "Published" }],
    time: { created: 100000, completed: 113000 },
  };
  const result = buildTranscriptPresentation([last, update, idle, first, user], false, true);
  expect(result.items.map((item) => item.type)).toEqual([
    "assistant",
    "updates-group",
    "assistant",
    "user",
  ]);
  expect([...result.footers]).toEqual([["last", 113000]]);
  const group = result.items[1];
  if (group?.type !== "updates-group") throw new Error("expected updates");
  render(<TranscriptUpdatesGroup item={group} largeText={false} onOpenSubagent={jest.fn()} />);
  expect(screen.queryByText("long background command")).toBeNull();
  expect(screen.queryByText("Background result")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Updates Show" }));
  expect(screen.getByText("long background command")).toBeOnTheScreen();
  expect(screen.getByText("Background result")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Updates Hide" }));
  expect(screen.queryByText("Background result")).toBeNull();
  expect(
    buildTranscriptPresentation([last, first], false, true).footers.get("last"),
  ).toBeUndefined();
  expect(buildTranscriptPresentation([last, update, idle, first, user], true, true).items).toEqual([
    last,
    update,
    idle,
    first,
    user,
  ]);
});

test("turn footer timing resets at a user prompt and failed outcomes stay visible", () => {
  const original = messages.find((message) => message.type === "assistant");
  if (!original) throw new Error("fixture");
  const { retry: _retry, ...assistant } = original;
  const user: SessionMessageInfo = {
    type: "user",
    id: "user",
    text: "Prompt",
    time: { created: 0 },
  };
  const reply = {
    ...assistant,
    content: [{ type: "text" as const, text: "Reply" }],
    time: { created: 1000, completed: 2000 },
  };
  const failed: SessionMessageInfo = {
    type: "idle",
    id: "failed",
    outcome: "failed",
    time: { created: 2100 },
  };
  const second = { ...reply, id: "second", time: { created: 3000, completed: 8000 } };
  const result = buildTranscriptPresentation(
    [second, { ...user, id: "next", time: { created: 2500 } }, failed, reply, user],
    false,
    false,
  );
  expect([...result.footers]).toEqual([
    [reply.id, 2000],
    ["second", 5500],
  ]);
  expect(result.items).toContain(failed);
});

test("compact system notices expand and detailed mode shows their content", () => {
  const message = messages.find((item) => item.type === "synthetic");
  if (!message) throw new Error("fixture");
  const view = render(<SessionTranscriptRow message={message} />);
  expect(screen.queryByText("Generated")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: /Generated context/ }));
  expect(screen.getByText("Generated")).toBeOnTheScreen();
  view.rerender(<SessionTranscriptRow detailed message={message} />);
  expect(screen.getByText("Generated")).toBeOnTheScreen();
});

test("skill calls use the generated id or metadata name in a compact loaded label", () => {
  const original = messages.find((message) => message.type === "assistant");
  if (!original) throw new Error("fixture");
  const { retry: _retry, ...assistant } = original;
  const tool = {
    type: "tool" as const,
    id: "tool_skill",
    name: "skill",
    time: { created: 1 },
    state: {
      status: "completed" as const,
      input: { id: "native-ui" },
      content: [{ type: "text" as const, text: "Skill instructions" }] as [
        { type: "text"; text: string },
      ],
    },
  };
  const view = render(
    <SessionTranscriptRow detailed message={{ ...assistant, content: [tool] }} />,
  );
  expect(screen.getByText("Loaded native-ui skill")).toBeOnTheScreen();
  expect(screen.queryByText(/"id":/)).toBeNull();
  expect(screen.queryByText("Skill instructions")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Loaded native-ui skill" }));
  expect(screen.getByText("Skill instructions")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Loaded native-ui skill" }));
  expect(screen.queryByText("Skill instructions")).toBeNull();
  view.rerender(
    <SessionTranscriptRow
      detailed
      message={{
        ...assistant,
        content: [{ ...tool, state: { ...tool.state, metadata: { name: "Native UI" } } }],
      }}
    />,
  );
  expect(screen.getByText("Loaded Native UI skill")).toBeOnTheScreen();
  view.rerender(
    <SessionTranscriptRow
      detailed
      message={{
        ...assistant,
        content: [
          {
            ...tool,
            state: {
              status: "error",
              input: tool.state.input,
              error: { type: "ToolError", message: "Skill missing" },
            },
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("Skill missing")).toBeOnTheScreen();
});

test("detailed mode renders grouped tool executions individually", () => {
  const original = messages.find((item) => item.type === "assistant");
  if (original?.type !== "assistant") throw new Error("fixture");
  const tool = original.content.find(
    (part) => part.type === "tool" && part.state.status === "completed",
  );
  if (tool?.type !== "tool") throw new Error("fixture");
  const message = {
    ...original,
    content: [tool, { ...tool, id: "tool-second", name: "second-tool" }],
  };
  const view = render(<SessionTranscriptRow message={message} />);
  expect(screen.queryByText("Used Second-tool")).toBeNull();
  view.rerender(<SessionTranscriptRow detailed message={message} />);
  expect(screen.getByText("Used Second-tool")).toBeOnTheScreen();
});

test.each([
  { outcome: "succeeded", label: "Turn completed" },
  { outcome: "failed", label: "Turn failed" },
  { outcome: "interrupted", label: "Turn interrupted" },
] as const)("renders the idle outcome $outcome", ({ outcome, label }) => {
  render(
    <SessionTranscriptRow
      detailed
      message={{ id: "msg_idle", time: { created: 1 }, type: "idle", outcome }}
    />,
  );
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText("Unsupported message")).toBeNull();
});

const messages: SessionMessageInfo[] = [
  { agent: "build", id: "msg_agent", time: { created: 1 }, type: "agent-switched" },
  {
    id: "msg_model",
    model: { id: "model-1", providerID: "provider" },
    time: { created: 2 },
    type: "model-switched",
  },
  {
    id: "msg_location",
    location: { directory: "/workspace/repository" },
    time: { created: 3 },
    type: "location-switched",
  },
  {
    files: [{ data: "c2VjcmV0", mime: "text/plain", name: "note.txt", source: { type: "inline" } }],
    id: "msg_user",
    text: "Question",
    time: { created: 4 },
    type: "user",
  },
  { id: "msg_synthetic", text: "Generated", time: { created: 5 }, type: "synthetic" },
  { id: "msg_system", text: "System", time: { created: 6 }, type: "system" },
  {
    id: "msg_skill",
    name: "Review",
    skill: "review",
    text: "Skill text",
    time: { created: 7 },
    type: "skill",
  },
  {
    command: "pnpm test",
    id: "msg_shell",
    output: { cursor: 2, output: "shell output", size: 2, truncated: false },
    shellID: "shell-1",
    status: "exited",
    time: { created: 8 },
    type: "shell",
  },
  {
    agent: "build",
    content: [
      { text: "Answer", type: "text" },
      { text: "Reasoning detail", type: "reasoning" },
      {
        id: "tool-streaming",
        name: "streaming-tool",
        state: { input: "{", status: "streaming" },
        time: { created: 9 },
        type: "tool",
      },
      {
        id: "tool-running",
        name: "running-tool",
        state: { input: {}, metadata: {}, status: "running" },
        time: { created: 9 },
        type: "tool",
      },
      {
        id: "tool-completed",
        name: "completed-tool",
        state: { content: [{ text: "tool output", type: "text" }], input: {}, status: "completed" },
        time: { created: 9 },
        type: "tool",
      },
      {
        id: "tool-error",
        name: "error-tool",
        state: {
          error: { message: "tool failed", type: "ToolError" },
          input: {},
          status: "error",
        },
        time: { created: 9 },
        type: "tool",
      },
    ],
    id: "msg_assistant",
    model: { id: "model-1", providerID: "provider" },
    retry: { at: 10, attempt: 2, error: { message: "retry", type: "RetryError" } },
    time: { created: 9 },
    type: "assistant",
  },
  {
    id: "msg_compaction",
    reason: "auto",
    recent: "Recent context",
    status: "completed",
    summary: "Compaction summary",
    time: { created: 10 },
    type: "compaction",
  },
  {
    error: { message: "Compaction error", type: "CompactionError" },
    id: "msg_compaction_error",
    reason: "manual",
    status: "failed",
    time: { created: 11 },
    type: "compaction",
  },
];

test("renders every current message and tool state with large details collapsed", () => {
  render(
    <View>
      {messages.map((message) => (
        <SessionTranscriptRow detailed key={message.id} message={message} />
      ))}
    </View>,
  );

  expect(screen.getByText("Question")).toBeOnTheScreen();
  expect(screen.getByText("note.txt")).toBeOnTheScreen();
  expect(screen.getByText("Answer")).toBeOnTheScreen();
  expect(screen.getByText("streaming-tool")).toBeOnTheScreen();
  expect(screen.getByText("Preparing")).toBeOnTheScreen();
  expect(screen.getByText("running-tool")).toBeOnTheScreen();
  expect(screen.getByText("Running")).toBeOnTheScreen();
  expect(screen.getByText("Retry 2 scheduled")).toBeOnTheScreen();
  expect(screen.getByText("repository")).toBeOnTheScreen();
  expect(screen.getByText("Reasoning detail")).toBeOnTheScreen();
  expect(screen.queryByText("tool output")).toBeNull();
  expect(screen.queryByText("shell output")).toBeNull();
  expect(screen.queryByText("Compaction summary")).toBeNull();
  expect(screen.queryByText("c2VjcmV0")).toBeNull();

  fireEvent.press(screen.getByRole("button", { name: /Retry 2 scheduled/ }));
  fireEvent.press(screen.getByRole("button", { name: /completed-tool/i }));
  fireEvent.press(screen.getByRole("button", { name: /error-tool/ }));
  fireEvent.press(screen.getByRole("button", { name: /Ran/ }));
  fireEvent.press(screen.getByRole("button", { name: /Compaction \/ Completed/ }));

  expect(screen.getByText("retry")).toBeOnTheScreen();
  expect(screen.getByText("tool output")).toBeOnTheScreen();
  expect(screen.getByText("tool failed")).toBeOnTheScreen();
  expect(screen.getByText("shell output")).toBeOnTheScreen();
  expect(screen.getByText("Compaction summary")).toBeOnTheScreen();
});

test("reveals large text in bounded steps", () => {
  const text = `${"a".repeat(4_100)}tail`;
  render(
    <SessionTranscriptRow
      message={{ id: "msg_large", text, time: { created: 1 }, type: "user" }}
    />,
  );

  expect(screen.queryByText(/tail$/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Show more" }));
  expect(screen.getByText(/tail$/)).toBeOnTheScreen();
});

test("opens HTTP and HTTPS transcript URLs as confirmed external links", () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.find((button) => button.text === "Open")?.onPress?.(),
    );
  render(
    <View>
      <SessionTranscriptRow
        message={{
          id: "msg_links",
          text: "Read https://example.test/docs, then http://localhost:4096/status.",
          time: { created: 1 },
          type: "user",
        }}
      />
      <SessionTranscriptRow
        message={{
          agent: "build",
          content: [{ text: "See **https://assistant.test/guide**.", type: "text" }],
          id: "msg_assistant_link",
          model: { id: "model-1", providerID: "provider" },
          time: { created: 2 },
          type: "assistant",
        }}
      />
    </View>,
  );

  const secureLink = screen.getByRole("link", { name: "https://example.test/docs" });
  expect(secureLink).toHaveStyle({
    color: markdownPalette.linkText,
    textDecorationLine: "underline",
  });
  expect(screen.getByRole("link", { name: "http://localhost:4096/status" })).toBeOnTheScreen();
  expect(screen.getByRole("link", { name: "https://assistant.test/guide" })).toHaveStyle({
    fontWeight: "700",
  });

  fireEvent.press(secureLink);
  expect(alert).toHaveBeenCalledWith(
    "Open external link?",
    expect.stringContaining("opens example.test"),
    expect.any(Array),
  );
  expect(open).toHaveBeenCalledWith("https://example.test/docs");

  alert.mockRestore();
  open.mockRestore();
});

test("keeps URLs in fenced code blocks inert", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [{ text: "```text\nhttps://example.test/code\n```", type: "text" }],
        id: "msg_code_link",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("https://example.test/code")).toBeOnTheScreen();
  expect(screen.queryByRole("link")).toBeNull();
});

test("renders nested bold code and table cells without leaking Markdown markers", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        id: "msg_markdown_table",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
        content: [
          {
            type: "text",
            text: "Use **`IMAGE_TAG`** to select this image.\n\nIn short:\n\n| Change | Rebuild needed? |\n|---|---|\n| Test configuration | Yes, `make image` |\n| Runtime `ARGS` | **No** |",
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("Change")).toBeOnTheScreen();
  expect(screen.getByText("Rebuild needed?")).toBeOnTheScreen();
  expect(screen.getByText("IMAGE_TAG")).toHaveStyle({ fontWeight: "700" });
  expect(screen.queryByText(/\*\*/)).toBeNull();
  expect(screen.queryByText(/\|---/)).toBeNull();
});

test("shows the responding model display name and measured runtime in the footer", () => {
  render(
    <SessionTranscriptRow
      modelName="Model One"
      message={{
        agent: "plan",
        id: "msg_footer",
        model: { id: "model-1", providerID: "provider" },
        content: [{ type: "text", text: "Done." }],
        time: { created: 1000, completed: 29000 },
        type: "assistant",
      }}
    />,
  );
  expect(screen.getByText("Plan · Model One · 28s")).toHaveStyle(typography.caption);
});

test("renders fenced assistant code without markdown fence markers", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            text: "Verify afterward:\n\n```gdb\ninfo sharedlibrary\nx/16i $pc-32\n```\n\nThen inspect the stack.",
            type: "text",
          },
        ],
        id: "msg_code_block",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("Verify afterward:")).toBeOnTheScreen();
  expect(screen.getByText("GDB")).toBeOnTheScreen();
  expect(screen.getByText("info sharedlibrary\nx/16i $pc-32")).toBeOnTheScreen();
  expect(screen.getByText("Then inspect the stack.")).toBeOnTheScreen();
  expect(screen.queryByText(/```/)).toBeNull();
  expect(screen.getByLabelText("Code block, gdb")).toHaveStyle({
    backgroundColor: palette.card,
    borderWidth: 1,
  });
});

test("renders an unfinished code fence while assistant text streams", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [{ text: "```sh\npnpm test", type: "text" }],
        id: "msg_streaming_code_block",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("SH")).toBeOnTheScreen();
  expect(screen.getByText("pnpm test")).toBeOnTheScreen();
  expect(screen.queryByText(/```/)).toBeNull();
});

test("renders finished short reasoning inline with bold markdown", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            text: "**Adding mocks to repository tests**",
            time: { completed: 2, created: 1 },
            type: "reasoning",
          },
        ],
        id: "msg_inline_reasoning",
        model: { id: "model-1", providerID: "provider" },
        time: { completed: 2, created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("THOUGHT")).toBeOnTheScreen();
  expect(screen.queryByText("THINKING")).toBeNull();
  expect(screen.getByText("Adding mocks to repository tests")).toHaveStyle({ fontWeight: "700" });
  expect(screen.queryByText(/\*\*/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Thought/ })).toBeNull();
});

test("labels reasoning as thinking until the part completes", () => {
  const { rerender } = render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [{ text: "Checking the failing test", time: { created: 1 }, type: "reasoning" }],
        id: "msg_streaming_reasoning",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("THINKING")).toBeOnTheScreen();
  expect(screen.queryByText("THOUGHT")).toBeNull();

  rerender(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            text: "Checking the failing test",
            time: { completed: 2, created: 1 },
            type: "reasoning",
          },
        ],
        id: "msg_streaming_reasoning",
        model: { id: "model-1", providerID: "provider" },
        time: { completed: 2, created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("THOUGHT")).toBeOnTheScreen();
  expect(screen.queryByText("THINKING")).toBeNull();
});

test("settles reasoning when the message completes without a part completion time", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [{ text: "First step\nSecond step", time: { created: 1 }, type: "reasoning" }],
        id: "msg_settled_message_reasoning",
        model: { id: "model-1", providerID: "provider" },
        time: { completed: 2, created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.queryByRole("button", { name: /Thinking/ })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: /Thought/ }));
  expect(screen.getByText("First step\nSecond step")).toBeOnTheScreen();
});

test("keeps multiline reasoning in a disclosure", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            text: "First step\nSecond step",
            time: { completed: 2, created: 1 },
            type: "reasoning",
          },
        ],
        id: "msg_multiline_reasoning",
        model: { id: "model-1", providerID: "provider" },
        time: { completed: 2, created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.queryByText("First step\nSecond step")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: /Thought/ }));
  expect(screen.getByText("First step\nSecond step")).toBeOnTheScreen();
});

test("labels an exploration group as exploring while a search is in flight", () => {
  const { rerender } = render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            id: "tool-read",
            name: "read",
            state: {
              content: [{ text: "source", type: "text" }],
              input: { path: "src/a.ts" },
              status: "completed",
            },
            time: { completed: 1_400, created: 1_100 },
            type: "tool",
          },
          {
            id: "tool-grep",
            name: "grep",
            state: { input: { pattern: "TODO" }, metadata: {}, status: "running" },
            time: { created: 1_500 },
            type: "tool",
          },
        ],
        id: "msg_exploring",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1_000 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("Exploring")).toBeOnTheScreen();
  expect(screen.getByText("2 searches · Running")).toBeOnTheScreen();
  expect(screen.queryByText("Explored")).toBeNull();

  rerender(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            id: "tool-read",
            name: "read",
            state: {
              content: [{ text: "source", type: "text" }],
              input: { path: "src/a.ts" },
              status: "completed",
            },
            time: { completed: 1_400, created: 1_100 },
            type: "tool",
          },
          {
            id: "tool-grep",
            name: "grep",
            state: {
              content: [{ text: "match", type: "text" }],
              input: { pattern: "TODO" },
              status: "completed",
            },
            time: { completed: 1_700, created: 1_500 },
            type: "tool",
          },
        ],
        id: "msg_exploring",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1_000 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("Explored")).toBeOnTheScreen();
  expect(screen.getByText("2 searches")).toBeOnTheScreen();
  expect(screen.queryByText("Exploring")).toBeNull();
});

test("labels a shell message as running until it exits", () => {
  const { rerender } = render(
    <SessionTranscriptRow
      message={{
        command: "pnpm test",
        id: "msg_shell_running",
        output: { cursor: 1, output: "shell output", size: 2, truncated: false },
        shellID: "shell-2",
        status: "running",
        time: { created: 8 },
        type: "shell",
      }}
    />,
  );

  expect(screen.getByText("Running")).toBeOnTheScreen();
  expect(screen.getByText("pnpm test · Running")).toBeOnTheScreen();
  expect(screen.queryByText("Ran")).toBeNull();

  rerender(
    <SessionTranscriptRow
      message={{
        command: "pnpm test",
        id: "msg_shell_running",
        output: { cursor: 2, output: "shell output", size: 2, truncated: false },
        shellID: "shell-2",
        status: "exited",
        time: { created: 8 },
        type: "shell",
      }}
    />,
  );

  expect(screen.getByText("Ran")).toBeOnTheScreen();
  expect(screen.getByText("pnpm test")).toBeOnTheScreen();
  expect(screen.queryByText("Running")).toBeNull();
});

test("groups completed assistant activity and places narrative metadata in the footer", () => {
  const openDiff = jest.fn();
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            id: "tool-read",
            name: "read",
            state: {
              content: [{ text: "source", type: "text" }],
              input: { path: "src/a.ts" },
              status: "completed",
            },
            time: { completed: 1_500, created: 1_100 },
            type: "tool",
          },
          {
            id: "tool-grep",
            name: "grep",
            state: {
              content: [{ text: "match", type: "text" }],
              input: { pattern: "TODO" },
              status: "completed",
            },
            time: { completed: 1_700, created: 1_500 },
            type: "tool",
          },
          {
            id: "tool-patch",
            name: "patch",
            state: {
              content: [{ text: "Applied", type: "text" }],
              input: {
                patchText:
                  "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch",
              },
              status: "completed",
            },
            time: { completed: 2_200, created: 1_800 },
            type: "tool",
          },
          {
            id: "tool-shell",
            name: "shell",
            state: {
              content: [{ text: "Tests pass", type: "text" }],
              input: { command: "pnpm test" },
              status: "completed",
            },
            time: { completed: 2_900, created: 2_300 },
            type: "tool",
          },
          { text: "Tests pass.", type: "text" },
        ],
        id: "msg_grouped_activity",
        model: { id: "model-1", providerID: "provider" },
        time: { completed: 3_000, created: 1_000 },
        type: "assistant",
      }}
      onOpenDiff={openDiff}
    />,
  );

  expect(screen.getByText("Explored")).toBeOnTheScreen();
  expect(screen.getByText("2 searches")).toBeOnTheScreen();
  expect(screen.queryByText("Read")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: /Explored/ }));
  expect(screen.getByText("Read")).toBeOnTheScreen();
  expect(screen.getByText("Grep")).toBeOnTheScreen();

  expect(screen.getByText("Edited")).toBeOnTheScreen();
  expect(screen.getByText("2 files")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: /^Edited/ }));
  expect(screen.getAllByText("src/a.ts")).not.toHaveLength(0);
  expect(screen.getByText("src/b.ts")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Review current changes" }));
  expect(openDiff).toHaveBeenCalledTimes(1);

  expect(screen.getByText("Ran")).toBeOnTheScreen();
  expect(screen.getByText("pnpm test")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: /^Ran/ }));
  expect(screen.getByText("pnpm test")).toBeOnTheScreen();
  expect(screen.getByText("Build · model-1 · 2s")).toBeOnTheScreen();
});

test("hides repeated assistant metadata for a tool-only turn", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            id: "tool-skill",
            name: "skill",
            state: {
              content: [{ text: "Loaded review skill", type: "text" }],
              input: { name: "review" },
              status: "completed",
            },
            time: { completed: 1_500, created: 1_100 },
            type: "tool",
          },
        ],
        id: "msg_tool_only",
        model: { id: "model-1", providerID: "provider" },
        time: { completed: 1_500, created: 1_000 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("Loaded review skill")).toBeOnTheScreen();
  expect(screen.queryByText("Build · model-1 · 500ms")).toBeNull();
});

test("does not render an unchanged transcript row again", () => {
  let typeReads = 0;
  const message = new Proxy<SessionMessageInfo>(
    { id: "msg_stable", text: "Stable row", time: { created: 1 }, type: "user" },
    {
      get(target, property, receiver) {
        if (property === "type") typeReads += 1;
        return Reflect.get(target, property, receiver);
      },
    },
  );
  const view = render(<SessionTranscriptRow message={message} />);
  const initialReads = typeReads;

  view.rerender(<SessionTranscriptRow message={message} />);

  expect(typeReads).toBe(initialReads);
});

test("renders V2 subagents as navigable cards without protocol markup", () => {
  const openSubagent = jest.fn();
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            id: "tool-subagent",
            name: "subagent",
            state: {
              content: [
                {
                  text: '<task id="ses_child" state="running">\n<summary>Background task started</summary>\n<task_result>\nWorking\n</task_result>\n</task>',
                  type: "text",
                },
              ],
              input: {
                background: true,
                description: "Inspect event handling",
                subagent_type: "explore",
              },
              metadata: { background: true, sessionId: "ses_child" },
              status: "completed",
            },
            time: { created: 1 },
            type: "tool",
          },
        ],
        id: "msg_subagent",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
      }}
      onOpenSubagent={openSubagent}
    />,
  );

  expect(screen.getByText("BACKGROUND SUBAGENT")).toBeOnTheScreen();
  expect(screen.getByText("Inspect event handling")).toBeOnTheScreen();
  expect(screen.getByText("@explore")).toBeOnTheScreen();
  expect(screen.getByText("RUNNING")).toBeOnTheScreen();
  expect(screen.queryByText("subagent / Completed")).toBeNull();
  expect(screen.queryByText(/<task/)).toBeNull();

  fireEvent.press(screen.getByRole("button", { name: "Open child" }));
  expect(openSubagent).toHaveBeenCalledWith("ses_child");
  fireEvent.press(screen.getByRole("button", { name: "Show result" }));
  expect(screen.getByText("Working")).toBeOnTheScreen();
  expect(screen.queryByText(/task_result/)).toBeNull();
});

test("projects injected background results into subagent cards", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [
          {
            text: '<task id="ses_child" state="completed">\n<summary>Background task completed: inspect code</summary>\n<task_result>\nUseful result\n</task_result>\n</task>',
            type: "text",
          },
        ],
        id: "msg_background_result",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 2 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("Background task completed: inspect code")).toBeOnTheScreen();
  expect(screen.getByText("COMPLETED")).toBeOnTheScreen();
  expect(screen.getByLabelText(/Subagent Background task completed/)).toHaveStyle({
    backgroundColor: "transparent",
    borderRadius: 0,
    paddingHorizontal: 0,
  });
  expect(screen.queryByText(/<task/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Show result" }));
  expect(screen.getByText("Useful result")).toBeOnTheScreen();
});

test("lets attachment and disclosure controls reflow at accessibility text sizes", () => {
  const user = messages.find(
    (message): message is Extract<SessionMessageInfo, { type: "user" }> => message.type === "user",
  );
  const assistant = messages.find(
    (message): message is Extract<SessionMessageInfo, { type: "assistant" }> =>
      message.type === "assistant",
  );
  if (!user || !assistant) throw new Error("TEST_FIXTURE_MISSING");

  render(
    <View>
      <SessionTranscriptRow largeText message={user} />
      <SessionTranscriptRow largeText message={assistant} />
    </View>,
  );

  expect(screen.getByText("note.txt").props.numberOfLines).toBeUndefined();
  expect(screen.getByRole("button", { name: /Retry 2 scheduled/ })).toHaveStyle({
    flexDirection: "column",
  });
});

test("caps child rows within one projected message", () => {
  const content = Array.from({ length: 65 }, (_, ordinal) => ({
    text: `Part ${ordinal}`,
    type: "text" as const,
  }));
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content,
        id: "msg_many_parts",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("Part 63")).toBeOnTheScreen();
  expect(screen.queryByText("Part 64")).toBeNull();
  expect(screen.getByText("Additional message parts omitted on this device.")).toBeOnTheScreen();
});
