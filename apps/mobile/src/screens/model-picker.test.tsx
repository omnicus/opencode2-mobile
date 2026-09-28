import { expect, jest, test } from "@jest/globals";
import type { ModelInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen } from "@testing-library/react-native";
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
