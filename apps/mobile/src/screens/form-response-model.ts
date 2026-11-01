import type { FormAnswer, FormField, FormInfo } from "@opencode2-mobile/opencode-adapter";

export type FormDraftValue = boolean | string | string[];
export type FormDraft = Record<string, FormDraftValue>;

export function createFormDraft(form: FormInfo): FormDraft {
  const draft: FormDraft = {};
  for (const field of form.fields) {
    if (field.type === "external") continue;
    if (field.default === undefined) continue;
    if (field.type === "boolean") draft[field.key] = field.default;
    else if (field.type === "multiselect") draft[field.key] = [...field.default];
    else draft[field.key] = String(field.default);
  }
  return draft;
}

export function visibleFormFieldKeys(form: FormInfo, draft: FormDraft) {
  const visible = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const field of form.fields) {
      if (visible.has(field.key) || !isFormFieldVisible(field, draft, visible)) continue;
      visible.add(field.key);
      changed = true;
    }
  }
  return visible;
}

export function isFormFieldVisible(
  field: FormField,
  draft: FormDraft,
  activeKeys?: ReadonlySet<string>,
) {
  if (field.type === "external" || !field.when || field.when.length === 0) return true;
  return field.when.every((condition) => {
    if (
      !Object.hasOwn(draft, condition.key) ||
      (activeKeys !== undefined && !activeKeys.has(condition.key))
    ) {
      return false;
    }
    const value = draft[condition.key];
    const equal = Array.isArray(value)
      ? typeof condition.value === "string" && value.includes(condition.value)
      : conditionComparableValue(value, condition.value) === condition.value;
    return condition.op === "eq" ? equal : !equal;
  });
}

export function validateFormDraft(form: FormInfo, draft: FormDraft) {
  const answer: FormAnswer = {};
  const errors: Record<string, string> = {};
  const visibleKeys = visibleFormFieldKeys(form, draft);
  for (const field of form.fields) {
    if (field.type === "external" || !visibleKeys.has(field.key)) continue;
    const result = validateFormField(field, Object.hasOwn(draft, field.key), draft[field.key]);
    if (!result) continue;
    if ("error" in result) errors[field.key] = result.error;
    else answer[field.key] = result.value;
  }
  return { answer, errors, valid: Object.keys(errors).length === 0 };
}

type EditableFormField = Exclude<FormField, { type: "external" }>;
type FieldValidation = { error: string } | { value: FormAnswer[string] } | undefined;

function validateFormField(
  field: EditableFormField,
  answered: boolean,
  value: FormDraftValue | undefined,
): FieldValidation {
  if (field.type === "boolean") return validateBooleanField(field, answered, value);
  if (field.type === "multiselect") return validateMultiselectField(field, answered, value);

  const text = typeof value === "string" ? value : "";
  if ((!answered || !text) && field.required) return { error: "This field is required." };
  if (!answered || !text) return undefined;
  if (field.type === "number" || field.type === "integer") return validateNumberField(field, text);
  const stringError = validateStringField(field, text);
  return stringError ? { error: stringError } : { value: text };
}

function validateBooleanField(
  field: Extract<FormField, { type: "boolean" }>,
  answered: boolean,
  value: FormDraftValue | undefined,
): FieldValidation {
  if (!answered && field.required) return { error: "Choose Yes or No." };
  return typeof value === "boolean" ? { value } : undefined;
}

function validateMultiselectField(
  field: Extract<FormField, { type: "multiselect" }>,
  answered: boolean,
  value: FormDraftValue | undefined,
): FieldValidation {
  if (!answered && field.required) return { error: "Choose at least one option." };
  if (!answered) return undefined;
  const selected = Array.isArray(value) ? [...new Set(value)] : [];
  const minimum = Math.max(field.required ? 1 : 0, field.minItems ?? 0);
  if (selected.length < minimum) return { error: `Choose at least ${minimum}.` };
  if (field.maxItems !== undefined && selected.length > field.maxItems) {
    return { error: `Choose no more than ${field.maxItems}.` };
  }
  if (
    !field.custom &&
    selected.some((item) => !field.options.some((option) => option.value === item))
  ) {
    return { error: "Choose only listed options." };
  }
  return { value: selected };
}

function validateNumberField(
  field: Extract<FormField, { type: "number" | "integer" }>,
  text: string,
): FieldValidation {
  const parsed = parseFormNumber(text);
  if (parsed === undefined) return { error: "Enter a valid number." };
  if (field.type === "integer" && typeof parsed === "number" && !Number.isInteger(parsed)) {
    return { error: "Enter a whole number." };
  }
  if (isBelowMinimum(parsed, field.minimum)) {
    return { error: `Enter ${String(field.minimum)} or more.` };
  }
  if (isAboveMaximum(parsed, field.maximum)) {
    return { error: `Enter ${String(field.maximum)} or less.` };
  }
  return { value: parsed };
}

function conditionComparableValue(value: FormDraftValue | undefined, expected: unknown) {
  if (typeof expected === "number" && typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

function parseFormNumber(value: string) {
  const trimmed = value.trim();
  if (trimmed === "Infinity" || trimmed === "-Infinity" || trimmed === "NaN") return trimmed;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numericValue(value: number | "Infinity" | "-Infinity" | "NaN") {
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  if (value === "NaN") return Number.NaN;
  return value;
}

function isBelowMinimum(
  value: number | "Infinity" | "-Infinity" | "NaN",
  minimum: number | "Infinity" | "-Infinity" | "NaN" | undefined,
) {
  return minimum !== undefined && numericValue(value) < numericValue(minimum);
}

function isAboveMaximum(
  value: number | "Infinity" | "-Infinity" | "NaN",
  maximum: number | "Infinity" | "-Infinity" | "NaN" | undefined,
) {
  return maximum !== undefined && numericValue(value) > numericValue(maximum);
}

function validateStringField(field: Extract<FormField, { type: "string" }>, value: string) {
  if (field.minLength !== undefined && value.length < field.minLength) {
    return `Enter at least ${field.minLength} characters.`;
  }
  if (field.maxLength !== undefined && value.length > field.maxLength) {
    return `Enter no more than ${field.maxLength} characters.`;
  }
  if (field.options && !field.custom && !field.options.some((option) => option.value === value)) {
    return "Choose a listed option.";
  }
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(value))
        return "The value does not match the required format.";
    } catch {
      return "The server supplied an invalid validation pattern.";
    }
  }
  if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Enter a valid email address.";
  }
  if (field.format === "uri") {
    try {
      new URL(value);
    } catch {
      return "Enter a valid URL.";
    }
  }
  if (field.format === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const date = match
      ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      : undefined;
    if (!date || date.toISOString().slice(0, 10) !== value) {
      return "Enter a valid date as YYYY-MM-DD.";
    }
  }
  if (field.format === "date-time" && Number.isNaN(Date.parse(value))) {
    return "Enter a valid date and time.";
  }
}
