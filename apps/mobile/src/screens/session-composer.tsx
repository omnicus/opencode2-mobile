import type { AgentInfo, ModelInfo, ModelRef } from "@opencode2-mobile/opencode-adapter";
import { useDeferredValue, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ModalSheet } from "../components/modal-sheet";
import { palette, radius, space, typeRamp } from "../theme";
import type { PromptDelivery } from "./prompt-admission-model";

const maximumDraftLength = 32_000;

export function SessionComposer({
  active,
  agent,
  agents,
  delivery,
  disabled,
  draft,
  editable = true,
  error,
  largeText,
  model,
  models,
  onAgentChange,
  onDeliveryChange,
  onDraftChange,
  onModelChange,
  onSubmit,
}: {
  active: boolean;
  agent?: string | undefined;
  agents: AgentInfo[];
  delivery?: PromptDelivery | undefined;
  disabled?: boolean | undefined;
  draft: string;
  editable?: boolean | undefined;
  error?: string | undefined;
  largeText: boolean;
  model?: ModelRef | undefined;
  models: ModelInfo[];
  onAgentChange: (agent: string) => void;
  onDeliveryChange: (delivery: PromptDelivery) => void;
  onDraftChange: (draft: string) => void;
  onModelChange: (model: ModelRef) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const deferredModelSearch = useDeferredValue(modelSearch.trim().toLocaleLowerCase());
  const selectedAgent = agents.find((candidate) => candidate.id === agent);
  const selectedModel = models.find(
    (candidate) => candidate.id === model?.id && candidate.providerID === model.providerID,
  );
  const visibleModels = deferredModelSearch
    ? models.filter((candidate) =>
        `${candidate.name}\n${candidate.providerID}\n${candidate.id}`
          .toLocaleLowerCase()
          .includes(deferredModelSearch),
      )
    : models;
  const expanded = largeText || focused || agentPickerOpen || modelPickerOpen;
  const canSubmit =
    !disabled &&
    draft.trim().length > 0 &&
    (!active || delivery === "queue" || delivery === "steer");

  function submit() {
    if (!canSubmit) return;
    onSubmit();
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <View accessibilityLabel="Session composer" style={styles.shell}>
      <View style={[styles.surface, expanded ? styles.surfaceExpanded : styles.surfaceCollapsed]}>
        <View
          accessibilityLabel="Prompt editor"
          style={[styles.editorRow, expanded && styles.editorRowExpanded]}
        >
          <TextInput
            accessibilityHint="Enter inserts a new line. Use the Send button to submit."
            accessibilityLabel="Prompt"
            editable={editable}
            maxLength={maximumDraftLength}
            multiline
            numberOfLines={expanded ? 4 : 1}
            onBlur={() => setFocused(false)}
            onChangeText={onDraftChange}
            onFocus={() => setFocused(true)}
            placeholder={active ? "Add a follow-up" : "Ask OpenCode"}
            placeholderTextColor={palette.dim}
            ref={inputRef}
            returnKeyType="default"
            scrollEnabled={expanded}
            selectionColor={palette.signal}
            style={[styles.input, expanded ? styles.inputExpanded : styles.inputCollapsed]}
            submitBehavior="newline"
            textAlignVertical={expanded ? "top" : "center"}
            value={draft}
          />
          {!expanded ? (
            <SendButton
              active={active}
              canSubmit={canSubmit}
              delivery={delivery}
              onPress={submit}
            />
          ) : null}
        </View>

        {expanded && active ? (
          <View accessibilityLabel="Prompt delivery" style={styles.deliveryRow}>
            <DeliveryButton
              active={delivery === "steer"}
              label="Steer now"
              onPress={() => onDeliveryChange("steer")}
            />
            <DeliveryButton
              active={delivery === "queue"}
              label="Queue next"
              onPress={() => onDeliveryChange("queue")}
            />
          </View>
        ) : null}

        {expanded ? (
          <View style={styles.toolbar}>
            <ScrollView
              contentContainerStyle={styles.selectorRow}
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              style={styles.selectorScroller}
            >
              <SelectorButton
                label={modelLabel(selectedModel, model)}
                onPress={() => setModelPickerOpen(true)}
                prefix="Model"
              />
              <SelectorButton
                label={selectedAgent?.name ?? agent ?? "Choose agent"}
                onPress={() => setAgentPickerOpen(true)}
                prefix="Agent"
              />
              {draft.length > 0 ? (
                <Text dynamicTypeRamp={typeRamp.caption} style={styles.count}>
                  {draft.length.toLocaleString()} / {maximumDraftLength.toLocaleString()}
                </Text>
              ) : null}
            </ScrollView>
            <SendButton
              active={active}
              canSubmit={canSubmit}
              delivery={delivery}
              onPress={submit}
            />
          </View>
        ) : null}
      </View>

      {error ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.control} style={styles.error}>
          {error}
        </Text>
      ) : null}

      <ModalSheet
        onClose={() => setAgentPickerOpen(false)}
        subtitle="Primary agents available at this session location"
        title="Choose agent"
        visible={agentPickerOpen}
      >
        {agents.map((candidate) => (
          <OptionButton
            {...(candidate.description ? { description: candidate.description } : {})}
            key={candidate.id}
            label={candidate.name}
            onPress={() => {
              onAgentChange(candidate.id);
              setAgentPickerOpen(false);
            }}
            selected={candidate.id === agent}
          />
        ))}
      </ModalSheet>

      <ModalSheet
        onClose={() => setModelPickerOpen(false)}
        subtitle="Enabled models and variants from the server catalog"
        title="Choose model"
        visible={modelPickerOpen}
      >
        <TextInput
          accessibilityLabel="Search models"
          onChangeText={setModelSearch}
          placeholder="Search models"
          placeholderTextColor={palette.dim}
          style={styles.searchInput}
          value={modelSearch}
        />
        {visibleModels.map((candidate) => (
          <View key={`${candidate.providerID}/${candidate.id}`} style={styles.modelGroup}>
            <OptionButton
              description={candidate.providerID}
              label={candidate.name}
              onPress={() => {
                onModelChange({ id: candidate.id, providerID: candidate.providerID });
                setModelPickerOpen(false);
              }}
              selected={
                candidate.id === model?.id &&
                candidate.providerID === model.providerID &&
                model.variant === undefined
              }
            />
            {candidate.variants.map((variant) => (
              <OptionButton
                compact
                description={`${candidate.providerID} variant`}
                key={variant.id}
                label={`${candidate.name} / ${variant.id}`}
                onPress={() => {
                  onModelChange({
                    id: candidate.id,
                    providerID: candidate.providerID,
                    variant: variant.id,
                  });
                  setModelPickerOpen(false);
                }}
                selected={
                  candidate.id === model?.id &&
                  candidate.providerID === model.providerID &&
                  variant.id === model.variant
                }
              />
            ))}
          </View>
        ))}
      </ModalSheet>
    </View>
  );
}

function SendButton({
  active,
  canSubmit,
  delivery,
  onPress,
}: {
  active: boolean;
  canSubmit: boolean;
  delivery?: PromptDelivery | undefined;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={active && !delivery ? "Choose steer or queue before sending." : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled: !canSubmit }}
      disabled={!canSubmit}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sendButton,
        !canSubmit && styles.sendButtonDisabled,
        pressed && styles.pressed,
      ]}
    >
      <Text dynamicTypeRamp={typeRamp.control} style={styles.sendLabel}>
        {active && delivery === "queue"
          ? "Queue"
          : active && delivery === "steer"
            ? "Steer"
            : "Send"}
      </Text>
    </Pressable>
  );
}

function SelectorButton({
  label,
  onPress,
  prefix,
}: {
  label: string;
  onPress: () => void;
  prefix: string;
}) {
  return (
    <Pressable
      accessibilityLabel={`${prefix}: ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.selectorButton, pressed && styles.pressed]}
    >
      <Text dynamicTypeRamp={typeRamp.caption} style={styles.selectorPrefix}>
        {prefix.toUpperCase()}
      </Text>
      <Text dynamicTypeRamp={typeRamp.control} numberOfLines={1} style={styles.selectorLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function DeliveryButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.deliveryButton,
        active && styles.deliveryButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Text
        dynamicTypeRamp={typeRamp.control}
        style={[styles.deliveryLabel, active && styles.deliveryLabelActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function OptionButton({
  compact,
  description,
  label,
  onPress,
  selected,
}: {
  compact?: boolean;
  description?: string | undefined;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        compact && styles.optionCompact,
        selected && styles.optionSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text dynamicTypeRamp={typeRamp.control} style={styles.optionLabel}>
        {label}
      </Text>
      {description ? (
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.optionDescription}>
          {description}
        </Text>
      ) : null}
    </Pressable>
  );
}

function modelLabel(model: ModelInfo | undefined, ref: ModelRef | undefined) {
  if (!model) return ref ? `${ref.providerID}/${ref.id}` : "Choose model";
  return ref?.variant ? `${model.name} / ${ref.variant}` : model.name;
}

const styles = StyleSheet.create({
  count: { alignSelf: "center", color: palette.dim, fontSize: 10, paddingHorizontal: space.xs },
  deliveryButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: space.sm,
  },
  deliveryButtonActive: { backgroundColor: palette.signalDark, borderColor: palette.signal },
  deliveryLabel: { color: palette.dim, fontSize: 14, fontWeight: "700" },
  deliveryLabelActive: { color: palette.signal },
  deliveryRow: { flexDirection: "row", gap: space.xs },
  editorRow: { alignItems: "center", flexDirection: "row", minWidth: 0 },
  editorRowExpanded: { alignItems: "stretch" },
  error: { color: palette.danger, fontSize: 13, lineHeight: 18 },
  input: {
    color: palette.ink,
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
  },
  inputCollapsed: { height: 42, paddingHorizontal: space.sm, paddingVertical: 0 },
  inputExpanded: {
    maxHeight: 160,
    minHeight: 72,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  modelGroup: { gap: space.xs },
  option: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 58,
    padding: space.md,
  },
  optionCompact: { marginLeft: space.md, minHeight: 50, paddingVertical: space.sm },
  optionDescription: { color: palette.dim, fontSize: 12, marginTop: 3 },
  optionLabel: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  optionSelected: { backgroundColor: palette.signalDark, borderColor: palette.signal },
  pressed: { opacity: 0.62 },
  searchInput: {
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: palette.ink,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: space.md,
  },
  selectorButton: {
    alignItems: "center",
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    maxWidth: 180,
    minHeight: 40,
    paddingHorizontal: space.sm,
  },
  selectorLabel: { color: palette.ink, flexShrink: 1, fontSize: 12, fontWeight: "700" },
  selectorPrefix: { color: palette.dim, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  selectorRow: { alignItems: "center", gap: space.xs, paddingRight: space.xs },
  selectorScroller: { flex: 1 },
  sendButton: {
    alignItems: "center",
    backgroundColor: palette.signal,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 68,
    paddingHorizontal: space.sm,
  },
  sendButtonDisabled: { backgroundColor: palette.border, opacity: 0.68 },
  sendLabel: { color: palette.background, fontSize: 14, fontWeight: "900" },
  shell: {
    backgroundColor: palette.background,
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  surface: {
    backgroundColor: "#171C19",
    borderColor: "#46514B",
    borderWidth: 1,
    overflow: "hidden",
  },
  surfaceCollapsed: {
    borderRadius: 999,
    minHeight: 52,
    paddingLeft: 12,
    paddingRight: 5,
  },
  surfaceExpanded: {
    borderColor: "#59665F",
    borderRadius: 26,
    gap: space.xs,
    minHeight: 140,
    paddingBottom: 6,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  toolbar: { alignItems: "center", flexDirection: "row", gap: space.xs },
});
