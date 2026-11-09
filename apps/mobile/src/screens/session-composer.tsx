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
import {
  type ReactNode,
  type RefObject,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Keyboard,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputSelectionChangeEventData,
  useWindowDimensions,
  View,
} from "react-native";

import { ModalSheet } from "../components/modal-sheet";
import { SearchField } from "../components/search-field";
import { useDelayedVisibility } from "../components/use-delayed-visibility";
import {
  disabledOpacity,
  minTouchTarget,
  palette,
  pressedOpacity,
  radius,
  rippleFeedback,
  space,
  typeRamp,
  typography,
} from "../theme";
import {
  type CatalogState,
  type FavoriteControls,
  ModelPicker,
  PickerNotice,
} from "./model-picker";
import type { PromptDelivery } from "./prompt-admission-model";
import {
  agentPickerEmptyLabel,
  applyMentionCompletion,
  applySlashCompletion,
  type ComposerMention,
  type ComposerSubmitIntent,
  commandCompletionStatus,
  filterComposerAgents,
  findMentionTrigger,
  listMentionCompletions,
  listSlashCompletions,
  type MentionCompletion,
  mentionCompletionKey,
  mentionCompletionStatus,
  mentionValue,
  rebaseComposerMentions,
  resolveComposerSubmitIntent,
  resolveComposerSubmitState,
  type SlashCompletion,
} from "./session-composer-model";

const maximumDraftLength = 32_000;
// A second tap on Send lands where Stop appears once the session starts, so keep Send for a moment.
const stopAfterSendDelayMs = 600;

type OptionsPage = "agent" | "variant";
type DraftSelection = { end: number; start: number };

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
  const [optionsPage, setOptionsPage] = useState<OptionsPage>();
  const [agentSearch, setAgentSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [justSent, markSent] = useJustSent();
  const [selection, setSelection] = useState({ end: draft.length, start: draft.length });
  const deferredAgentSearch = useDeferredValue(agentSearch.trim().toLocaleLowerCase());
  const selectedModel = findModel(models, model);
  const expanded = largeText || focused || Boolean(optionsPage) || modelPickerOpen;
  const mentionTrigger = findMentionTrigger(draft, selection);
  const submitIntent = resolveComposerSubmitIntent(draft, commands, mentions, location);
  const { canSubmit, showStop, submitHint } = resolveComposerSubmitState({
    active,
    completionLoading,
    completionUnavailable,
    delivery,
    disabled,
    draft,
    interruptible: Boolean(onInterrupt),
    justSent,
    stopping,
  });

  useFocusOnMount(inputRef, focusOnMount, editable);
  useSelectionWithinDraft(draft, focused, setSelection);
  useMentionSearch(mentionTrigger?.query, onMentionSearchChange);

  function submit() {
    if (!canSubmit) return;
    inputRef.current?.blur();
    setFocused(false);
    Keyboard.dismiss();
    markSent();
    onSubmit(submitIntent);
  }

  function changeDraft(nextDraft: string) {
    onDraftChange(nextDraft, rebaseComposerMentions(draft, nextDraft, mentions, selection));
  }

  function selectCompletion(completion: SlashCompletion) {
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

  const actionButton = (
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
  );

  return (
    <View accessibilityLabel="Session composer" style={styles.shell}>
      <View style={[styles.surface, expanded && styles.surfaceExpanded]}>
        <View
          accessibilityLabel="Prompt editor"
          style={[styles.editorRow, expanded && styles.editorRowExpanded]}
        >
          <PromptInput
            draft={draft}
            editable={editable}
            expanded={expanded}
            focusOnMount={focusOnMount}
            inputRef={inputRef}
            onChangeText={changeDraft}
            onFocusChange={setFocused}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            selection={selection}
          />
          {/* Collapsed, send sits beside the text; expanded, it joins the toolbar so text gets the full width. */}
          {expanded ? null : actionButton}
        </View>

        {expanded ? (
          <>
            <CommandSuggestions
              commands={commands}
              draft={draft}
              loading={completionLoading}
              onSelect={selectCompletion}
              unavailable={completionUnavailable}
            />
            {mentionTrigger ? (
              <MentionSuggestions
                completions={listMentionCompletions(
                  mentionTrigger.query,
                  mentionAgents,
                  skills,
                  mentionFiles,
                )}
                loading={mentionLoading}
                onSelect={selectMention}
                unavailable={mentionUnavailable}
              />
            ) : null}
            {/* Model, variant, and agent appear once the composer expands for input. */}
            <ComposerToolbar
              agent={agent}
              agentSelectorRef={agentSelectorRef}
              agents={agents}
              draftLength={draft.length}
              model={model}
              modelSelectorRef={modelSelectorRef}
              onAgentPress={() => {
                Keyboard.dismiss();
                setAgentSearch("");
                pickerReturnFocusRef.current = agentSelectorRef;
                setOptionsPage("agent");
              }}
              onModelPress={() => {
                Keyboard.dismiss();
                setModelPickerOpen(true);
              }}
              onVariantPress={() => {
                Keyboard.dismiss();
                pickerReturnFocusRef.current = variantSelectorRef;
                setOptionsPage("variant");
              }}
              selectedModel={selectedModel}
              trailing={actionButton}
              variantSelectorRef={variantSelectorRef}
            />
          </>
        ) : null}
      </View>

      {error ? (
        <Text accessibilityRole="alert" dynamicTypeRamp={typeRamp.subheadline} style={styles.error}>
          {error}
        </Text>
      ) : null}

      <ComposerOptionsSheet
        agent={agent}
        agentCatalog={agentCatalog}
        agentSearch={agentSearch}
        agents={filterComposerAgents(agents, deferredAgentSearch)}
        model={model}
        onAgentChange={(nextAgent) => {
          onAgentChange(nextAgent);
          setOptionsPage(undefined);
        }}
        onAgentSearchChange={setAgentSearch}
        onClose={() => {
          setOptionsPage(undefined);
          setAgentSearch("");
        }}
        onModelChange={(nextModel) => {
          onModelChange(nextModel);
          setOptionsPage(undefined);
        }}
        page={optionsPage}
        returnFocusRef={pickerReturnFocusRef.current}
        selectedModel={selectedModel}
      />
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

function useJustSent() {
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    if (!justSent) return;
    const timer = setTimeout(() => setJustSent(false), stopAfterSendDelayMs);
    return () => clearTimeout(timer);
  }, [justSent]);

  return [justSent, () => setJustSent(true)] as const;
}

function useFocusOnMount(
  inputRef: RefObject<TextInput | null>,
  focusOnMount: boolean | undefined,
  editable: boolean,
) {
  useEffect(() => {
    if (!focusOnMount || !editable) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editable, focusOnMount, inputRef]);
}

function useSelectionWithinDraft(
  draft: string,
  focused: boolean,
  setSelection: (update: (current: DraftSelection) => DraftSelection) => void,
) {
  useEffect(() => {
    setSelection((current) =>
      focused && current.end <= draft.length ? current : { end: draft.length, start: draft.length },
    );
  }, [draft, focused, setSelection]);
}

function useMentionSearch(
  query: string | undefined,
  onMentionSearchChange: (query: string | undefined) => void,
) {
  useEffect(() => {
    onMentionSearchChange(query);
  }, [query, onMentionSearchChange]);

  useEffect(
    () => () => {
      onMentionSearchChange(undefined);
    },
    [onMentionSearchChange],
  );
}

function PromptInput({
  draft,
  editable,
  expanded,
  focusOnMount,
  inputRef,
  onChangeText,
  onFocusChange,
  onSelectionChange,
  selection,
}: {
  draft: string;
  editable: boolean;
  expanded: boolean;
  focusOnMount: boolean | undefined;
  inputRef: RefObject<TextInput | null>;
  onChangeText: (draft: string) => void;
  onFocusChange: (focused: boolean) => void;
  onSelectionChange: (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  selection: DraftSelection;
}) {
  const { fontScale } = useWindowDimensions();
  const minimumInputHeight = Math.max(40, typography.chatBody.lineHeight * fontScale + 8);
  const maximumInputHeight = Math.max(120, minimumInputHeight * 2);
  return (
    <TextInput
      keyboardAppearance="dark"
      accessibilityHint="Enter inserts a new line. Use the Send button to submit."
      accessibilityLabel="Prompt"
      autoFocus={focusOnMount}
      editable={editable}
      maxLength={maximumDraftLength}
      multiline
      onBlur={() => onFocusChange(false)}
      onChangeText={onChangeText}
      onFocus={() => onFocusChange(true)}
      onSelectionChange={onSelectionChange}
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
          ? [styles.inputExpanded, { minHeight: minimumInputHeight, maxHeight: maximumInputHeight }]
          : [
              styles.inputCollapsed,
              {
                paddingVertical: Math.max(0, (42 - typography.chatBody.lineHeight * fontScale) / 2),
              },
            ],
      ]}
      submitBehavior="newline"
      textAlignVertical={expanded ? "top" : "center"}
      value={draft}
    />
  );
}

function CommandSuggestions({
  commands,
  draft,
  loading,
  onSelect,
  unavailable,
}: {
  commands: CommandInfo[];
  draft: string;
  loading: boolean | undefined;
  onSelect: (completion: SlashCompletion) => void;
  unavailable: boolean | undefined;
}) {
  if (!/^\/[^\s/]*$/.test(draft)) return null;
  const completions = listSlashCompletions(draft, commands);
  return (
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
            onPress={() => onSelect(completion)}
          />
        ))
      ) : (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.completionState}>
          {commandCompletionStatus(loading, unavailable)}
        </Text>
      )}
    </ScrollView>
  );
}

function MentionSuggestions({
  completions,
  loading,
  onSelect,
  unavailable,
}: {
  completions: MentionCompletion[];
  loading: boolean | undefined;
  onSelect: (completion: MentionCompletion) => void;
  unavailable: boolean | undefined;
}) {
  return (
    <ScrollView
      accessibilityLabel="File, skill, and agent suggestions"
      contentContainerStyle={styles.completionListContent}
      keyboardShouldPersistTaps="always"
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      style={styles.completionList}
    >
      {completions.map((completion) => (
        <MentionButton
          completion={completion}
          key={mentionCompletionKey(completion)}
          onPress={() => onSelect(completion)}
        />
      ))}
      {completions.length === 0 || loading || unavailable ? (
        <Text dynamicTypeRamp={typeRamp.footnote} style={styles.completionState}>
          {mentionCompletionStatus(loading, unavailable)}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function ComposerToolbar({
  agent,
  agentSelectorRef,
  agents,
  draftLength,
  model,
  modelSelectorRef,
  onAgentPress,
  onModelPress,
  onVariantPress,
  selectedModel,
  trailing,
  variantSelectorRef,
}: {
  agent: string | undefined;
  agentSelectorRef: RefObject<View | null>;
  agents: AgentInfo[];
  draftLength: number;
  model: ModelRef | undefined;
  modelSelectorRef: RefObject<View | null>;
  onAgentPress: () => void;
  onModelPress: () => void;
  onVariantPress: () => void;
  selectedModel: ModelInfo | undefined;
  trailing: ReactNode;
  variantSelectorRef: RefObject<View | null>;
}) {
  const selectedAgent = agents.find((candidate) => candidate.id === agent);
  return (
    <View style={styles.toolbar}>
      <ScrollView
        contentContainerStyle={styles.selectorRow}
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        style={styles.selectorScroller}
      >
        {/* Agent, then model, then its variant, so "Build  Opus 5.5  High" reads as one phrase. */}
        <SelectorButton
          label={
            selectedAgent || agent
              ? agentDisplayName(selectedAgent?.name ?? agent ?? "")
              : "Choose agent"
          }
          prefix="Agent"
          buttonRef={agentSelectorRef}
          onPress={onAgentPress}
        />
        <SelectorButton
          chevron={false}
          emphasis
          label={modelLabel(selectedModel, model)}
          onPress={onModelPress}
          prefix="Model"
          buttonRef={modelSelectorRef}
        />
        {/* Most models have no variants; the chip appears only when there is a choice or a saved one. */}
        {selectedModel?.variants.length || model?.variant ? (
          <SelectorButton
            chevron={false}
            label={model?.variant ?? "Default"}
            prefix="Variant"
            buttonRef={variantSelectorRef}
            disabled={!selectedModel?.variants.length}
            onPress={onVariantPress}
          />
        ) : null}
        {draftLength >= maximumDraftLength * 0.9 ? (
          <Text dynamicTypeRamp={typeRamp.footnote} style={styles.count}>
            {draftLength.toLocaleString()} / {maximumDraftLength.toLocaleString()}
          </Text>
        ) : null}
      </ScrollView>
      {trailing}
    </View>
  );
}

function ComposerOptionsSheet({
  agent,
  agentCatalog,
  agentSearch,
  agents,
  model,
  onAgentChange,
  onAgentSearchChange,
  onClose,
  onModelChange,
  page,
  returnFocusRef,
  selectedModel,
}: {
  agent: string | undefined;
  agentCatalog: CatalogState | undefined;
  agentSearch: string;
  agents: AgentInfo[];
  model: ModelRef | undefined;
  onAgentChange: (agent: string) => void;
  onAgentSearchChange: (search: string) => void;
  onClose: () => void;
  onModelChange: (model: ModelRef) => void;
  page: OptionsPage | undefined;
  returnFocusRef: RefObject<View | null>;
  selectedModel: ModelInfo | undefined;
}) {
  const agentPickerOpen = page === "agent";
  return (
    <ModalSheet
      onClose={onClose}
      size="page"
      scrollable={false}
      subtitle={
        agentPickerOpen
          ? "Primary agents available at this session location"
          : (selectedModel?.name ?? "Select a model first")
      }
      title={agentPickerOpen ? "Choose agent" : "Choose variant"}
      returnFocusRef={returnFocusRef}
      visible={page !== undefined}
    >
      {agentPickerOpen ? (
        <AgentOptions
          agent={agent}
          agents={agents}
          catalog={agentCatalog}
          onSearchChange={onAgentSearchChange}
          onSelect={onAgentChange}
          search={agentSearch}
        />
      ) : null}
      {page === "variant" && selectedModel ? (
        <VariantOptions model={model} onSelect={onModelChange} selectedModel={selectedModel} />
      ) : null}
    </ModalSheet>
  );
}

function AgentOptions({
  agent,
  agents,
  catalog,
  onSearchChange,
  onSelect,
  search,
}: {
  agent: string | undefined;
  agents: AgentInfo[];
  catalog: CatalogState | undefined;
  onSearchChange: (search: string) => void;
  onSelect: (agent: string) => void;
  search: string;
}) {
  return (
    <>
      <SearchField
        accessibilityLabel="Search agents"
        onChangeText={onSearchChange}
        placeholder="Search agents"
        value={search}
      />
      {catalog?.error ? (
        <PickerNotice text="Agents could not be loaded." retry={catalog.retry} />
      ) : null}
      <FlatList
        accessibilityLabel="Agent results"
        contentContainerStyle={styles.pickerListContent}
        data={agents}
        ItemSeparatorComponent={OptionSeparator}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="always"
        keyExtractor={(candidate) => candidate.id}
        ListEmptyComponent={<EmptyResults label={agentPickerEmptyLabel(catalog, search)} />}
        renderItem={({ item: candidate }) => (
          <OptionButton
            {...(candidate.description ? { description: candidate.description } : {})}
            label={agentDisplayName(candidate.name)}
            onPress={() => onSelect(candidate.id)}
            selected={candidate.id === agent}
          />
        )}
        style={styles.pickerList}
      />
    </>
  );
}

function VariantOptions({
  model,
  onSelect,
  selectedModel,
}: {
  model: ModelRef | undefined;
  onSelect: (model: ModelRef) => void;
  selectedModel: ModelInfo;
}) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.optionsContent}>
      <OptionButton
        label="Default"
        selected={!model?.variant}
        onPress={() => onSelect({ id: selectedModel.id, providerID: selectedModel.providerID })}
      />
      {selectedModel.variants.map((variant) => (
        <OptionButton
          key={variant.id}
          label={variant.id}
          selected={variant.id === model?.variant}
          onPress={() =>
            onSelect({
              id: selectedModel.id,
              providerID: selectedModel.providerID,
              variant: variant.id,
            })
          }
        />
      ))}
    </ScrollView>
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
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.completionKind}>
          Command
        </Text>
      </View>
      {completion.label !== completion.name || completion.description ? (
        <Text dynamicTypeRamp={typeRamp.footnote} numberOfLines={2} style={styles.completionDetail}>
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
  const value = mentionValue(completion);
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
        <Text dynamicTypeRamp={typeRamp.sectionLabel} style={styles.completionKind}>
          {completion.type.charAt(0).toLocaleUpperCase() + completion.type.slice(1)}
        </Text>
      </View>
      {completion.label !== value || completion.description ? (
        <Text dynamicTypeRamp={typeRamp.footnote} numberOfLines={2} style={styles.completionDetail}>
          {[completion.label !== value ? completion.label : undefined, completion.description]
            .filter(Boolean)
            .join(" / ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

function EmptyResults({ label }: { label: string }) {
  return (
    <Text dynamicTypeRamp={typeRamp.subheadline} style={styles.emptyResults}>
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
  // While a run is active the arrow either steers it or queues a follow-up; say which on screen.
  const deliveryLabel =
    !showStop && active && canSubmit && delivery
      ? delivery === "queue"
        ? "Queue"
        : "Steer"
      : undefined;
  return (
    <>
      {deliveryLabel ? (
        <Text
          accessibilityElementsHidden
          dynamicTypeRamp={typeRamp.footnote}
          importantForAccessibility="no-hide-descendants"
          style={styles.deliveryLabel}
          testID="composer-delivery-label"
        >
          {deliveryLabel}
        </Text>
      ) : null}
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
            <Feather
              accessible={false}
              color={disabled ? palette.dim : palette.background}
              name="arrow-up"
              size={19}
            />
          )}
        </View>
      </Pressable>
    </>
  );
}

function SelectorButton({
  chevron = true,
  emphasis = false,
  buttonRef,
  disabled = false,
  label,
  onPress,
  prefix,
}: {
  // Only the agent keeps a chevron; model and variant read as one phrase, "Opus 5.5 High".
  chevron?: boolean;
  // The model reads in ink; agent and variant stay dim around it.
  emphasis?: boolean;
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
        disabled && styles.selectorDisabled,
        pressed && styles.pressed,
      ]}
    >
      <Text
        dynamicTypeRamp={typeRamp.footnote}
        numberOfLines={1}
        style={[styles.selectorLabel, emphasis && styles.selectorLabelEmphasis]}
      >
        {label}
      </Text>
      {chevron ? (
        <Feather accessible={false} color={palette.dim} name="chevron-down" size={12} />
      ) : null}
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
      android_ripple={rippleFeedback.row}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        compact && styles.optionCompact,
        selected && styles.optionSelected,
        pressed && Platform.OS === "ios" && styles.pressed,
      ]}
    >
      <View style={styles.optionCopy}>
        <Text dynamicTypeRamp={typeRamp.body} style={styles.optionLabel}>
          {label}
        </Text>
        {description ? (
          <Text
            dynamicTypeRamp={typeRamp.footnote}
            numberOfLines={2}
            style={styles.optionDescription}
          >
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Feather accessible={false} name="check" size={20} color={palette.signal} />
      ) : null}
    </Pressable>
  );
}

// Agent IDs are often lowercase ("build"); show them capitalized, like the transcript footer.
function agentDisplayName(name: string) {
  return name ? `${name[0]?.toLocaleUpperCase()}${name.slice(1)}` : name;
}

function findModel(models: ModelInfo[], model: ModelRef | undefined) {
  return models.find(
    (candidate) => candidate.id === model?.id && candidate.providerID === model.providerID,
  );
}

function modelLabel(model: ModelInfo | undefined, ref: ModelRef | undefined) {
  if (!model) return ref ? `${ref.providerID}/${ref.id}` : "Choose model";
  return model.name;
}

const styles = StyleSheet.create({
  selectorLabelEmphasis: { color: palette.ink },
  // Bottom-aligned with the send target and centered on its 48pt height.
  deliveryLabel: {
    ...typography.footnote,
    alignSelf: "flex-end",
    color: palette.info,
    marginBottom: (minTouchTarget - typography.footnote.lineHeight) / 2,
    marginLeft: space.sm,
  },
  selectorDisabled: { opacity: disabledOpacity },
  optionsContent: { gap: 2 },
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
  completionDetail: { ...typography.footnote, color: palette.dim },
  completionHeading: { alignItems: "center", flexDirection: "row", gap: space.xs },
  completionKind: { ...typography.sectionLabel, color: palette.dim },
  completionList: { maxHeight: 220 },
  completionListContent: { gap: 4 },
  completionName: { ...typography.control, color: palette.ink, flex: 1 },
  completionState: {
    ...typography.footnote,
    color: palette.dim,
    paddingVertical: space.sm,
    textAlign: "center",
  },
  count: {
    ...typography.footnote,
    alignSelf: "center",
    color: palette.dim,
    paddingHorizontal: space.xs,
  },
  editorRow: { alignItems: "center", flexDirection: "row", minWidth: 0 },
  editorRowExpanded: { alignItems: "stretch" },
  emptyResults: {
    ...typography.subheadline,
    color: palette.dim,
    paddingVertical: space.lg,
    textAlign: "center",
  },
  error: { ...typography.subheadline, color: palette.danger },
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
  // Matches the model picker's rows, so all three composer pickers look alike.
  option: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: space.sm,
    minHeight: 56,
    overflow: "hidden",
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  optionCompact: { marginLeft: space.md, minHeight: minTouchTarget },
  optionCopy: { flex: 1, minWidth: 0 },
  optionDescription: { ...typography.footnote, color: palette.dim, marginTop: 2 },
  optionLabel: { ...typography.body, color: palette.ink },
  optionSelected: { backgroundColor: palette.selected },
  optionSeparator: { height: 2 },
  pickerList: { flex: 1 },
  pickerListContent: { flexGrow: 1, justifyContent: "flex-start" },
  pressed: { opacity: pressedOpacity },
  selectorButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    maxWidth: 180,
    minHeight: minTouchTarget,
    paddingHorizontal: 4,
  },
  selectorLabel: { ...typography.footnote, color: palette.dim, flexShrink: 1 },
  selectorRow: { alignItems: "center", gap: space.xs, paddingRight: space.xs },
  selectorScroller: { flex: 1 },
  sendButton: {
    alignSelf: "flex-end",
    marginLeft: space.sm,
    alignItems: "center",
    borderRadius: minTouchTarget / 2,
    justifyContent: "center",
    height: minTouchTarget,
    width: minTouchTarget,
  },
  sendVisual: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: palette.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  // A dim arrow on a raised circle reads as unavailable without vanishing into the pill.
  sendButtonDisabled: { backgroundColor: palette.selected },
  stopIcon: { width: 12, height: 12, borderRadius: 2, backgroundColor: palette.background },
  // Collapsed, the composer floats as one pill like the OpenCode iOS app.
  shell: {
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  surface: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0px 4px 16px rgba(0, 0, 0, 0.35)",
    paddingLeft: 16,
    // The send target is 48pt around a 36pt circle; trimmed padding keeps the pill 52pt tall.
    paddingRight: 2,
    paddingVertical: 2,
  },
  surfaceExpanded: {
    borderRadius: 22,
    gap: 2,
    paddingBottom: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  // The expanded surface pads 12pt; pulling the toolbar's end in keeps Send's circle at the
  // same corner inset as in the collapsed pill.
  toolbar: { alignItems: "center", flexDirection: "row", gap: space.xs, marginRight: -8 },
});
