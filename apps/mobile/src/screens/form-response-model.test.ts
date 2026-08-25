import { expect, test } from "@jest/globals";
import type { FormInfo } from "@opencode2-mobile/opencode-adapter";

import {
  createFormDraft,
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
