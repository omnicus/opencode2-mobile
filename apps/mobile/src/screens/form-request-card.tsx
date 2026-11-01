import Feather from "@expo/vector-icons/Feather";
import type { FormAnswer, FormField, FormInfo } from "@opencode2-mobile/opencode-adapter";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { applicationName } from "../application-name";
import { Button } from "../components/button";
import { ModalSheet } from "../components/modal-sheet";
import { requestCardStyles } from "../components/request-card-styles";
import { announceOnIOS, useAnnouncement } from "../components/use-announcement";
import {
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  space,
  typeRamp,
  typography,
} from "../theme";
import {
  createFormDraft,
  type FormDraft,
  validateFormDraft,
  visibleFormFieldKeys,
} from "./form-response-model";
import { sanitizeTranscriptText } from "./session-transcript-model";

export function FormRequestCard({
  allowFocus = false,
  busy,
  error,
  form,
  onCancel,
  onOpenExternal = openExternalFormUrl,
  onSubmit,
}: {
  allowFocus?: boolean;
  busy?: boolean;
  error?: string;
  form: FormInfo;
  onCancel: () => void;
  onOpenExternal?: (url: string) => void;
  onSubmit: (answer: FormAnswer) => void;
}) {
  const [draft, setDraft] = useState<FormDraft>(() => createFormDraft(form));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState(false);
  const reviewRef = useRef<View>(null);
  useEffect(() => {
    if (!allowFocus) setFocused(false);
  }, [allowFocus]);

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
    if (result.valid) {
      onSubmit(result.answer);
      return;
    }
    const invalid = Object.keys(result.errors).length;
    announceOnIOS(invalid === 1 ? "1 answer needs attention" : `${invalid} answers need attention`);
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
  const answerFields = form.fields.filter(
    (field) => field.type !== "external" && visibleKeys.has(field.key),
  );
  const answered = answerFields.filter((field) => {
    const value = draft[field.key];
    return (
      value !== undefined &&
      (typeof value === "string"
        ? value.trim().length > 0
        : Array.isArray(value)
          ? value.length > 0
          : true)
    );
  }).length;
  const progressText =
    answerFields.length > 1 ? `${answered} of ${answerFields.length} answered` : undefined;
  const announcedProgress = useRef(progressText);
  useEffect(() => {
    if (announcedProgress.current === progressText) return;
    announcedProgress.current = progressText;
    announceOnIOS(progressText);
  }, [progressText]);
  useAnnouncement(busy && "Submitting answers…");
  useAnnouncement(error);
  const progress = progressText ? (
    <Text
      accessibilityLiveRegion="polite"
      dynamicTypeRamp={typeRamp.footnote}
      style={styles.description}
    >
      {progressText}
    </Text>
  ) : null;
  const fields = (
    <>
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
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
          {error}
        </Text>
      ) : null}
    </>
  );
  const actions = (
    <View style={[styles.actions, allowFocus && styles.focusedActions]}>
      <Button
        variant="primary"
        busy={Boolean(busy)}
        label={busy ? "Submitting" : allowFocus ? "Send answers" : "Submit"}
        onPress={submit}
        style={styles.actionButton}
      />
      <Button
        variant="danger"
        disabled={Boolean(busy)}
        label="Cancel form"
        onPress={confirmCancel}
        style={styles.actionButton}
      />
    </View>
  );
  return (
    <>
      <View accessibilityLabel={`Form: ${form.title}`} style={styles.card}>
        <View style={styles.eyebrowRow}>
          <Feather accessible={false} name="edit-3" size={14} color={palette.warm} />
          <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.eyebrow}>
            Input required
          </Text>
        </View>
        <Text accessibilityRole="header" dynamicTypeRamp={typeRamp.headline} style={styles.title}>
          {sanitizeTranscriptText(form.title, 512)}
        </Text>
        {progress}
        {allowFocus ? (
          <Pressable
            ref={reviewRef}
            accessibilityRole="button"
            accessibilityLabel="Review input request"
            accessibilityHint="Opens the form with answer actions below the fields"
            android_ripple={Platform.OS === "android" ? ripple : undefined}
            onPress={() => setFocused(true)}
            style={({ pressed }) => [
              styles.button,
              styles.buttonPrimary,
              pressed && Platform.OS === "ios" && styles.pressed,
            ]}
          >
            <Text
              dynamicTypeRamp={typeRamp.control}
              style={[styles.buttonLabel, styles.buttonPrimaryLabel]}
            >
              Review and answer
            </Text>
          </Pressable>
        ) : (
          <>
            {fields}
            {actions}
          </>
        )}
      </View>
      {allowFocus && !focused && error ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
          {error}
        </Text>
      ) : null}
      {allowFocus ? (
        <ModalSheet
          title="Answer request"
          visible={focused}
          onClose={() => setFocused(false)}
          size="full"
          scrollable={false}
          returnFocusRef={reviewRef}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.focusedFields}
            contentContainerStyle={styles.focusedContent}
          >
            <Text
              accessibilityRole="header"
              dynamicTypeRamp={typeRamp.headline}
              style={styles.title}
            >
              {sanitizeTranscriptText(form.title, 512)}
            </Text>
            {progress}
            {fields}
          </ScrollView>
          {actions}
        </ModalSheet>
      ) : null}
    </>
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
        <Button fullWidth label="Open external form" onPress={() => onOpenExternal(field.url)} />
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
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.description}>
          Choose any that apply
        </Text>
        <View accessibilityLabel={title} role="group" style={styles.options}>
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
          <CustomValuesInput
            initialValues={customValues}
            onChange={(values) =>
              onChange([...selected.filter((value) => optionValues.has(value)), ...values])
            }
            title={title}
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
        <>
          <Text dynamicTypeRamp={typeRamp.footnote} style={styles.description}>
            Choose one
          </Text>
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
        </>
      ) : null}
      {field.type !== "string" || !field.options || field.custom ? (
        <TextInput
          keyboardAppearance="dark"
          accessibilityLabel={title}
          autoCapitalize={
            field.type === "string" && (field.format === "email" || field.format === "uri")
              ? "none"
              : "sentences"
          }
          autoCorrect={
            !(field.type === "string" && (field.format === "email" || field.format === "uri"))
          }
          // numbers-and-punctuation is iOS-only; both keyboards include the minus sign.
          keyboardType={
            field.type === "number" || field.type === "integer"
              ? Platform.OS === "ios"
                ? "numbers-and-punctuation"
                : "numeric"
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
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.description}>
          {numberConstraint(field)}
        </Text>
      ) : null}
      <FieldError error={error} />
    </View>
  );
}

function CustomValuesInput({
  initialValues,
  onChange,
  title,
}: {
  initialValues: string[];
  onChange: (values: string[]) => void;
  title: string;
}) {
  // Keep the typed text so spaces and new lines survive; only the parsed values reach the draft.
  const [text, setText] = useState(() => initialValues.join("\n"));
  const values = parseCustomValues(text);
  return (
    <View style={styles.field}>
      <TextInput
        keyboardAppearance="dark"
        accessibilityHint="Enter one value per line"
        accessibilityLabel={`${title} custom values`}
        multiline
        onChangeText={(next) => {
          setText(next);
          onChange(parseCustomValues(next));
        }}
        placeholder="Other values, one per line"
        placeholderTextColor={palette.dim}
        style={[styles.input, styles.multilineInput]}
        value={text}
      />
      <Text dynamicTypeRamp={typeRamp.footnote} style={styles.description}>
        One value per line · {values.length} {values.length === 1 ? "value" : "values"}
      </Text>
    </View>
  );
}

function parseCustomValues(text: string) {
  return text
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
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
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.description}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

function FieldError({ error }: { error?: string | undefined }) {
  return error ? (
    <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
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
      android_ripple={Platform.OS === "android" ? ripple : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceSelected,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
    >
      <View style={styles.choiceHeading}>
        <Feather
          accessible={false}
          name={selected ? "check-circle" : radio ? "circle" : "square"}
          size={18}
          color={selected ? palette.signal : palette.dim}
        />
        <Text
          dynamicTypeRamp={typeRamp.control}
          style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}
        >
          {label}
        </Text>
      </View>
      {description ? (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.description}>
          {description}
        </Text>
      ) : null}
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

const ripple = { color: "rgba(255,255,255,0.12)" };

const styles = StyleSheet.create({
  focusedFields: { flex: 1 },
  focusedContent: { gap: space.md, paddingBottom: space.md },
  focusedActions: {
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  choiceHeading: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  actions: requestCardStyles.actions,
  actionButton: { flexGrow: 1, maxWidth: "100%" },
  booleanOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  button: requestCardStyles.button,
  buttonPrimary: { backgroundColor: palette.signal, borderColor: palette.signal },
  buttonPrimaryLabel: { color: palette.background },
  buttonLabel: requestCardStyles.buttonLabel,
  card: requestCardStyles.card,
  choice: {
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: minTouchTarget,
    overflow: "hidden",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  choiceLabel: { ...typography.control, color: palette.ink, flexShrink: 1 },
  choiceLabelSelected: { color: palette.signal },
  choiceSelected: { backgroundColor: palette.signalDark, borderColor: palette.signal },
  description: { ...typography.footnote, color: palette.dim },
  error: { ...typography.subheadline, color: palette.danger },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  eyebrow: { ...typography.sectionLabel, color: palette.warm, flexShrink: 1 },
  field: { gap: space.xs },
  fieldHeading: { gap: 2 },
  input: {
    ...typography.body,
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: palette.ink,
    minHeight: minTouchTarget,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  label: { ...typography.control, color: palette.ink },
  multilineInput: { minHeight: 88, textAlignVertical: "top" },
  options: { gap: space.xs },
  pressed: { opacity: pressedOpacity },
  title: { ...typography.headline, color: palette.ink },
});
