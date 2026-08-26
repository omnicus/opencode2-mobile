import { expect, jest, test } from "@jest/globals";
import type { AgentInfo, ModelInfo, ModelRef } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { useState } from "react";
import { Keyboard } from "react-native";

import type { PromptDelivery } from "./prompt-admission-model";
import { SessionComposer } from "./session-composer";

const agents = [{ hidden: false, id: "build", mode: "primary", name: "Build" }] as AgentInfo[];
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
      draft=""
      editable={false}
      largeText={false}
      models={models}
      onAgentChange={jest.fn()}
      onDeliveryChange={jest.fn()}
      onDraftChange={jest.fn()}
      onModelChange={jest.fn()}
      onSubmit={jest.fn()}
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
      draft=""
      largeText={false}
      models={models}
      onAgentChange={onAgentChange}
      onDeliveryChange={jest.fn()}
      onDraftChange={jest.fn()}
      onModelChange={onModelChange}
      onSubmit={jest.fn()}
    />,
  );

  fireEvent(screen.getByLabelText("Prompt"), "focus");
  fireEvent.press(screen.getByRole("button", { name: "Agent: Choose agent" }));
  fireEvent.press(screen.getByRole("button", { name: "Build" }));
  expect(onAgentChange).toHaveBeenCalledWith("build");

  fireEvent.press(screen.getByRole("button", { name: "Model: Choose model" }));
  fireEvent.press(screen.getByRole("button", { name: /Model One \/ deep/ }));
  expect(onModelChange).toHaveBeenCalledWith({
    id: "model-1",
    providerID: "provider",
    variant: "deep",
  });
});

function ComposerHarness({ active = false, onSubmit }: { active?: boolean; onSubmit: () => void }) {
  const [draft, setDraft] = useState("");
  const [delivery, setDelivery] = useState<PromptDelivery>();
  const [agent, setAgent] = useState<string>();
  const [model, setModel] = useState<ModelRef>();
  return (
    <SessionComposer
      active={active}
      agent={agent}
      agents={agents}
      delivery={delivery}
      draft={draft}
      largeText={false}
      model={model}
      models={models}
      onAgentChange={setAgent}
      onDeliveryChange={setDelivery}
      onDraftChange={setDraft}
      onModelChange={setModel}
      onSubmit={onSubmit}
    />
  );
}
