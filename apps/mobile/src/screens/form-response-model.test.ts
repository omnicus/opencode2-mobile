import { expect, test } from "@jest/globals";
import type { FormAnswer, FormField, FormInfo } from "@opencode2-mobile/opencode-adapter";

import {
  createFormDraft,
  type FormDraftValue,
  isFormFieldVisible,
  validateFormDraft,
  visibleFormFieldKeys,
} from "./form-response-model";

const form: FormInfo = {
  fields: [
    { default: "Ada", key: "name", minLength: 2, required: true, type: "string" },
    { key: "ratio", maximum: 1, minimum: 0, type: "number" },
    { key: "count", required: true, type: "integer" },
    { default: false, key: "advanced", type: "boolean" },
    {
      key: "targets",
      maxItems: 2,
      minItems: 1,
      options: [
        { label: "One", value: "one" },
        { label: "Two", value: "two" },
      ],
      type: "multiselect",
    },
    {
      key: "detail",
      required: true,
      type: "string",
      when: [{ key: "advanced", op: "eq", value: true }],
    },
    { key: "login", type: "external", url: "https://example.test" },
  ],
  id: "frm_test",
  sessionID: "ses_test",
  title: "Configure",
};

test("creates drafts from every editable field default", () => {
  expect(createFormDraft(form)).toEqual({
    advanced: false,
    name: "Ada",
  });
});

test("treats unanswered conditions as false and multiselect conditions as membership", () => {
  const conditional: FormInfo = {
    fields: [
      { key: "mode", type: "string" },
      {
        key: "unanswered-neq",
        type: "string",
        when: [{ key: "mode", op: "neq", value: "simple" }],
      },
      {
        key: "features",
        options: [{ label: "Logs", value: "logs" }],
        type: "multiselect",
      },
      {
        key: "log-level",
        type: "string",
        when: [{ key: "features", op: "eq", value: "logs" }],
      },
    ],
    id: "frm_conditions",
    sessionID: "ses_test",
    title: "Conditions",
  };

  expect(visibleFormFieldKeys(conditional, {}).has("unanswered-neq")).toBe(false);
  expect(visibleFormFieldKeys(conditional, { features: ["logs"] }).has("log-level")).toBe(true);
});

test("resolves visibility when a controlling field appears later", () => {
  const laterController: FormInfo = {
    fields: [
      {
        key: "details",
        type: "string",
        when: [{ key: "show", op: "eq", value: true }],
      },
      { key: "show", type: "boolean" },
    ],
    id: "frm_later_controller",
    sessionID: "ses_test",
    title: "Later controller",
  };

  expect(visibleFormFieldKeys(laterController, { show: true })).toEqual(
    new Set(["show", "details"]),
  );
});

test("keeps false distinct from an unanswered required boolean", () => {
  const requiredBoolean: FormInfo = {
    fields: [{ key: "confirmed", required: true, type: "boolean" }],
    id: "frm_boolean",
    sessionID: "global",
    title: "Confirm",
  };

  expect(validateFormDraft(requiredBoolean, {}).errors.confirmed).toBe("Choose Yes or No.");
  expect(validateFormDraft(requiredBoolean, { confirmed: false })).toMatchObject({
    answer: { confirmed: false },
    valid: true,
  });
});

test("does not accept a required multiselect after its last option is removed", () => {
  const requiredOptions: FormInfo = {
    fields: [
      {
        key: "targets",
        options: [{ label: "Production", value: "production" }],
        required: true,
        type: "multiselect",
      },
    ],
    id: "frm_targets",
    sessionID: "ses_test",
    title: "Targets",
  };

  expect(validateFormDraft(requiredOptions, { targets: [] }).errors.targets).toBe(
    "Choose at least 1.",
  );
});

test("applies conditional visibility and omits hidden answers", () => {
  const draft = { ...createFormDraft(form), count: "2", targets: ["one"] };
  const detail = form.fields.find((field) => field.key === "detail");
  expect(detail && isFormFieldVisible(detail, draft)).toBe(false);
  expect(validateFormDraft(form, draft)).toEqual({
    answer: { advanced: false, count: 2, name: "Ada", targets: ["one"] },
    errors: {},
    valid: true,
  });
});

test("validates number, integer, multiselect, and newly visible required fields", () => {
  const result = validateFormDraft(form, {
    ...createFormDraft(form),
    advanced: true,
    count: "1.5",
    ratio: "2",
    targets: [],
  });
  expect(result.valid).toBe(false);
  expect(result.errors).toMatchObject({
    count: "Enter a whole number.",
    detail: "This field is required.",
    ratio: "Enter 1 or less.",
    targets: "Choose at least 1.",
  });
});

test("validates string options, formats, and invalid server patterns", () => {
  const formatted: FormInfo = {
    fields: [
      { format: "email", key: "email", type: "string" },
      { custom: false, key: "choice", options: [{ label: "A", value: "a" }], type: "string" },
      { key: "pattern", pattern: "[", type: "string" },
    ],
    id: "frm_formats",
    sessionID: "ses_test",
    title: "Formats",
  };
  const result = validateFormDraft(formatted, {
    choice: "b",
    email: "not-email",
    pattern: "value",
  });
  expect(result.errors).toEqual({
    choice: "Choose a listed option.",
    email: "Enter a valid email address.",
    pattern: "The server supplied an invalid validation pattern.",
  });
});

function singleField(field: FormField): FormInfo {
  return { fields: [field], id: "frm_single", sessionID: "ses_test", title: "Single" };
}

test.each<[string, FormField, FormDraftValue, string]>([
  [
    "too short",
    { key: "value", minLength: 3, type: "string" },
    "ab",
    "Enter at least 3 characters.",
  ],
  [
    "too long",
    { key: "value", maxLength: 2, minLength: 1, type: "string" },
    "abc",
    "Enter no more than 2 characters.",
  ],
  [
    "not matching the pattern",
    { key: "value", pattern: "^\\d+$", type: "string" },
    "12a",
    "The value does not match the required format.",
  ],
  [
    "an invalid URL",
    { format: "uri", key: "value", type: "string" },
    "not a url",
    "Enter a valid URL.",
  ],
  [
    "a malformed date",
    { format: "date", key: "value", type: "string" },
    "2024-1-01",
    "Enter a valid date as YYYY-MM-DD.",
  ],
  [
    "an impossible date",
    { format: "date", key: "value", type: "string" },
    "2023-02-29",
    "Enter a valid date as YYYY-MM-DD.",
  ],
  [
    "an invalid date-time",
    { format: "date-time", key: "value", type: "string" },
    "tomorrow-ish",
    "Enter a valid date and time.",
  ],
  ["a non-number", { key: "value", type: "number" }, "ten", "Enter a valid number."],
  ["a non-finite literal", { key: "value", type: "number" }, "1e999", "Enter a valid number."],
  ["below the minimum", { key: "value", minimum: 5, type: "integer" }, "4", "Enter 5 or more."],
  [
    "below an infinite minimum",
    { key: "value", minimum: "Infinity", type: "number" },
    "1",
    "Enter Infinity or more.",
  ],
  [
    "above a negative infinite maximum",
    { key: "value", maximum: "-Infinity", type: "number" },
    "0",
    "Enter -Infinity or less.",
  ],
  [
    "too many options",
    {
      key: "value",
      maxItems: 1,
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
      type: "multiselect",
    },
    ["a", "b"],
    "Choose no more than 1.",
  ],
  [
    "an unlisted option",
    { key: "value", options: [{ label: "A", value: "a" }], type: "multiselect" },
    ["a", "z"],
    "Choose only listed options.",
  ],
])("rejects %s", (_name, field, value, error) => {
  const result = validateFormDraft(singleField(field), { value });
  expect(result).toEqual({ answer: {}, errors: { value: error }, valid: false });
});

test.each<[string, FormField, FormDraftValue, FormAnswer[string]]>([
  [
    "a string within bounds",
    { key: "value", maxLength: 3, minLength: 1, type: "string" },
    "abc",
    "abc",
  ],
  [
    "a custom string option",
    { custom: true, key: "value", options: [{ label: "A", value: "a" }], type: "string" },
    "z",
    "z",
  ],
  ["a matching pattern", { key: "value", pattern: "^\\d+$", type: "string" }, "123", "123"],
  ["an email", { format: "email", key: "value", type: "string" }, "a@b.co", "a@b.co"],
  [
    "a URL",
    { format: "uri", key: "value", type: "string" },
    "https://example.test/x",
    "https://example.test/x",
  ],
  ["a leap day", { format: "date", key: "value", type: "string" }, "2024-02-29", "2024-02-29"],
  [
    "a date-time",
    { format: "date-time", key: "value", type: "string" },
    "2024-02-29T12:00:00Z",
    "2024-02-29T12:00:00Z",
  ],
  ["a padded number", { key: "value", maximum: 5, minimum: 1, type: "number" }, " 3.5 ", 3.5],
  ["a whole integer", { key: "value", type: "integer" }, "4", 4],
  ["an infinite integer literal", { key: "value", type: "integer" }, "Infinity", "Infinity"],
  ["a NaN literal", { key: "value", maximum: 1, minimum: 0, type: "number" }, "NaN", "NaN"],
  [
    "deduplicated custom options",
    { custom: true, key: "value", options: [], type: "multiselect" },
    ["z", "z", "y"],
    ["z", "y"],
  ],
])("accepts %s", (_name, field, value, answer) => {
  const result = validateFormDraft(singleField(field), { value });
  expect(result).toEqual({ answer: { value: answer }, errors: {}, valid: true });
});

test("skips unanswered and mistyped optional fields", () => {
  const optional: FormInfo = {
    fields: [
      { key: "flag", type: "boolean" },
      { key: "targets", options: [{ label: "A", value: "a" }], type: "multiselect" },
      { key: "name", type: "string" },
      { key: "count", type: "number" },
    ],
    id: "frm_optional",
    sessionID: "ses_test",
    title: "Optional",
  };

  expect(validateFormDraft(optional, {})).toEqual({ answer: {}, errors: {}, valid: true });
  expect(validateFormDraft(optional, { count: "", flag: "yes", name: "", targets: "a" })).toEqual({
    answer: { targets: [] },
    errors: {},
    valid: true,
  });
  expect(
    validateFormDraft(
      {
        ...optional,
        fields: [
          { key: "flag", required: true, type: "boolean" },
          {
            key: "targets",
            options: [{ label: "A", value: "a" }],
            required: true,
            type: "multiselect",
          },
          { key: "name", required: true, type: "string" },
          { key: "count", required: true, type: "number" },
        ],
      },
      { flag: "yes", name: ["a"] },
    ),
  ).toEqual({
    answer: {},
    errors: {
      count: "This field is required.",
      name: "This field is required.",
      targets: "Choose at least one option.",
    },
    valid: false,
  });
});
