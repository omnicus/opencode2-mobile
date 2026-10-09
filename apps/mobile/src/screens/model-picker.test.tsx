import { expect, jest, test } from "@jest/globals";
import type { ModelInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { palette } from "../theme";
import { ModelPicker } from "./model-picker";

const models = [
  { id: "one", name: "Model One", providerID: "p", variants: [], enabled: true, status: "active" },
  { id: "two", name: "Model Two", providerID: "p", variants: [], enabled: true, status: "active" },
] as unknown as ModelInfo[];

test("stars do not select or dismiss and matching favorites stay first", () => {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  const toggle = jest.fn();
  render(
    <ModelPicker
      models={models}
      model={{ id: "one", providerID: "p" }}
      visible
      onSelect={onSelect}
      onClose={onClose}
      state={undefined}
      favorites={{
        models: [{ id: "two", providerID: "p" }],
        toggle,
        disabled: false,
        error: false,
        retry: jest.fn(),
      }}
    />,
  );
  expect(screen.getAllByRole("button", { name: /^Model/ })[0]).toHaveProp(
    "accessibilityLabel",
    "Model Two, p",
  );
  fireEvent.press(screen.getByRole("checkbox", { name: "Add Model One to favorites" }));
  expect(toggle).toHaveBeenCalledWith(models[0], true);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText("Search models"), "two");
  expect(screen.getAllByRole("button", { name: /^Model/ })).toHaveLength(1);
  fireEvent.press(screen.getByRole("button", { name: "Clear model search" }));
  expect(screen.getAllByRole("button", { name: /^Model/ })).toHaveLength(2);
  expect(screen.getByText("Model One")).toHaveStyle({ color: palette.accent });
  fireEvent.changeText(screen.getByLabelText("Search models"), "two");
  fireEvent.press(screen.getByRole("button", { name: "Model Two, p" }));
  expect(onSelect).toHaveBeenCalledWith({ id: "two", providerID: "p" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("loading and failure are distinct from an empty model catalog", () => {
  const retry = jest.fn();
  const props = {
    models: [],
    model: undefined,
    visible: true,
    onSelect: jest.fn(),
    onClose: jest.fn(),
    favorites: undefined,
  };
  const view = render(<ModelPicker {...props} state={{ loading: true, error: false, retry }} />);
  expect(screen.getByLabelText("Loading models")).toBeOnTheScreen();
  expect(screen.queryByText("No enabled models")).toBeNull();
  view.rerender(<ModelPicker {...props} state={{ loading: false, error: true, retry }} />);
  expect(screen.getByText("Models could not be loaded.")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalled();
});

test("duplicate display names remain distinguishable by provider and model ID", () => {
  const base = models[0];
  if (!base) throw new Error("Missing model fixture");
  const duplicateModels = [
    { ...base, id: "alpha", providerID: "first", name: "Shared name" },
    { ...base, id: "beta", providerID: "first", name: "Shared name" },
    { ...base, id: "gamma", providerID: "second", name: "Shared name" },
  ];
  const onSelect = jest.fn();
  render(
    <ModelPicker
      models={duplicateModels}
      model={undefined}
      favorites={undefined}
      state={undefined}
      visible
      onSelect={onSelect}
      onClose={jest.fn()}
    />,
  );
  fireEvent.changeText(screen.getByLabelText("Search models"), "shared");
  expect(screen.getByText("first · alpha")).toBeOnTheScreen();
  expect(screen.getByText("first · beta")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Shared name, second" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Shared name, first, beta" }));
  expect(onSelect).toHaveBeenCalledWith({ id: "beta", providerID: "first" });
});
