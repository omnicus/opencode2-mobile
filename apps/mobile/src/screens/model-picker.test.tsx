import { expect, jest, test } from "@jest/globals";
import type { ModelInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { minTouchTarget, palette } from "../theme";
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
  expect(screen.getByRole("button", { name: "Model One, p" })).toBeSelected();
  expect(screen.getByText("Model One")).toHaveStyle({ color: palette.ink });
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

test("model rows meet the touch target and search uses the search return key", () => {
  render(
    <ModelPicker
      models={models}
      model={undefined}
      favorites={undefined}
      state={undefined}
      visible
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(screen.getByLabelText("Search models").props.returnKeyType).toBe("search");
  expect(screen.getByRole("button", { name: "Model One, p" })).toHaveStyle({
    minHeight: minTouchTarget,
  });
});

test("favorite errors offer a retry and favorites can be removed", () => {
  const retry = jest.fn();
  const toggle = jest.fn();
  render(
    <ModelPicker
      models={models}
      model={undefined}
      visible
      onSelect={jest.fn()}
      onClose={jest.fn()}
      state={{ loading: false, error: false, retry: jest.fn() }}
      favorites={{
        models: [{ id: "one", providerID: "p" }],
        toggle,
        disabled: false,
        error: true,
        retry,
      }}
    />,
  );
  expect(screen.getByText("Model favorites could not be saved or loaded.")).toBeOnTheScreen();
  expect(screen.queryByText("Models could not be loaded.")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
  const remove = screen.getByRole("checkbox", { name: "Remove Model One from favorites" });
  expect(remove).toBeChecked();
  fireEvent.press(remove);
  expect(toggle).toHaveBeenCalledWith(models[0], false);
  expect(screen.getByRole("header", { name: "Favorites" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Model One, p" })).not.toBeSelected();
});

test("stars are disabled while favorites are unavailable or busy", () => {
  const toggle = jest.fn();
  const props = {
    models,
    model: undefined,
    visible: true,
    onSelect: jest.fn(),
    onClose: jest.fn(),
    state: undefined,
  };
  const view = render(<ModelPicker {...props} favorites={undefined} />);
  expect(screen.getByRole("checkbox", { name: "Add Model One to favorites" })).toBeDisabled();
  view.rerender(
    <ModelPicker
      {...props}
      favorites={{ models: [], toggle, disabled: true, error: false, retry: jest.fn() }}
    />,
  );
  const star = screen.getByRole("checkbox", { name: "Add Model One to favorites" });
  expect(star).toBeDisabled();
  fireEvent.press(star);
  expect(toggle).not.toHaveBeenCalled();
});

test("an empty result says whether the search or the catalog is empty", () => {
  const props = {
    model: undefined,
    visible: true,
    onSelect: jest.fn(),
    onClose: jest.fn(),
    favorites: undefined,
    state: { loading: false, error: false, retry: jest.fn() },
  };
  const view = render(<ModelPicker {...props} models={[]} />);
  expect(screen.getByText("No enabled models")).toBeOnTheScreen();
  view.rerender(<ModelPicker {...props} models={models} />);
  fireEvent.changeText(screen.getByLabelText("Search models"), "  missing  ");
  expect(screen.getByText("No matching models")).toBeOnTheScreen();
  view.rerender(<ModelPicker {...props} models={models} state={{ ...props.state, error: true }} />);
  expect(screen.queryByText("No matching models")).toBeNull();
  expect(screen.getByText("Models could not be loaded.")).toBeOnTheScreen();
});
