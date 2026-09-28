import type { FormAnswer, FormField, FormInfo } from "@opencode2-mobile/opencode-adapter";
import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { applicationName } from "../application-name";
import { control, palette, radius, space, typeRamp, typography } from "../theme";
import {
  createFormDraft,
  type FormDraft,
  validateFormDraft,
  visibleFormFieldKeys,
} from "./form-response-model";
import { sanitizeTranscriptText } from "./session-transcript-model";

export function FormRequestCard({
  busy,
  error,
  form,
  onCancel,
  onOpenExternal = openExternalFormUrl,
  onSubmit,
}: {
  busy?: boolean;
  error?: string;
  form: FormInfo;
  onCancel: () => void;
  onOpenExternal?: (url: string) => void;
  onSubmit: (answer: FormAnswer) => void;
}) {
  const [draft, setDraft] = useState<FormDraft>(() => createFormDraft(form));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function change(key: string, value: FormDraft[string]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function clear(key: string) {
    setDraft((current) => {
      if (!Object.hasOwn(current, key)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function submit() {
    const result = validateFormDraft(form, draft);
    setErrors(result.errors);
    if (result.valid) onSubmit(result.answer);
  }

  function confirmCancel() {
    Alert.alert(
      "Cancel form?",
      "This rejects the pending form without submitting the values entered here.",
      [
        { style: "cancel", text: "Keep editing" },
        { onPress: onCancel, style: "destructive", text: "Cancel form" },
      ],
    );
  }

  const visibleKeys = visibleFormFieldKeys(form, draft);

  return (
    <View accessibilityLabel={`Form: ${form.title}`} style={styles.card}>
      <Text dynamicTypeRamp={typeRamp.caption} style={styles.eyebrow}>
        Input required
      </Text>
      <Text accessibilityRole="header" dynamicTypeRamp={typeRamp.subheading} style={styles.title}>
        {sanitizeTranscriptText(form.title, 512)}
      </Text>
      {form.fields.map((field) =>
        visibleKeys.has(field.key) ? (
          <FormControl
            draft={draft}
            error={errors[field.key]}
            field={field}
            key={field.key}
            onChange={(value) => change(field.key, value)}
            onClear={() => clear(field.key)}
            onOpenExternal={onOpenExternal}
          />
        ) : null,
      )}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <FormButton
          primary
          disabled={busy}
          label={busy ? "Submitting" : "Submit"}
          onPress={submit}
        />
        <FormButton danger disabled={busy} label="Cancel form" onPress={confirmCancel} />
      </View>
    </View>
  );
}

function FormControl({
  draft,
  error,
  field,
  onChange,
  onClear,
  onOpenExternal,
}: {
  draft: FormDraft;
  error?: string | undefined;
  field: FormField;
  onChange: (value: FormDraft[string]) => void;
  onClear: () => void;
  onOpenExternal: (url: string) => void;
}) {
  const title = sanitizeTranscriptText(field.title ?? field.key, 256);
  const description = field.description
    ? sanitizeTranscriptText(field.description, 1_024)
    : undefined;
  if (field.type === "external") {
    return (
      <View style={styles.field}>
        <FieldHeading description={description} required={false} title={title} />
        <FormButton label="Open external form" onPress={() => onOpenExternal(field.url)} />
      </View>
    );
  }
  if (field.type === "boolean") {
    const value = draft[field.key];
    return (
      <View style={styles.field}>
        <FieldHeading description={description} required={field.required} title={title} />
        <View
          accessibilityLabel={title}
          accessibilityRole="radiogroup"
          style={styles.booleanOptions}
        >
          <ChoiceButton
            label="Yes"
            onPress={() => onChange(true)}
            radio
            selected={value === true}
          />
          <ChoiceButton
            label="No"
            onPress={() => onChange(false)}
            radio
            selected={value === false}
          />
          {!field.required ? (
            <ChoiceButton
              label="Not set"
              onPress={onClear}
              radio
              selected={!Object.hasOwn(draft, field.key)}
            />
          ) : null}
        </View>
        <FieldError error={error} />
      </View>
    );
  }
  if (field.type === "multiselect") {
    const current = draft[field.key];
    const selected: string[] = Array.isArray(current) ? current : [];
    const optionValues = new Set(field.options.map((option) => option.value));
    const customValues = selected.filter((value) => !optionValues.has(value));
    return (
      <View style={styles.field}>
        <FieldHeading description={description} required={field.required} title={title} />
        <View accessibilityRole="summary" style={styles.options}>
          {field.options.map((option) => (
            <ChoiceButton
              description={option.description}
              key={option.value}
              label={option.label}
              onPress={() =>
                onChange(
                  selected.includes(option.value)
                    ? selected.filter((value) => value !== option.value)
                    : [...selected, option.value],
                )
              }
              selected={selected.includes(option.value)}
            />
          ))}
        </View>
        {field.custom ? (
          <TextInput
            keyboardAppearance="dark"
            accessibilityHint="Enter one value per line"
            accessibilityLabel={`${title} custom values`}
            multiline
            onChangeText={(text) =>
              onChange([
                ...selected.filter((value) => optionValues.has(value)),
                ...text
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              ])
            }
            placeholder="Other values, one per line"
            placeholderTextColor={palette.dim}
            style={[styles.input, styles.multilineInput]}
            value={customValues.join("\n")}
          />
        ) : null}
        <FieldError error={error} />
      </View>
    );
  }

  const current = draft[field.key];
  const value = typeof current === "string" ? current : "";
  return (
    <View style={styles.field}>
      <FieldHeading description={description} required={field.required} title={title} />
      {field.type === "string" && field.options ? (
        <View accessibilityRole="radiogroup" style={styles.options}>
          {field.options.map((option) => (
            <ChoiceButton
              description={option.description}
              key={option.value}
              label={option.label}
              onPress={() => onChange(option.value)}
              radio
              selected={value === option.value}
            />
          ))}
        </View>
      ) : null}
      {field.type !== "string" || !field.options || field.custom ? (
        <TextInput
          keyboardAppearance="dark"
          accessibilityLabel={title}
          autoCapitalize={
            field.type === "string" && field.format === "email" ? "none" : "sentences"
          }
          keyboardType={
            field.type === "number" || field.type === "integer"
              ? "numbers-and-punctuation"
              : field.format === "email"
                ? "email-address"
                : field.format === "uri"
                  ? "url"
                  : "default"
          }
          onChangeText={onChange}
          placeholder={field.type === "string" ? field.placeholder : undefined}
          placeholderTextColor={palette.dim}
          style={styles.input}
          value={value}
        />
      ) : null}
      {field.type === "number" || field.type === "integer" ? (
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.constraint}>
          {numberConstraint(field)}
        </Text>
      ) : null}
      <FieldError error={error} />
    </View>
  );
}

function FieldHeading({
  description,
  required,
  title,
}: {
  description?: string | undefined;
  required?: boolean | undefined;
  title: string;
}) {
  return (
    <View style={styles.fieldHeading}>
      <Text dynamicTypeRamp={typeRamp.control} style={styles.label}>
        {title}
        {required ? " *" : ""}
      </Text>
      {description ? (
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.description}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

function FieldError({ error }: { error?: string | undefined }) {
  return error ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {error}
    </Text>
  ) : null;
}

function ChoiceButton({
  description,
  label,
  onPress,
  radio,
  selected,
}: {
  description?: string | undefined;
  label: string;
  onPress: () => void;
  radio?: boolean | undefined;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={radio ? "radio" : "checkbox"}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </Pressable>
  );
}

function FormButton({
  primary,
  danger,
  disabled,
  label,
  onPress,
}: {
  primary?: boolean;
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        danger && styles.buttonDanger,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          primary && styles.buttonPrimaryLabel,
          danger && styles.buttonDangerLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function numberConstraint(field: Extract<FormField, { type: "integer" | "number" }>) {
  const kind = field.type === "integer" ? "Whole number" : "Number";
  if (field.minimum !== undefined && field.maximum !== undefined) {
    return `${kind} from ${String(field.minimum)} to ${String(field.maximum)}`;
  }
  if (field.minimum !== undefined) return `${kind}, minimum ${String(field.minimum)}`;
  if (field.maximum !== undefined) return `${kind}, maximum ${String(field.maximum)}`;
  return kind;
}

export function openExternalFormUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    Alert.alert("Invalid link", "OpenCode supplied an invalid external form URL.");
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    Alert.alert("Unsupported link", "Only HTTP and HTTPS form links can be opened.");
    return;
  }
  Alert.alert(
    "Open external form?",
    `This leaves ${applicationName} and opens ${parsed.host}. The site will receive your device's network address.`,
    [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => void Linking.openURL(parsed.toString()).catch(() => undefined),
        text: "Open",
      },
    ],
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  booleanOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  button: {
    ...control,
    alignItems: "center",
    borderColor: palette.border,
    borderWidth: 1,
    justifyContent: "center",
  },
  buttonPrimary: { backgroundColor: palette.signal },
  buttonPrimaryLabel: { color: palette.background },
  buttonDanger: { borderColor: palette.border },
  buttonDangerLabel: { color: palette.danger },
  buttonLabel: { ...typography.control, color: palette.ink, textAlign: "center" },
  card: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space.md,
    padding: space.md,
  },
  choice: {
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 2,
    minHeight: 44,
    padding: space.sm,
  },
  choiceLabel: { color: palette.ink, fontSize: 14, fontWeight: "700" },
  choiceLabelSelected: { color: palette.signal },
  choiceSelected: { backgroundColor: palette.signalDark, borderColor: palette.signal },
  constraint: { ...typography.caption, color: palette.dim },
  description: { ...typography.caption, color: palette.dim },
  disabled: { opacity: 0.5 },
  error: { ...typography.body, color: palette.danger },
  eyebrow: { ...typography.heading, color: palette.warm },
  field: { gap: space.xs },
  fieldHeading: { gap: 2 },
  input: {
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: palette.ink,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  label: { ...typography.control, color: palette.ink },
  multilineInput: { minHeight: 88, textAlignVertical: "top" },
  options: { gap: space.xs },
  pressed: { opacity: 0.62 },
  title: { ...typography.heading, color: palette.ink },
});
