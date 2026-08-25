import { expect, jest, test } from "@jest/globals";
import type { FormInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";

import { FormRequestCard, openExternalFormUrl } from "./form-request-card";

const form: FormInfo = {
  fields: [
    { key: "name", required: true, type: "string" },
    { default: false, key: "advanced", title: "Advanced", type: "boolean" },
    {
      key: "detail",
      required: true,
      title: "Detail",
      type: "string",
      when: [{ key: "advanced", op: "eq", value: true }],
    },
    {
      key: "targets",
      minItems: 1,
      options: [{ label: "Production", value: "production" }],
      type: "multiselect",
    },
    { key: "login", title: "Sign in", type: "external", url: "https://example.test/login" },
  ],
  id: "frm_test",
  sessionID: "ses_test",
  title: "Deploy",
};

test("renders all field controls, conditional visibility, and a validated reply", () => {
  const onSubmit = jest.fn();
  render(<FormRequestCard form={form} onCancel={jest.fn()} onSubmit={onSubmit} />);

  expect(screen.getByLabelText("name")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Detail")).not.toBeOnTheScreen();
  fireEvent.press(screen.getByRole("radio", { name: "Yes" }));
  expect(screen.getByLabelText("Detail")).toBeOnTheScreen();

  fireEvent.press(screen.getByRole("button", { name: "Submit" }));
  expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByLabelText("name"), "Ada");
  fireEvent.changeText(screen.getByLabelText("Detail"), "Ship it");
  fireEvent.press(screen.getByRole("checkbox", { name: "Production" }));
  fireEvent.press(screen.getByRole("button", { name: "Submit" }));

  expect(onSubmit).toHaveBeenCalledWith({
    advanced: true,
    detail: "Ship it",
    name: "Ada",
    targets: ["production"],
  });
});

test("opens external fields and cancels through explicit controls", () => {
  const onCancel = jest.fn();
  const onOpenExternal = jest.fn();
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.find((button) => button.text === "Cancel form")?.onPress?.(),
    );
  render(
    <FormRequestCard
      form={form}
      onCancel={onCancel}
      onOpenExternal={onOpenExternal}
      onSubmit={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByRole("button", { name: "Open external form" }));
  expect(onOpenExternal).toHaveBeenCalledWith("https://example.test/login");
  fireEvent.press(screen.getByRole("button", { name: "Cancel form" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

test("rejects non-HTTP external form URLs", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

  openExternalFormUrl("javascript:alert(1)");

  expect(alert).toHaveBeenCalledWith(
    "Unsupported link",
    "Only HTTP and HTTPS form links can be opened.",
  );
  expect(open).not.toHaveBeenCalled();
  alert.mockRestore();
  open.mockRestore();
});

test("keeps partial answers when a REST refetch replaces the form object", () => {
  const properties = {
    form,
    onCancel: jest.fn(),
    onSubmit: jest.fn(),
  };
  const view = render(<FormRequestCard {...properties} />);
  fireEvent.changeText(screen.getByLabelText("name"), "Partial answer");

  view.rerender(<FormRequestCard {...properties} form={{ ...form }} />);

  expect(screen.getByLabelText("name").props.value).toBe("Partial answer");
});
