import Feather from "@expo/vector-icons/Feather";
import type {
  AgentInfo,
  CommandInfo,
  FileSystemEntry,
  LocationRef,
  ModelInfo,
  ModelRef,
  SkillInfo,
} from "@opencode2-mobile/opencode-adapter";
import { type RefObject, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { ModalSheet } from "../components/modal-sheet";
import { useDelayedVisibility } from "../components/use-delayed-visibility";
import { palette, radius, space, typeRamp, typography } from "../theme";
import {
  type CatalogState,
  type FavoriteControls,
  ModelPicker,
  PickerNotice,
} from "./model-picker";
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
  agentCatalog,
  modelCatalog,
  favorites,
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
  onDraftChange,
  onModelChange,
  onMentionSearchChange,
  onSubmit,
  onInterrupt,
  interruptDisabled = false,
  stopping = false,
  skills,
}: {
  active: boolean;
  agent?: string | undefined;
  agents: AgentInfo[];
  agentCatalog?: CatalogState;
  modelCatalog?: CatalogState;
  favorites?: FavoriteControls;
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
  onDraftChange: (draft: string, mentions: ComposerMention[]) => void;
  onModelChange: (model: ModelRef) => void;
  onMentionSearchChange: (query: string | undefined) => void;
  onSubmit: (intent: ComposerSubmitIntent) => void;
  onInterrupt?: (() => void) | undefined;
  interruptDisabled?: boolean;
  stopping?: boolean;
  skills: SkillInfo[];
}) {
  const inputRef = useRef<TextInput>(null);
  const modelSelectorRef = useRef<View>(null);
  const agentSelectorRef = useRef<View>(null);
  const variantSelectorRef = useRef<View>(null);
  const pickerReturnFocusRef = useRef(agentSelectorRef);
  const { fontScale } = useWindowDimensions();
  const [optionsPage, setOptionsPage] = useState<"agent" | "variant">();
  const [agentSearch, setAgentSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const agentPickerOpen = optionsPage === "agent";
  const variantPickerOpen = optionsPage === "variant";
  const [selection, setSelection] = useState({ end: draft.length, start: draft.length });
  const deferredAgentSearch = useDeferredValue(agentSearch.trim().toLocaleLowerCase());
  const selectedAgent = agents.find((candidate) => candidate.id === agent);
  const selectedModel = models.find(
    (candidate) => candidate.id === model?.id && candidate.providerID === model.providerID,
  );
  const visibleAgents = deferredAgentSearch
    ? agents.filter((candidate) =>
        `${candidate.name}\n${candidate.id}\n${candidate.description ?? ""}`
          .toLocaleLowerCase()
          .includes(deferredAgentSearch),
      )
    : agents;
  const expanded = largeText || focused || Boolean(optionsPage) || modelPickerOpen;
  const minimumInputHeight = Math.max(40, typography.chatBody.lineHeight * fontScale + 8);
  const maximumInputHeight = Math.max(120, minimumInputHeight * 2);
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
    !stopping &&
    !slashCatalogPending &&
    !slashCatalogUnavailable &&
    draft.trim().length > 0 &&
    (!active || delivery === "queue" || delivery === "steer");
  const showStop = active && draft.trim().length === 0 && Boolean(onInterrupt);

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
      <View style={[styles.surface, styles.surfaceExpanded]}>
        <View
          accessibilityLabel="Prompt editor"
          style={[styles.editorRow, expanded && styles.editorRowExpanded]}
        >
          <TextInput
            keyboardAppearance="dark"
            accessibilityHint="Enter inserts a new line. Use the Send button to submit."
            accessibilityLabel="Prompt"
            autoFocus={focusOnMount}
            editable={editable}
            maxLength={maximumDraftLength}
            multiline
            onBlur={() => setFocused(false)}
            onChangeText={changeDraft}
            onFocus={() => setFocused(true)}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            placeholder="Message"
            placeholderTextColor={palette.dim}
            ref={inputRef}
            returnKeyType="default"
            scrollEnabled={expanded}
            selectionColor={palette.signal}
            selection={selection}
            style={[
              styles.input,
              // iOS Fabric emits content-size changes during layout. Let native
              // text measurement grow the editor instead of fixing its height
              // and waiting for an event that requires that height to change.
              expanded
                ? [
                    styles.inputExpanded,
                    { minHeight: minimumInputHeight, maxHeight: maximumInputHeight },
                  ]
                : [
                    styles.inputCollapsed,
                    {
                      paddingVertical: Math.max(
                        0,
                        (42 - typography.chatBody.lineHeight * fontScale) / 2,
                      ),
                    },
                  ],
            ]}
            submitBehavior="newline"
            textAlignVertical={expanded ? "top" : "center"}
            value={draft}
          />
          <ComposerActionButton
            active={active}
            canSubmit={canSubmit}
            delivery={delivery}
            disabledHint={submitHint}
            showStop={showStop}
            stopDisabled={interruptDisabled || stopping}
            stopping={stopping}
            onPress={showStop ? () => onInterrupt?.() : submit}
          />
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

        <View style={styles.toolbar}>
          <ScrollView
            contentContainerStyle={styles.selectorRow}
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            style={styles.selectorScroller}
          >
            <SelectorButton
              compact
              label={modelLabel(selectedModel, model)}
              onPress={() => {
                Keyboard.dismiss();
                setModelPickerOpen(true);
              }}
              prefix="Model"
              buttonRef={modelSelectorRef}
            />
            <SelectorButton
              compact
              label={model?.variant ?? "Default"}
              prefix="Variant"
              buttonRef={variantSelectorRef}
              disabled={!selectedModel?.variants.length}
              onPress={() => {
                Keyboard.dismiss();
                pickerReturnFocusRef.current = variantSelectorRef;
                setOptionsPage("variant");
              }}
            />
            <SelectorButton
              compact
              label={selectedAgent?.name ?? agent ?? "Choose agent"}
              prefix="Agent"
              buttonRef={agentSelectorRef}
              onPress={() => {
                Keyboard.dismiss();
                setAgentSearch("");
                pickerReturnFocusRef.current = agentSelectorRef;
                setOptionsPage("agent");
              }}
            />
            {draft.length >= maximumDraftLength * 0.9 ? (
              <Text dynamicTypeRamp={typeRamp.caption} style={styles.count}>
                {draft.length.toLocaleString()} / {maximumDraftLength.toLocaleString()}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>

      {error ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.control} style={styles.error}>
          {error}
        </Text>
      ) : null}

      <ModalSheet
        onClose={() => {
          setOptionsPage(undefined);
          setAgentSearch("");
        }}
        size="page"
        scrollable={false}
        subtitle={
          agentPickerOpen
            ? "Primary agents available at this session location"
            : (selectedModel?.name ?? "Select a model first")
        }
        title={agentPickerOpen ? "Choose agent" : "Choose variant"}
        returnFocusRef={pickerReturnFocusRef.current}
        visible={optionsPage !== undefined}
      >
        {agentPickerOpen ? (
          <>
            <TextInput
              keyboardAppearance="dark"
              accessibilityLabel="Search agents"
              onChangeText={setAgentSearch}
              placeholder="Search agents"
              placeholderTextColor={palette.dim}
              style={styles.searchInput}
              value={agentSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {agentCatalog?.error ? (
              <PickerNotice text="Agents could not be loaded." retry={agentCatalog.retry} />
            ) : null}
            <FlatList
              accessibilityLabel="Agent results"
              contentContainerStyle={styles.pickerListContent}
              data={visibleAgents}
              ItemSeparatorComponent={OptionSeparator}
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              keyboardShouldPersistTaps="always"
              keyExtractor={(candidate) => candidate.id}
              ListEmptyComponent={
                <EmptyResults
                  label={
                    agentCatalog?.loading
                      ? "Loading agents"
                      : agentCatalog?.error
                        ? ""
                        : agentSearch.trim()
                          ? "No matching agents"
                          : "No primary agents available"
                  }
                />
              }
              renderItem={({ item: candidate }) => (
                <OptionButton
                  {...(candidate.description ? { description: candidate.description } : {})}
                  label={candidate.name}
                  onPress={() => {
                    onAgentChange(candidate.id);
                    setOptionsPage(undefined);
                  }}
                  selected={candidate.id === agent}
                />
              )}
              style={styles.pickerList}
            />
          </>
        ) : null}
        {variantPickerOpen && selectedModel ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.optionsContent}
          >
            <OptionButton
              label="Default"
              selected={!model?.variant}
              onPress={() => {
                onModelChange({ id: selectedModel.id, providerID: selectedModel.providerID });
                setOptionsPage(undefined);
              }}
            />
            {selectedModel.variants.map((variant) => (
              <OptionButton
                key={variant.id}
                label={variant.id}
                selected={variant.id === model?.variant}
                onPress={() => {
                  onModelChange({
                    id: selectedModel.id,
                    providerID: selectedModel.providerID,
                    variant: variant.id,
                  });
                  setOptionsPage(undefined);
                }}
              />
            ))}
          </ScrollView>
        ) : null}
      </ModalSheet>
      <ModelPicker
        onClose={() => setModelPickerOpen(false)}
        onSelect={onModelChange}
        models={models}
        returnFocusRef={modelSelectorRef}
        model={model}
        state={modelCatalog}
        favorites={favorites}
        visible={modelPickerOpen}
      />
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

function ComposerActionButton({
  active,
  canSubmit,
  delivery,
  disabledHint,
  onPress,
  showStop,
  stopDisabled,
  stopping,
}: {
  active: boolean;
  canSubmit: boolean;
  delivery?: PromptDelivery | undefined;
  disabledHint?: string | undefined;
  onPress: () => void;
  showStop: boolean;
  stopDisabled: boolean;
  stopping: boolean;
}) {
  const disabled = showStop ? stopDisabled : !canSubmit;
  const showStopUnavailable = useDelayedVisibility(showStop && disabled, "stop");
  return (
    <Pressable
      accessibilityLabel={
        showStop
          ? stopping
            ? "Stopping"
            : "Stop"
          : active && delivery === "queue"
            ? "Queue"
            : active && delivery === "steer"
              ? "Steer"
              : "Send"
      }
      accessibilityHint={
        showStop
          ? "Interrupts the current session"
          : (disabledHint ??
            (active && !delivery ? "Choose steer or queue before sending." : undefined))
      }
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}
    >
      <View
        testID="composer-submit-visual"
        pointerEvents="none"
        style={[
          styles.sendVisual,
          (showStop ? showStopUnavailable : disabled) && styles.sendButtonDisabled,
        ]}
      >
        {showStop ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.stopIcon}
          />
        ) : (
          <Feather accessible={false} color={palette.background} name="arrow-up" size={19} />
        )}
      </View>
    </Pressable>
  );
}

function SelectorButton({
  compact = false,
  buttonRef,
  disabled = false,
  label,
  onPress,
  prefix,
}: {
  compact?: boolean;
  buttonRef?: RefObject<View | null>;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  prefix: string;
}) {
  return (
    <Pressable
      accessibilityLabel={`${prefix}: ${label}`}
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectorButton,
        compact && styles.modelChip,
        disabled && styles.selectorDisabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        dynamicTypeRamp={typeRamp.control}
        numberOfLines={1}
        style={[styles.selectorLabel, compact && styles.modelChipLabel]}
      >
        {label}
      </Text>
      <Feather accessible={false} color={palette.dim} name="chevron-down" size={12} />
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
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        compact && styles.optionCompact,
        selected && styles.optionSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text dynamicTypeRamp={typeRamp.control} style={styles.optionLabel}>
        {selected ? "✓ " : ""}
        {label}
      </Text>
      {description ? (
        <Text dynamicTypeRamp={typeRamp.caption} numberOfLines={2} style={styles.optionDescription}>
          {description}
        </Text>
      ) : null}
    </Pressable>
  );
}

function modelLabel(model: ModelInfo | undefined, ref: ModelRef | undefined) {
  if (!model) return ref ? `${ref.providerID}/${ref.id}` : "Choose model";
  return model.name;
}

const styles = StyleSheet.create({
  modelChip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.lg,
    paddingHorizontal: space.sm,
  },
  modelChipLabel: { ...typography.compactControl, color: palette.ink },
  selectorDisabled: { opacity: 0.5 },
  optionsContent: { gap: space.sm },
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
  completionDetail: { ...typography.caption, color: palette.dim },
  completionHeading: { alignItems: "center", flexDirection: "row", gap: space.xs },
  completionKind: { ...typography.label, color: palette.dim },
  completionList: { maxHeight: 220 },
  completionListContent: { gap: 4 },
  completionName: { ...typography.control, color: palette.ink, flex: 1 },
  completionState: { color: palette.dim, paddingVertical: space.sm, textAlign: "center" },
  count: {
    ...typography.caption,
    alignSelf: "center",
    color: palette.dim,
    paddingHorizontal: space.xs,
  },
  editorRow: { alignItems: "center", flexDirection: "row", minWidth: 0 },
  editorRowExpanded: { alignItems: "stretch" },
  emptyResults: { color: palette.dim, paddingVertical: space.lg, textAlign: "center" },
  error: { ...typography.body, color: palette.danger },
  input: {
    ...typography.chatBody,
    color: palette.ink,
    flex: 1,
  },
  inputCollapsed: { height: 42, paddingHorizontal: 4, paddingVertical: 0 },
  inputExpanded: {
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
  optionDescription: { ...typography.caption, color: palette.dim, marginTop: 3 },
  optionLabel: { ...typography.heading, color: palette.ink },
  optionSelected: { backgroundColor: palette.signalDark, borderColor: palette.signal },
  optionSeparator: { height: space.xs },
  pickerList: { flex: 1 },
  pickerListContent: { flexGrow: 1, justifyContent: "flex-start" },
  pressed: { opacity: 0.62 },
  searchInput: {
    ...typography.body,
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: palette.ink,
    minHeight: 48,
    paddingHorizontal: space.md,
  },
  selectorButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    maxWidth: 180,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  selectorLabel: { ...typography.compactControl, color: palette.dim, flexShrink: 1 },
  selectorRow: { alignItems: "center", gap: space.xs, paddingRight: space.xs },
  selectorScroller: { flex: 1 },
  sendButton: {
    alignSelf: "flex-end",
    marginLeft: space.sm,
    alignItems: "center",
    borderRadius: 22,
    justifyContent: "center",
    height: 44,
    width: 44,
  },
  sendVisual: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: { backgroundColor: palette.border, opacity: 0.68 },
  stopIcon: { width: 12, height: 12, borderRadius: 2, backgroundColor: palette.background },
  shell: {
    backgroundColor: palette.background,
    gap: space.xs,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  surface: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  surfaceExpanded: {
    borderRadius: 10,
    gap: 2,
    paddingBottom: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  toolbar: { alignItems: "center", flexDirection: "row", gap: space.xs },
});
