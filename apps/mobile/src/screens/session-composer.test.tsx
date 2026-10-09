import { expect, jest, test } from "@jest/globals";
import type {
  AgentInfo,
  CommandInfo,
  FileSystemEntry,
  ModelInfo,
  ModelRef,
  SkillInfo,
} from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { useState } from "react";
import { Keyboard, StyleSheet } from "react-native";

import { typography } from "../theme";
import type { PromptDelivery } from "./prompt-admission-model";
import { SessionComposer } from "./session-composer";
import type { ComposerMention, ComposerSubmitIntent } from "./session-composer-model";

const agents = [
  { hidden: false, id: "build", mode: "primary", name: "Build" },
  { hidden: false, id: "explore", mode: "subagent", name: "Explore" },
] as AgentInfo[];
const models = [
  {
    enabled: true,
    id: "model-1",
    name: "Model One",
    providerID: "provider",
    status: "active",
    variants: [{ id: "deep" }],
  },
] as ModelInfo[];
const commands = [{ description: "Review changes", name: "review" }] as CommandInfo[];
const skills = [
  {
    content: "Release instructions",
    id: "release",
    path: "/workspace/.opencode/skills/release.md",
    name: "Release workflow",
  },
  {
    content: "Automatic context",
    id: "automatic",
    path: "/workspace/.opencode/skills/automatic.md",
    name: "Automatic",
  },
] as SkillInfo[];
const files = [{ path: "src/index.ts", type: "file" }] as FileSystemEntry[];

test("keeps the native prompt multiline and submits through an explicit control", () => {
  const onSubmit = jest.fn();
  render(<ComposerHarness onSubmit={onSubmit} />);

  const input = screen.getByLabelText("Prompt");
  expect(input.props.multiline).toBe(true);
  expect(input.props.submitBehavior).toBe("newline");
  fireEvent(input, "focus");
  // On iOS Fabric, numberOfLines is a maximum, not an initial editor height.
  expect(input.props.numberOfLines).toBeUndefined();
  fireEvent.changeText(input, "First line\nSecond line");
  expect(input.props.value).toBe("First line\nSecond line");
  fireEvent.press(screen.getByRole("button", { name: "Send" }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("active composer switches Stop to send on text and back when cleared", () => {
  const onInterrupt = jest.fn();
  const onSubmit = jest.fn();
  render(<ComposerHarness active onInterrupt={onInterrupt} onSubmit={onSubmit} />);
  const editor = within(screen.getByLabelText("Prompt editor"));
  fireEvent.press(editor.getByRole("button", { name: "Stop" }));
  expect(onInterrupt).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Prompt"), "Follow up");
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  fireEvent.press(editor.getByRole("button", { name: "Steer" }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onInterrupt).toHaveBeenCalledTimes(1);
  fireEvent.changeText(screen.getByLabelText("Prompt"), " \n ");
  expect(editor.getByRole("button", { name: "Stop" })).toBeEnabled();
});

test("idle composer never offers Stop", () => {
  render(<ComposerHarness onSubmit={jest.fn()} />);
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("the send icon keeps queue delivery for an active session", () => {
  const onSubmit = jest.fn();
  render(<ComposerHarness active delivery="queue" onSubmit={onSubmit} />);
  fireEvent.changeText(screen.getByLabelText("Prompt"), "Next prompt");
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Queue" }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test.each([false, true])("busy or unavailable Stop is disabled, stopping %s", (stopping) => {
  const onInterrupt = jest.fn();
  render(
    <ComposerHarness
      active
      interruptDisabled
      stopping={stopping}
      onInterrupt={onInterrupt}
      onSubmit={jest.fn()}
    />,
  );
  const button = screen.getByRole("button", { name: stopping ? "Stopping" : "Stop" });
  expect(button).toBeDisabled();
  fireEvent.press(button);
  expect(onInterrupt).not.toHaveBeenCalled();
});

test("typing while an interrupt is pending cannot submit a follow-up", () => {
  const onSubmit = jest.fn();
  render(<ComposerHarness active stopping onSubmit={onSubmit} />);
  fireEvent.changeText(screen.getByLabelText("Prompt"), "Keep this draft");
  expect(screen.getByRole("button", { name: "Steer" })).toBeDisabled();
  fireEvent.press(screen.getByRole("button", { name: "Steer" }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Prompt").props.value).toBe("Keep this draft");
});

test("dismisses the keyboard and collapses the composer after sending", () => {
  const dismissKeyboard = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => undefined);
  render(<ComposerHarness onSubmit={jest.fn()} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent.changeText(input, "Ship it");
  fireEvent(input, "focus");
  expect(screen.getByRole("button", { name: "Model: Choose model" })).toBeOnTheScreen();

  fireEvent.press(screen.getByRole("button", { name: "Send" }));

  expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Prompt")).toHaveStyle({ height: 42 });
  dismissKeyboard.mockRestore();
});

test("closes before publishing an immediate active-session transition", () => {
  let composerClosed = false;
  const dismissKeyboard = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {
    composerClosed = true;
  });
  const onSubmit = jest.fn(() => {
    expect(composerClosed).toBe(true);
  });
  render(<ComposerHarness onSubmit={onSubmit} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent.changeText(input, "Ship it");
  fireEvent(input, "focus");
  fireEvent.press(screen.getByRole("button", { name: "Send" }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Prompt")).toHaveStyle({ height: 42 });
  dismissKeyboard.mockRestore();
});

test("keeps model and variant controls visible before the editor is focused", () => {
  render(<ComposerHarness onSubmit={jest.fn()} />);

  const input = screen.getByLabelText("Prompt");
  expect(input).toHaveStyle({ height: 42 });
  expect(screen.getByRole("button", { name: "Model: Choose model" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Variant: Default" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Agent: Choose agent" })).toBeOnTheScreen();

  fireEvent(input, "focus");

  expect(input).toHaveStyle({ minHeight: 56, maxHeight: 120 });
  expect(screen.getByRole("button", { name: "Model: Choose model" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Agent: Choose agent" })).toBeOnTheScreen();
});

test("lets native multiline layout grow without waiting for a size-change event", () => {
  render(<ComposerHarness onSubmit={jest.fn()} />);
  const input = screen.getByLabelText("Prompt");
  fireEvent(input, "focus");
  // The native test environment uses 200% font scaling.
  expect(input).toHaveStyle({ minHeight: 56, maxHeight: 120 });
  expect(StyleSheet.flatten(input.props.style).height).toBeUndefined();
  fireEvent.changeText(input, "First line\nSecond line\nThird line");
  expect(input.props.value).toBe("First line\nSecond line\nThird line");
  expect(StyleSheet.flatten(input.props.style).height).toBeUndefined();
  // Native scrolling must remain available once the maximum height is reached,
  // even if iOS does not emit another content-size event at that fixed limit.
  expect(input.props.scrollEnabled).toBe(true);
  fireEvent.changeText(input, "");
  expect(input).toHaveStyle({ minHeight: 56, maxHeight: 120 });
});

test("keeps send in the focused composer toolbar", () => {
  render(<ComposerHarness onSubmit={jest.fn()} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent(input, "focus");

  expect(
    within(screen.getByLabelText("Session composer")).getByRole("button", { name: "Send" }),
  ).toBeOnTheScreen();
});

test("uses the selected default without showing queue or steer choices", () => {
  const onSubmit = jest.fn();
  render(<ComposerHarness active onSubmit={onSubmit} />);

  const input = screen.getByLabelText("Prompt");
  expect(input).toHaveStyle(typography.chatBody);
  fireEvent.changeText(input, "Follow-up");
  fireEvent(input, "focus");
  expect(screen.queryByRole("radio", { name: "Queue next" })).toBeNull();
  expect(screen.queryByRole("radio", { name: "Steer now" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Steer" }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("keeps the editor read-only until its encrypted draft has loaded", () => {
  render(
    <SessionComposer
      active={false}
      agents={agents}
      commands={commands}
      draft=""
      editable={false}
      largeText={false}
      location={{ directory: "/workspace" }}
      mentionAgents={agents}
      mentionFiles={files}
      mentions={[]}
      models={models}
      onAgentChange={jest.fn()}
      onDraftChange={jest.fn()}
      onModelChange={jest.fn()}
      onMentionSearchChange={jest.fn()}
      onSubmit={jest.fn()}
      skills={skills}
    />,
  );

  expect(screen.getByLabelText("Prompt").props.editable).toBe(false);
});

test("selects a server agent and model", () => {
  const onAgentChange = jest.fn();
  const onModelChange = jest.fn();
  render(
    <SessionComposer
      active={false}
      agents={agents}
      commands={commands}
      draft=""
      largeText={false}
      location={{ directory: "/workspace" }}
      mentionAgents={agents}
      mentionFiles={files}
      mentions={[]}
      models={models}
      onAgentChange={onAgentChange}
      onDraftChange={jest.fn()}
      onModelChange={onModelChange}
      onMentionSearchChange={jest.fn()}
      onSubmit={jest.fn()}
      skills={skills}
    />,
  );

  fireEvent(screen.getByLabelText("Prompt"), "focus");
  fireEvent.press(screen.getByRole("button", { name: "Agent: Choose agent" }));
  expect(screen.getByLabelText("Agent results").props.inverted).toBeFalsy();
  fireEvent.changeText(screen.getByLabelText("Search agents"), "build");
  fireEvent.press(screen.getByRole("button", { name: "Build" }));
  expect(onAgentChange).toHaveBeenCalledWith("build");

  fireEvent.press(screen.getByRole("button", { name: "Model: Choose model" }));
  expect(screen.getByLabelText("Model results").props.inverted).toBeFalsy();
  fireEvent.press(screen.getByRole("button", { name: /Model One/ }));
  expect(onModelChange).toHaveBeenCalledWith({
    id: "model-1",
    providerID: "provider",
  });
});

test("selects a variant separately and can return to the model default", () => {
  render(<ComposerHarness onSubmit={jest.fn()} />);
  fireEvent.press(screen.getByRole("button", { name: "Model: Choose model" }));
  fireEvent.press(screen.getByRole("button", { name: /Model One/ }));
  fireEvent.press(screen.getByRole("button", { name: "Variant: Default" }));
  fireEvent.press(screen.getByRole("button", { name: "deep" }));
  expect(screen.getByRole("button", { name: "Variant: deep" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Model: Model One" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Variant: deep" }));
  fireEvent.press(screen.getByRole("button", { name: "Default" }));
  expect(screen.getByRole("button", { name: "Variant: Default" })).toBeOnTheScreen();
});

test("completes and submits a command with multiline Unicode arguments", () => {
  const onSubmit = jest.fn<(intent: ComposerSubmitIntent) => void>();
  render(<ComposerHarness onSubmit={onSubmit} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent(input, "focus");
  fireEvent.changeText(input, "/rev");
  expect(screen.getByLabelText("Command suggestions")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "/review, command" }));
  expect(screen.getByLabelText("Prompt").props.value).toBe("/review ");
  fireEvent.changeText(screen.getByLabelText("Prompt"), "/review src/æ.ts\nfocus errors");
  fireEvent.press(screen.getByRole("button", { name: "Send" }));

  expect(onSubmit).toHaveBeenCalledWith({
    arguments: "src/æ.ts\nfocus errors",
    command: "review",
    type: "command",
  });
});

test("keeps slash search command-only", () => {
  render(<ComposerHarness onSubmit={jest.fn()} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent(input, "focus");
  fireEvent.changeText(input, "/");

  expect(screen.getByRole("button", { name: "/review, command" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /release/ })).not.toBeOnTheScreen();
});

test("does not submit a slash command with arguments before the catalog loads", () => {
  const onSubmit = jest.fn();
  render(<ComposerHarness completionLoading onSubmit={onSubmit} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent.changeText(input, "/review src/index.ts");
  fireEvent.press(screen.getByRole("button", { name: "Send" }));

  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(onSubmit).not.toHaveBeenCalled();
});

test("does not submit slash input when the command catalog is unavailable", () => {
  const onSubmit = jest.fn();
  render(<ComposerHarness completionUnavailable onSubmit={onSubmit} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent.changeText(input, "/review src/index.ts");
  fireEvent.press(screen.getByRole("button", { name: "Send" }));

  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(onSubmit).not.toHaveBeenCalled();
});

test("searches files, skills, and agents with at and submits a structured skill mention", () => {
  const onSubmit = jest.fn<(intent: ComposerSubmitIntent) => void>();
  render(<ComposerHarness onSubmit={onSubmit} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent(input, "focus");
  fireEvent.changeText(input, "Ask @");
  fireEvent(input, "selectionChange", {
    nativeEvent: { selection: { end: 5, start: 5 } },
  });

  expect(screen.getByLabelText("File, skill, and agent suggestions")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "@src/index.ts, file" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "@Explore, agent" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "@release, skill" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "@release, skill" }));
  fireEvent.press(screen.getByRole("button", { name: "Send" }));

  expect(onSubmit).toHaveBeenCalledWith({
    skills: [{ id: "release", mention: { end: 12, start: 4, text: "@release" } }],
    type: "prompt",
  });
});

function ComposerHarness({
  active = false,
  completionLoading = false,
  completionUnavailable = false,
  onSubmit,
  onInterrupt = jest.fn(),
  interruptDisabled = false,
  stopping = false,
  delivery = "steer",
}: {
  active?: boolean;
  completionLoading?: boolean;
  completionUnavailable?: boolean;
  onSubmit: (intent: ComposerSubmitIntent) => void;
  onInterrupt?: () => void;
  interruptDisabled?: boolean;
  stopping?: boolean;
  delivery?: PromptDelivery;
}) {
  const [draft, setDraft] = useState("");
  const [agent, setAgent] = useState<string>();
  const [model, setModel] = useState<ModelRef>();
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  return (
    <SessionComposer
      onInterrupt={onInterrupt}
      interruptDisabled={interruptDisabled}
      stopping={stopping}
      active={active}
      agent={agent}
      agents={agents}
      commands={commands}
      completionLoading={completionLoading}
      completionUnavailable={completionUnavailable}
      delivery={delivery}
      draft={draft}
      largeText={false}
      location={{ directory: "/workspace" }}
      mentionAgents={agents}
      mentionFiles={files}
      mentions={mentions}
      model={model}
      models={models}
      onAgentChange={setAgent}
      onDraftChange={(content, nextMentions) => {
        setDraft(content);
        setMentions(nextMentions);
      }}
      onModelChange={setModel}
      onMentionSearchChange={jest.fn()}
      onSubmit={onSubmit}
      skills={skills}
    />
  );
}
