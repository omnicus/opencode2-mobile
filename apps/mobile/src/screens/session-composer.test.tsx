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
import { Keyboard } from "react-native";

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
    location: "/workspace/.opencode/skills/release.md",
    name: "Release workflow",
    slash: true,
  },
  {
    content: "Automatic context",
    id: "automatic",
    location: "/workspace/.opencode/skills/automatic.md",
    name: "Automatic",
    slash: false,
  },
] as SkillInfo[];
const files = [{ path: "src/index.ts", type: "file" }] as FileSystemEntry[];

test("keeps the native prompt multiline and submits through an explicit control", () => {
  const onSubmit = jest.fn();
  render(<ComposerHarness onSubmit={onSubmit} />);

  const input = screen.getByLabelText("Prompt");
  expect(input.props.multiline).toBe(true);
  expect(input.props.submitBehavior).toBe("newline");
  fireEvent.changeText(input, "First line\nSecond line");
  fireEvent.press(screen.getByRole("button", { name: "Send" }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("dismisses the keyboard and collapses the composer after sending", () => {
  const dismissKeyboard = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => undefined);
  render(<ComposerHarness onSubmit={jest.fn()} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent.changeText(input, "Ship it");
  fireEvent(input, "focus");
  expect(input.props.numberOfLines).toBe(4);

  fireEvent.press(screen.getByRole("button", { name: "Send" }));

  expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Prompt").props.numberOfLines).toBe(1);
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
  expect(screen.getByLabelText("Prompt").props.numberOfLines).toBe(1);
  dismissKeyboard.mockRestore();
});

test("keeps controls collapsed until the editor is focused", () => {
  render(<ComposerHarness onSubmit={jest.fn()} />);

  const input = screen.getByLabelText("Prompt");
  expect(input.props.numberOfLines).toBe(1);
  expect(screen.queryByRole("button", { name: "Model: Choose model" })).not.toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Agent: Choose agent" })).not.toBeOnTheScreen();

  fireEvent(input, "focus");

  expect(input.props.numberOfLines).toBe(4);
  expect(screen.getByRole("button", { name: "Model: Choose model" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Agent: Choose agent" })).toBeOnTheScreen();
});

test("keeps send in the focused composer toolbar", () => {
  render(<ComposerHarness onSubmit={jest.fn()} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent(input, "focus");

  expect(
    within(screen.getByLabelText("Session composer")).getByRole("button", { name: "Send" }),
  ).toBeOnTheScreen();
});

test("requires an explicit queue or steer choice while execution is active", () => {
  const onSubmit = jest.fn();
  render(<ComposerHarness active onSubmit={onSubmit} />);

  const input = screen.getByLabelText("Prompt");
  fireEvent.changeText(input, "Follow-up");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  fireEvent(input, "focus");
  fireEvent.press(screen.getByRole("radio", { name: "Queue next" }));
  fireEvent.press(screen.getByRole("button", { name: "Queue" }));

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
      onDeliveryChange={jest.fn()}
      onDraftChange={jest.fn()}
      onModelChange={jest.fn()}
      onMentionSearchChange={jest.fn()}
      onSubmit={jest.fn()}
      skills={skills}
    />,
  );

  expect(screen.getByLabelText("Prompt").props.editable).toBe(false);
});

test("selects a server agent and model variant", () => {
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
      onDeliveryChange={jest.fn()}
      onDraftChange={jest.fn()}
      onModelChange={onModelChange}
      onMentionSearchChange={jest.fn()}
      onSubmit={jest.fn()}
      skills={skills}
    />,
  );

  fireEvent(screen.getByLabelText("Prompt"), "focus");
  fireEvent.press(screen.getByRole("button", { name: "Agent: Choose agent" }));
  expect(screen.getByLabelText("Agent results").props.inverted).toBe(true);
  fireEvent.changeText(screen.getByLabelText("Search agents"), "build");
  fireEvent.press(screen.getByRole("button", { name: "Build" }));
  expect(onAgentChange).toHaveBeenCalledWith("build");

  fireEvent.press(screen.getByRole("button", { name: "Model: Choose model" }));
  expect(screen.getByLabelText("Model results").props.inverted).toBe(true);
  fireEvent.press(screen.getByRole("button", { name: /Model One \/ deep/ }));
  expect(onModelChange).toHaveBeenCalledWith({
    id: "model-1",
    providerID: "provider",
    variant: "deep",
  });
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
}: {
  active?: boolean;
  completionLoading?: boolean;
  completionUnavailable?: boolean;
  onSubmit: (intent: ComposerSubmitIntent) => void;
}) {
  const [draft, setDraft] = useState("");
  const [delivery, setDelivery] = useState<PromptDelivery>();
  const [agent, setAgent] = useState<string>();
  const [model, setModel] = useState<ModelRef>();
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  return (
    <SessionComposer
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
      onDeliveryChange={setDelivery}
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
