import type {
  AgentInfo,
  CommandInfo,
  FileSystemEntry,
  LocationRef,
  ModelInfo,
  ModelRef,
  SkillInfo,
} from "@opencode2-mobile/opencode-adapter";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ModalSheet } from "../components/modal-sheet";
import { palette, radius, space, typeRamp } from "../theme";
import type { PromptDelivery } from "./prompt-admission-model";
import {
  applyMentionCompletion,
  applySlashCompletion,
  type ComposerMention,
  type ComposerSubmitIntent,
  findMentionTrigger,
  listMentionCompletions,
  listSlashCompletions,
  type MentionCompletion,
  rebaseComposerMentions,
  resolveComposerSubmitIntent,
  type SlashCompletion,
} from "./session-composer-model";

const maximumDraftLength = 32_000;

export function SessionComposer({
  active,
  agent,
  agents,
  commands,
  completionLoading,
  completionUnavailable,
  delivery,
  disabled,
  draft,
  editable = true,
  error,
  focusOnMount,
  largeText,
  location,
  mentionAgents,
  mentionFiles,
  mentionLoading,
  mentions,
  mentionUnavailable,
  model,
  models,
  onAgentChange,
  onDeliveryChange,
  onDraftChange,
  onModelChange,
  onMentionSearchChange,
  onSubmit,
  skills,
}: {
  active: boolean;
  agent?: string | undefined;
  agents: AgentInfo[];
  commands: CommandInfo[];
  completionLoading?: boolean | undefined;
  completionUnavailable?: boolean | undefined;
  delivery?: PromptDelivery | undefined;
  disabled?: boolean | undefined;
  draft: string;
  editable?: boolean | undefined;
  error?: string | undefined;
  focusOnMount?: boolean | undefined;
  largeText: boolean;
  location: LocationRef;
  mentionAgents: AgentInfo[];
  mentionFiles: FileSystemEntry[];
  mentionLoading?: boolean | undefined;
  mentions: ComposerMention[];
  mentionUnavailable?: boolean | undefined;
  model?: ModelRef | undefined;
  models: ModelInfo[];
  onAgentChange: (agent: string) => void;
  onDeliveryChange: (delivery: PromptDelivery) => void;
  onDraftChange: (draft: string, mentions: ComposerMention[]) => void;
  onModelChange: (model: ModelRef) => void;
  onMentionSearchChange: (query: string | undefined) => void;
  onSubmit: (intent: ComposerSubmitIntent) => void;
  skills: SkillInfo[];
}) {
  const inputRef = useRef<TextInput>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [selection, setSelection] = useState({ end: draft.length, start: draft.length });
  const deferredModelSearch = useDeferredValue(modelSearch.trim().toLocaleLowerCase());
  const deferredAgentSearch = useDeferredValue(agentSearch.trim().toLocaleLowerCase());
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
  const visibleAgents = deferredAgentSearch
    ? agents.filter((candidate) =>
        `${candidate.name}\n${candidate.id}\n${candidate.description ?? ""}`
          .toLocaleLowerCase()
          .includes(deferredAgentSearch),
      )
    : agents;
  const expanded = largeText || focused || agentPickerOpen || modelPickerOpen;
  const completions = listSlashCompletions(draft, commands);
  const mentionTrigger = findMentionTrigger(draft, selection);
  const mentionCompletions = mentionTrigger
    ? listMentionCompletions(mentionTrigger.query, mentionAgents, skills, mentionFiles)
    : [];
  const submitIntent = resolveComposerSubmitIntent(draft, commands, mentions, location);
  const slashCatalogPending = completionLoading && draft.startsWith("/");
  const slashCatalogUnavailable = completionUnavailable && draft.startsWith("/");
  const submitHint = slashCatalogPending
    ? "Wait for commands to load."
    : slashCatalogUnavailable
      ? "Commands are unavailable."
      : undefined;
  const canSubmit =
    !disabled &&
    !slashCatalogPending &&
    !slashCatalogUnavailable &&
    draft.trim().length > 0 &&
    (!active || delivery === "queue" || delivery === "steer");

  useEffect(() => {
    if (!focusOnMount || !editable) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editable, focusOnMount]);

  useEffect(() => {
    if (!focused) {
      setSelection({ end: draft.length, start: draft.length });
      return;
    }
    setSelection((current) =>
      current.end <= draft.length ? current : { end: draft.length, start: draft.length },
    );
  }, [draft, focused]);

  useEffect(() => {
    onMentionSearchChange(mentionTrigger?.query);
  }, [mentionTrigger?.query, onMentionSearchChange]);

  useEffect(
    () => () => {
      onMentionSearchChange(undefined);
    },
    [onMentionSearchChange],
  );

  function submit() {
    if (!canSubmit) return;
    inputRef.current?.blur();
    setFocused(false);
    Keyboard.dismiss();
    onSubmit(submitIntent);
  }

  function changeDraft(nextDraft: string) {
    onDraftChange(nextDraft, rebaseComposerMentions(draft, nextDraft, mentions, selection));
  }

  function selectCompletion(completion: (typeof completions)[number]) {
    const nextDraft = applySlashCompletion(draft, completion);
    onDraftChange(nextDraft, mentions);
    setSelection({ end: nextDraft.length, start: nextDraft.length });
    inputRef.current?.focus();
  }

  function selectMention(completion: MentionCompletion) {
    if (!mentionTrigger) return;
    const next = applyMentionCompletion(draft, mentionTrigger, completion, mentions);
    onDraftChange(next.draft, next.mentions);
    setSelection(next.selection);
    inputRef.current?.focus();
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
            autoFocus={focusOnMount}
            editable={editable}
            maxLength={maximumDraftLength}
            multiline
            numberOfLines={expanded ? 4 : 1}
            onBlur={() => setFocused(false)}
            onChangeText={changeDraft}
            onFocus={() => setFocused(true)}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            placeholder={active ? "Add a follow-up" : "Ask OpenCode"}
            placeholderTextColor={palette.dim}
            ref={inputRef}
            returnKeyType="default"
            scrollEnabled={expanded}
            selectionColor={palette.signal}
            selection={selection}
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
              disabledHint={submitHint}
              onPress={submit}
            />
          ) : null}
        </View>

        {expanded && /^\/[^\s/]*$/.test(draft) ? (
          <ScrollView
            accessibilityLabel="Command suggestions"
            contentContainerStyle={styles.completionListContent}
            keyboardShouldPersistTaps="always"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={styles.completionList}
          >
            {completions.length > 0 ? (
              completions.map((completion) => (
                <CompletionButton
                  completion={completion}
                  key={`command:${completion.name}`}
                  onPress={() => selectCompletion(completion)}
                />
              ))
            ) : (
              <Text dynamicTypeRamp={typeRamp.caption} style={styles.completionState}>
                {completionLoading
                  ? "Loading commands"
                  : completionUnavailable
                    ? "Commands are unavailable"
                    : "No matching commands"}
              </Text>
            )}
          </ScrollView>
        ) : null}

        {expanded && mentionTrigger ? (
          <ScrollView
            accessibilityLabel="File, skill, and agent suggestions"
            contentContainerStyle={styles.completionListContent}
            keyboardShouldPersistTaps="always"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={styles.completionList}
          >
            {mentionCompletions.map((completion) => (
              <MentionButton
                completion={completion}
                key={mentionCompletionKey(completion)}
                onPress={() => selectMention(completion)}
              />
            ))}
            {mentionCompletions.length === 0 || mentionLoading || mentionUnavailable ? (
              <Text dynamicTypeRamp={typeRamp.caption} style={styles.completionState}>
                {mentionLoading
                  ? "Searching files, skills, and agents"
                  : mentionUnavailable
                    ? "Some mention results are unavailable"
                    : "No matching files, skills, or agents"}
              </Text>
            ) : null}
          </ScrollView>
        ) : null}

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
                onPress={() => {
                  setAgentSearch("");
                  setAgentPickerOpen(true);
                }}
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
              disabledHint={submitHint}
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
        scrollable={false}
        subtitle="Primary agents available at this session location"
        title="Choose agent"
        visible={agentPickerOpen}
      >
        <FlatList
          accessibilityLabel="Agent results"
          contentContainerStyle={styles.pickerListContent}
          data={visibleAgents}
          inverted
          ItemSeparatorComponent={OptionSeparator}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="always"
          keyExtractor={(candidate) => candidate.id}
          ListEmptyComponent={<EmptyResults label="No matching agents" />}
          renderItem={({ item: candidate }) => (
            <OptionButton
              {...(candidate.description ? { description: candidate.description } : {})}
              label={candidate.name}
              onPress={() => {
                onAgentChange(candidate.id);
                setAgentPickerOpen(false);
              }}
              selected={candidate.id === agent}
            />
          )}
          style={styles.pickerList}
        />
        <TextInput
          accessibilityLabel="Search agents"
          onChangeText={setAgentSearch}
          placeholder="Search agents"
          placeholderTextColor={palette.dim}
          style={styles.searchInput}
          value={agentSearch}
        />
      </ModalSheet>

      <ModalSheet
        onClose={() => setModelPickerOpen(false)}
        scrollable={false}
        subtitle="Enabled models and variants from the server catalog"
        title="Choose model"
        visible={modelPickerOpen}
      >
        <FlatList
          accessibilityLabel="Model results"
          contentContainerStyle={styles.pickerListContent}
          data={visibleModels}
          inverted
          ItemSeparatorComponent={OptionSeparator}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="always"
          keyExtractor={(candidate) => `${candidate.providerID}/${candidate.id}`}
          ListEmptyComponent={<EmptyResults label="No matching models" />}
          renderItem={({ item: candidate }) => (
            <View style={styles.modelGroup}>
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
          )}
          style={styles.pickerList}
        />
        <TextInput
          accessibilityLabel="Search models"
          onChangeText={setModelSearch}
          placeholder="Search models"
          placeholderTextColor={palette.dim}
          style={styles.searchInput}
          value={modelSearch}
        />
      </ModalSheet>
    </View>
  );
}

function OptionSeparator() {
  return <View style={styles.optionSeparator} />;
}

function CompletionButton({
  completion,
  onPress,
}: {
  completion: SlashCompletion;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={
        completion.label !== completion.name || completion.description
          ? [completion.label, completion.description].filter(Boolean).join(". ")
          : undefined
      }
      accessibilityLabel={`/${completion.name}, command`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.completion, pressed && styles.pressed]}
    >
      <View style={styles.completionHeading}>
        <Text dynamicTypeRamp={typeRamp.control} numberOfLines={1} style={styles.completionName}>
          /{completion.name}
        </Text>
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.completionKind}>
          COMMAND
        </Text>
      </View>
      {completion.label !== completion.name || completion.description ? (
        <Text dynamicTypeRamp={typeRamp.caption} numberOfLines={2} style={styles.completionDetail}>
          {[
            completion.label !== completion.name ? completion.label : undefined,
            completion.description,
          ]
            .filter(Boolean)
            .join(" / ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

function MentionButton({
  completion,
  onPress,
}: {
  completion: MentionCompletion;
  onPress: () => void;
}) {
  const value =
    completion.type === "file"
      ? completion.path
      : completion.type === "agent"
        ? completion.name
        : completion.id;
  return (
    <Pressable
      accessibilityHint={
        completion.label !== value || completion.description
          ? [completion.label, completion.description].filter(Boolean).join(". ")
          : undefined
      }
      accessibilityLabel={`@${value}, ${completion.type}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.completion, pressed && styles.pressed]}
    >
      <View style={styles.completionHeading}>
        <Text dynamicTypeRamp={typeRamp.control} numberOfLines={1} style={styles.completionName}>
          @{value}
        </Text>
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.completionKind}>
          {completion.type.toUpperCase()}
        </Text>
      </View>
      {completion.label !== value || completion.description ? (
        <Text dynamicTypeRamp={typeRamp.caption} numberOfLines={2} style={styles.completionDetail}>
          {[completion.label !== value ? completion.label : undefined, completion.description]
            .filter(Boolean)
            .join(" / ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

function mentionCompletionKey(completion: MentionCompletion) {
  return completion.type === "file"
    ? `file:${completion.path}`
    : completion.type === "agent"
      ? `agent:${completion.name}`
      : `skill:${completion.id}`;
}

function EmptyResults({ label }: { label: string }) {
  return (
    <Text dynamicTypeRamp={typeRamp.control} style={styles.emptyResults}>
      {label}
    </Text>
  );
}

function SendButton({
  active,
  canSubmit,
  delivery,
  disabledHint,
  onPress,
}: {
  active: boolean;
  canSubmit: boolean;
  delivery?: PromptDelivery | undefined;
  disabledHint?: string | undefined;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={
        disabledHint ?? (active && !delivery ? "Choose steer or queue before sending." : undefined)
      }
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
  completion: {
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 2,
    minHeight: 48,
    paddingHorizontal: space.sm,
    paddingVertical: 7,
  },
  completionDetail: { color: palette.dim, fontSize: 12, lineHeight: 16 },
  completionHeading: { alignItems: "center", flexDirection: "row", gap: space.xs },
  completionKind: { color: palette.dim, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  completionList: { maxHeight: 220 },
  completionListContent: { gap: 4 },
  completionName: { color: palette.ink, flex: 1, fontSize: 14, fontWeight: "800" },
  completionState: { color: palette.dim, paddingVertical: space.sm, textAlign: "center" },
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
  emptyResults: { color: palette.dim, paddingVertical: space.lg, textAlign: "center" },
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
  optionSeparator: { height: space.xs },
  pickerList: { flex: 1 },
  pickerListContent: { flexGrow: 1, justifyContent: "flex-start" },
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
