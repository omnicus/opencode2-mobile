import { afterEach, expect, jest, test } from "@jest/globals";
import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { View } from "react-native";

import { resetTranscriptPerformanceMetrics } from "../state/transcript-performance";
import { SessionTranscriptRow } from "./session-transcript";

afterEach(resetTranscriptPerformanceMetrics);

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
        <SessionTranscriptRow key={message.id} message={message} />
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
  fireEvent.press(screen.getByRole("button", { name: /completed-tool/ }));
  fireEvent.press(screen.getByRole("button", { name: /error-tool/ }));
  fireEvent.press(screen.getByRole("button", { name: /Shell/ }));
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
    backgroundColor: "#121614",
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

test("renders short reasoning inline with bold markdown", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [{ text: "**Adding mocks to repository tests**", type: "reasoning" }],
        id: "msg_inline_reasoning",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.getByText("THOUGHT")).toBeOnTheScreen();
  expect(screen.getByText("Adding mocks to repository tests")).toHaveStyle({ fontWeight: "800" });
  expect(screen.queryByText(/\*\*/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Thought/ })).toBeNull();
});

test("keeps multiline reasoning in a disclosure", () => {
  render(
    <SessionTranscriptRow
      message={{
        agent: "build",
        content: [{ text: "First step\nSecond step", type: "reasoning" }],
        id: "msg_multiline_reasoning",
        model: { id: "model-1", providerID: "provider" },
        time: { created: 1 },
        type: "assistant",
      }}
    />,
  );

  expect(screen.queryByText("First step\nSecond step")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: /Thought/ }));
  expect(screen.getByText("First step\nSecond step")).toBeOnTheScreen();
});

test("groups assistant activity and places agent metadata in the footer", () => {
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
    />,
  );

  expect(screen.getByText("Explored")).toBeOnTheScreen();
  expect(screen.getByText("2 searches")).toBeOnTheScreen();
  expect(screen.queryByText("Read")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: /Explored/ }));
  expect(screen.getByText("Read")).toBeOnTheScreen();
  expect(screen.getByText("Grep")).toBeOnTheScreen();

  expect(screen.getByText("Patch")).toBeOnTheScreen();
  expect(screen.getByText("2 files")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: /Patch/ }));
  expect(screen.getAllByText("src/a.ts")).not.toHaveLength(0);
  expect(screen.getByText("src/b.ts")).toBeOnTheScreen();

  expect(screen.getByText("Shell")).toBeOnTheScreen();
  expect(screen.getByText("pnpm test")).toBeOnTheScreen();
  expect(screen.getByText("Build · model-1 · 2s")).toBeOnTheScreen();
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
