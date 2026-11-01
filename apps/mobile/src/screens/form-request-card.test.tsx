import { expect, jest, test } from "@jest/globals";
import type { FormInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Alert, Linking, Platform } from "react-native";

import { minTouchTarget, palette, radius, typography } from "../theme";
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

test("question controls use shared typography and neutral attention colors", () => {
  render(<FormRequestCard form={form} onCancel={jest.fn()} onSubmit={jest.fn()} />);

  expect(screen.getByText("Input required")).toHaveStyle({
    ...typography.sectionLabel,
    color: palette.warm,
  });
  expect(screen.getByRole("header", { name: "Deploy" })).toHaveStyle(typography.headline);
  expect(screen.getByText("Production")).toHaveStyle(typography.control);
  expect(screen.getByLabelText("name")).toHaveStyle({
    ...typography.body,
    borderRadius: radius.md,
    minHeight: minTouchTarget,
  });
  expect(screen.getByRole("checkbox", { name: "Production" })).toHaveStyle({
    borderRadius: radius.md,
    minHeight: minTouchTarget,
  });
});

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

test("focused form keeps its draft across dismissal and falls back inline without cancelling", () => {
  const props = { form, onCancel: jest.fn(), onSubmit: jest.fn() };
  const view = render(<FormRequestCard {...props} allowFocus />);
  expect(screen.queryByLabelText("name")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Review input request" }));
  fireEvent.changeText(screen.getByLabelText("name"), "Partial answer");
  expect(screen.getByRole("button", { name: "Send answers" })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Close Answer request" }));
  expect(props.onCancel).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Review input request" }));
  expect(screen.getByLabelText("name").props.value).toBe("Partial answer");
  view.rerender(<FormRequestCard {...props} allowFocus={false} />);
  expect(screen.queryByRole("button", { name: "Close Answer request" })).toBeNull();
  expect(screen.getByLabelText("name").props.value).toBe("Partial answer");
  expect(screen.getByRole("button", { name: "Submit" })).toBeOnTheScreen();
});

test("question progress counts visible answers and explains multiple selection", () => {
  render(<FormRequestCard form={form} onCancel={jest.fn()} onSubmit={jest.fn()} />);
  expect(screen.getByText("Choose any that apply")).toBeOnTheScreen();
  expect(screen.getByText("1 of 3 answered")).toBeOnTheScreen();
  fireEvent.changeText(screen.getByLabelText("name"), "Ada");
  expect(screen.getByText("2 of 3 answered")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("checkbox", { name: "Production" }));
  expect(screen.getByRole("checkbox", { name: "Production" })).toBeChecked();
  expect(screen.getByText("3 of 3 answered")).toBeOnTheScreen();
});

const channelsField = {
  custom: true,
  key: "channels",
  options: [
    { label: "Stable", value: "stable" },
    { label: "Beta", value: "beta" },
  ],
  required: true,
  title: "Channels",
  type: "multiselect",
} as const satisfies FormInfo["fields"][number];
const channels: FormInfo = {
  fields: [channelsField],
  id: "frm_channels",
  sessionID: "ses_test",
  title: "Which channels should get this fix?",
};

test("other values keep spaces and new lines while typing and submit trimmed lines", () => {
  const onSubmit = jest.fn();
  render(<FormRequestCard form={channels} onCancel={jest.fn()} onSubmit={onSubmit} />);
  fireEvent.press(screen.getByRole("checkbox", { name: "Stable" }));
  const input = screen.getByLabelText("Channels custom values");
  expect(screen.getByText("One value per line · 0 values")).toBeOnTheScreen();
  fireEvent.changeText(input, "Internal ");
  expect(screen.getByLabelText("Channels custom values").props.value).toBe("Internal ");
  fireEvent.changeText(input, "Internal QA\n");
  expect(screen.getByLabelText("Channels custom values").props.value).toBe("Internal QA\n");
  expect(screen.getByText("One value per line · 1 value")).toBeOnTheScreen();
  fireEvent.changeText(input, "Internal QA\n  Partner preview \n\n");
  expect(screen.getByText("One value per line · 2 values")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("checkbox", { name: "Beta" }));
  expect(screen.getByLabelText("Channels custom values").props.value).toBe(
    "Internal QA\n  Partner preview \n\n",
  );
  fireEvent.press(screen.getByRole("button", { name: "Submit" }));
  expect(onSubmit).toHaveBeenCalledWith({
    channels: ["stable", "Internal QA", "Partner preview", "beta"],
  });
});

test("other values start from custom defaults and options form a labelled group", () => {
  render(
    <FormRequestCard
      form={{
        ...channels,
        fields: [{ ...channelsField, default: ["stable", "Internal QA"] }],
      }}
      onCancel={jest.fn()}
      onSubmit={jest.fn()}
    />,
  );
  expect(screen.getByLabelText("Channels custom values").props.value).toBe("Internal QA");
  expect(screen.getByText("One value per line · 1 value")).toBeOnTheScreen();
  const group = screen.getByLabelText("Channels");
  expect(group.props.role).toBe("group");
  expect(group.props.accessibilityRole).toBeUndefined();
});

test("URL and number fields use keyboards that exist on the current platform", () => {
  const typed: FormInfo = {
    fields: [
      { format: "uri", key: "link", title: "Link", type: "string" },
      { key: "count", title: "Count", type: "integer" },
    ],
    id: "frm_typed",
    sessionID: "ses_test",
    title: "Typed",
  };
  for (const os of ["ios", "android"] as const) {
    jest.replaceProperty(Platform, "OS", os);
    const view = render(<FormRequestCard form={typed} onCancel={jest.fn()} onSubmit={jest.fn()} />);
    const link = screen.getByLabelText("Link");
    expect(link.props.autoCapitalize).toBe("none");
    expect(link.props.autoCorrect).toBe(false);
    expect(link.props.keyboardType).toBe("url");
    expect(screen.getByLabelText("Count").props.keyboardType).toBe(
      os === "ios" ? "numbers-and-punctuation" : "numeric",
    );
    view.unmount();
    jest.restoreAllMocks();
  }
});

test("VoiceOver hears submit progress, failed validation, and server errors", () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(jest.fn());
  announce.mockClear();
  const props = { form, onCancel: jest.fn(), onSubmit: jest.fn() };
  const view = render(<FormRequestCard {...props} />);
  expect(announce).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Submit" }));
  expect(announce).toHaveBeenLastCalledWith("1 answer needs attention");
  fireEvent.changeText(screen.getByLabelText("name"), "Ada");
  expect(announce).toHaveBeenLastCalledWith("2 of 3 answered");
  view.rerender(<FormRequestCard {...props} busy />);
  expect(announce).toHaveBeenLastCalledWith("Submitting answers…");
  view.rerender(<FormRequestCard {...props} error="The form response was not accepted." />);
  expect(announce).toHaveBeenLastCalledWith("The form response was not accepted.");
  jest.restoreAllMocks();
});
