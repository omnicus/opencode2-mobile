import { expect, jest, test } from "@jest/globals";
import type { FormInfo } from "@opencode2-mobile/opencode-adapter";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
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

test("describes number and integer bounds and fills string keyboards from the format", () => {
  jest.replaceProperty(Platform, "OS", "android");
  render(
    <FormRequestCard
      form={{
        ...form,
        fields: [
          { key: "ratio", maximum: 1, minimum: 0, type: "number" },
          { key: "count", minimum: 1, type: "integer" },
          { key: "limit", maximum: 10, type: "integer" },
          { key: "weight", type: "number" },
          { format: "email", key: "email", type: "string" },
          { key: "note", placeholder: "Anything else", type: "string" },
        ],
      }}
      onCancel={jest.fn()}
      onSubmit={jest.fn()}
    />,
  );

  expect(screen.getByText("Number from 0 to 1")).toBeOnTheScreen();
  expect(screen.getByText("Whole number, minimum 1")).toBeOnTheScreen();
  expect(screen.getByText("Whole number, maximum 10")).toBeOnTheScreen();
  expect(screen.getByText("Number")).toBeOnTheScreen();
  expect(screen.getByLabelText("ratio").props.keyboardType).toBe("numeric");
  expect(screen.getByLabelText("ratio").props.placeholder).toBeUndefined();
  expect(screen.getByLabelText("email").props).toMatchObject({
    autoCapitalize: "none",
    autoCorrect: false,
    keyboardType: "email-address",
  });
  expect(screen.getByLabelText("note").props).toMatchObject({
    autoCapitalize: "sentences",
    autoCorrect: true,
    keyboardType: "default",
    placeholder: "Anything else",
  });
  jest.restoreAllMocks();
});

test("offers single-choice options with an optional custom value", () => {
  const onSubmit = jest.fn();
  render(
    <FormRequestCard
      form={{
        ...form,
        fields: [
          {
            key: "region",
            options: [
              { description: "Oregon", label: "West", value: "us-west" },
              { label: "East", value: "us-east" },
            ],
            type: "string",
          },
          {
            custom: true,
            key: "tier",
            options: [{ label: "Free", value: "free" }],
            title: "Tier",
            type: "string",
          },
        ],
      }}
      onCancel={jest.fn()}
      onSubmit={onSubmit}
    />,
  );

  expect(screen.getAllByText("Choose one")).toHaveLength(2);
  expect(screen.getByText("Oregon")).toBeOnTheScreen();
  expect(screen.queryByLabelText("region")).toBeNull();
  fireEvent.press(screen.getByRole("radio", { name: /West/ }));
  expect(screen.getByRole("radio", { name: /West/ })).toBeChecked();
  expect(screen.getByRole("radio", { name: "East" })).not.toBeChecked();
  fireEvent.press(screen.getByRole("radio", { name: "Free" }));
  expect(screen.getByLabelText("Tier").props.value).toBe("free");
  fireEvent.changeText(screen.getByLabelText("Tier"), "enterprise");
  expect(screen.getByRole("radio", { name: "Free" })).not.toBeChecked();
  fireEvent.press(screen.getByRole("button", { name: "Submit" }));

  expect(onSubmit).toHaveBeenCalledWith({ region: "us-west", tier: "enterprise" });
});

test("multiselect options toggle off again and keep custom values", () => {
  const onSubmit = jest.fn();
  render(
    <FormRequestCard
      form={{
        ...form,
        fields: [
          {
            custom: true,
            key: "targets",
            options: [
              { label: "Production", value: "production" },
              { description: "Preview", label: "Staging", value: "staging" },
            ],
            title: "Targets",
            type: "multiselect",
          },
        ],
      }}
      onCancel={jest.fn()}
      onSubmit={onSubmit}
    />,
  );

  fireEvent.press(screen.getByRole("checkbox", { name: "Production" }));
  fireEvent.press(screen.getByRole("checkbox", { name: /Staging/ }));
  fireEvent.changeText(screen.getByLabelText("Targets custom values"), "canary");
  fireEvent.press(screen.getByRole("checkbox", { name: "Production" }));
  expect(screen.getByRole("checkbox", { name: "Production" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Staging/ })).toBeChecked();
  expect(screen.getByText("Preview")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Submit" }));

  expect(onSubmit).toHaveBeenCalledWith({ targets: ["staging", "canary"] });
});

test("optional booleans can return to not set while required ones cannot", () => {
  const onSubmit = jest.fn();
  render(
    <FormRequestCard
      form={{
        ...form,
        fields: [
          { key: "notify", title: "Notify", type: "boolean" },
          { description: "Confirm the release", key: "confirm", required: true, type: "boolean" },
        ],
      }}
      onCancel={jest.fn()}
      onSubmit={onSubmit}
    />,
  );

  expect(screen.getAllByRole("radio", { name: "Not set" })).toHaveLength(1);
  expect(screen.getByRole("radio", { name: "Not set" })).toBeChecked();
  expect(screen.getByText("Confirm the release")).toBeOnTheScreen();
  expect(screen.getByText("confirm *")).toBeOnTheScreen();
  expect(screen.getByText("0 of 2 answered")).toBeOnTheScreen();
  const notify = within(screen.getByLabelText("Notify"));
  const confirm = within(screen.getByLabelText("confirm"));
  fireEvent.press(notify.getByRole("radio", { name: "No" }));
  expect(notify.getByRole("radio", { name: "No" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Not set" })).not.toBeChecked();
  expect(screen.getByText("1 of 2 answered")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("radio", { name: "Not set" }));
  expect(screen.getByRole("radio", { name: "Not set" })).toBeChecked();
  fireEvent.press(confirm.getByRole("radio", { name: "Yes" }));
  fireEvent.press(screen.getByRole("button", { name: "Submit" }));

  expect(onSubmit).toHaveBeenCalledWith({ confirm: true });
});

test("clearing an invalid optional answer removes its error", () => {
  render(
    <FormRequestCard
      form={{
        ...form,
        fields: [
          { key: "notify", title: "Notify", type: "boolean" },
          { key: "count", minimum: 5, title: "Count", type: "integer" },
        ],
      }}
      onCancel={jest.fn()}
      onSubmit={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByRole("radio", { name: "Not set" }));
  fireEvent.changeText(screen.getByLabelText("Count"), "1");
  fireEvent.press(screen.getByRole("button", { name: "Submit" }));
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  fireEvent.changeText(screen.getByLabelText("Count"), "");
  expect(screen.queryByRole("alert")).toBeNull();
});

test("VoiceOver counts several answers that need attention", () => {
  jest.replaceProperty(Platform, "OS", "ios");
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(jest.fn());
  render(
    <FormRequestCard
      form={{
        ...form,
        fields: [
          { key: "name", required: true, type: "string" },
          { key: "role", required: true, type: "string" },
        ],
      }}
      onCancel={jest.fn()}
      onSubmit={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByRole("button", { name: "Submit" }));
  expect(announce).toHaveBeenLastCalledWith("2 answers need attention");
  jest.restoreAllMocks();
});

test("busy forms show progress on submit and disable cancel", () => {
  render(<FormRequestCard busy form={form} onCancel={jest.fn()} onSubmit={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Submitting" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Cancel form" })).toBeDisabled();
});

test("cancelling can be withdrawn to keep editing", () => {
  const onCancel = jest.fn();
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.find((button) => button.text === "Keep editing")?.onPress?.(),
    );
  render(<FormRequestCard form={form} onCancel={onCancel} onSubmit={jest.fn()} />);
  fireEvent.press(screen.getByRole("button", { name: "Cancel form" }));
  expect(alert).toHaveBeenCalledWith(
    "Cancel form?",
    "This rejects the pending form without submitting the values entered here.",
    expect.any(Array),
  );
  expect(onCancel).not.toHaveBeenCalled();
  alert.mockRestore();
});

test("focusable forms show server errors on the card only while the sheet is closed", () => {
  render(
    <FormRequestCard
      allowFocus
      error="The form response was not accepted."
      form={form}
      onCancel={jest.fn()}
      onSubmit={jest.fn()}
    />,
  );
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  fireEvent.press(screen.getByRole("button", { name: "Review input request" }));
  expect(screen.getAllByText("The form response was not accepted.")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Send answers" })).toBeOnTheScreen();
});

test("a single question has no progress count", () => {
  render(
    <FormRequestCard
      form={{ ...form, fields: [{ key: "name", type: "string" }] }}
      onCancel={jest.fn()}
      onSubmit={jest.fn()}
    />,
  );
  expect(screen.queryByText(/answered$/)).toBeNull();
});

test("external form links must parse and confirm before opening", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

  openExternalFormUrl("not a url");
  expect(alert).toHaveBeenLastCalledWith(
    "Invalid link",
    "OpenCode supplied an invalid external form URL.",
  );

  alert.mockImplementation((_title, _message, buttons) =>
    buttons?.find((button) => button.text === "Open")?.onPress?.(),
  );
  openExternalFormUrl("https://example.test/login");
  expect(alert).toHaveBeenLastCalledWith(
    "Open external form?",
    expect.stringContaining("opens example.test."),
    expect.any(Array),
  );
  expect(open).toHaveBeenCalledWith("https://example.test/login");
  alert.mockRestore();
  open.mockRestore();
});
