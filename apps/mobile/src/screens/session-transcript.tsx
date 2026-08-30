import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { memo, useEffect, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { applicationName } from "../application-name";
import { recordTranscriptRowCommit } from "../state/transcript-performance";
import { palette, radius, space, typeRamp } from "../theme";
import {
  getSubagentPresentation,
  parseSubagentProtocolText,
  type SubagentPresentation,
  type SubagentProtocolText,
  sanitizeTranscriptText,
} from "./session-transcript-model";

const textStep = 4_000;
const maxVisibleText = 32_000;
const maxSanitizedInput = 128_000;
const maxAssistantParts = 64;
const maxAttachments = 32;
const maxToolOutputs = 32;
const maxInlineReasoning = 240;
type AssistantTool = Extract<
  Extract<SessionMessageInfo, { type: "assistant" }>["content"][number],
  { type: "tool" }
>;
type AssistantMessage = Extract<SessionMessageInfo, { type: "assistant" }>;
type AssistantPart = AssistantMessage["content"][number];
type ShellMessage = Extract<SessionMessageInfo, { type: "shell" }>;
type ToolOutput = Extract<AssistantTool["state"], { status: "completed" }>["content"][number];

export const SessionTranscriptRow = memo(function SessionTranscriptRow({
  largeText = false,
  message,
  onOpenDiff,
  onOpenSubagent,
}: {
  largeText?: boolean;
  message: SessionMessageInfo;
  onOpenDiff?: (() => void) | undefined;
  onOpenSubagent?: ((sessionID: string) => void) | undefined;
}) {
  useEffect(() => {
    recordTranscriptRowCommit();
  });

  switch (message.type) {
    case "user":
      return (
        <View style={styles.userRow}>
          <View style={[styles.userBubble, largeText && styles.userBubbleLargeText]}>
            <Text dynamicTypeRamp={typeRamp.caption} style={styles.userLabel}>
              YOU
            </Text>
            <ExpandableText style={styles.userText} text={message.text} />
            <AttachmentLabels largeText={largeText} message={message} />
          </View>
        </View>
      );
    case "assistant": {
      const visibleContent = message.content.slice(0, maxAssistantParts);
      return (
        <View style={styles.assistantRow}>
          {groupAssistantParts(visibleContent).map((item) => {
            if (item.type === "exploration") {
              return (
                <ExplorationDisclosure
                  key={item.key}
                  largeText={largeText}
                  onOpenSubagent={onOpenSubagent}
                  tools={item.tools}
                />
              );
            }
            if (item.type === "tools") {
              return (
                <ToolGroupDisclosure
                  category={item.category}
                  key={item.key}
                  largeText={largeText}
                  onOpenDiff={onOpenDiff}
                  onOpenSubagent={onOpenSubagent}
                  tools={item.tools}
                />
              );
            }
            const { key, part } = item;
            if (part.type === "text") {
              const protocol = parseSubagentProtocolText(part.text);
              return protocol.matched ? (
                <SubagentResultCard
                  key={key}
                  largeText={largeText}
                  onOpenSubagent={onOpenSubagent}
                  protocol={protocol}
                />
              ) : (
                <ExpandableText key={key} markdown style={styles.bodyText} text={part.text} />
              );
            }
            if (part.type === "reasoning") {
              const settled = isSettledReasoning(message, part);
              return isInlineReasoning(part.text) ? (
                <InlineMarkdownText
                  key={key}
                  prefix={settled ? "THOUGHT" : "THINKING"}
                  prefixStyle={styles.reasoningLabel}
                  style={styles.reasoningText}
                  text={part.text}
                />
              ) : (
                <Disclosure
                  key={key}
                  label={settled ? "Thought" : "Thinking"}
                  largeText={largeText}
                  markdown
                  text={part.text}
                />
              );
            }
            return (
              <ToolDisclosure
                key={key}
                largeText={largeText}
                onOpenDiff={onOpenDiff}
                onOpenSubagent={onOpenSubagent}
                tool={part}
              />
            );
          })}
          {message.content.length > visibleContent.length ? (
            <Text style={styles.omittedText}>Additional message parts omitted on this device.</Text>
          ) : null}
          {message.retry ? (
            <Disclosure
              label={`Retry ${message.retry.attempt} scheduled`}
              largeText={largeText}
              text={message.retry.error.message}
            />
          ) : null}
          {message.error ? (
            <ExpandableText error style={styles.errorText} text={message.error.message} />
          ) : null}
          {message.content.length === 0 && !message.error ? (
            <Text style={styles.statusText}>No projected content</Text>
          ) : null}
          {hasNarrativeContent(message) ? <AssistantFooter message={message} /> : null}
        </View>
      );
    }
    case "shell":
      return <ShellDisclosure largeText={largeText} message={message} />;
    case "synthetic":
      return <Notice label={message.description || "Generated context"} text={message.text} />;
    case "system":
      return <Notice label={message.description || "System"} text={message.text} />;
    case "skill":
      return <Notice label={`Skill / ${message.name}`} text={message.text} />;
    case "agent-switched":
      return <Notice label="Agent changed" text={message.agent} />;
    case "model-switched":
      return <Notice label="Model changed" text={message.model.id} />;
    case "location-switched":
      return <Notice label="Location changed" text={basename(message.location.directory)} />;
    case "compaction":
      return message.status === "failed" ? (
        <Notice label="Compaction failed" text={message.error.message} />
      ) : (
        <Disclosure
          label={`Compaction / ${sentenceCase(message.status)}`}
          largeText={largeText}
          text={[message.summary, message.recent]}
        />
      );
    default:
      return <Notice label="Unsupported message" />;
  }
});

function AttachmentLabels({
  largeText,
  message,
}: {
  largeText: boolean;
  message: Extract<SessionMessageInfo, { type: "user" }>;
}) {
  const labels: string[] = [];
  for (const file of message.files ?? []) {
    if (labels.length >= maxAttachments) break;
    labels.push(file.name?.trim() ? basename(file.name.trim()) : "File attachment");
  }
  for (const agent of message.agents ?? []) {
    if (labels.length >= maxAttachments) break;
    labels.push(`@${agent.name}`);
  }
  for (const skill of message.skills ?? []) {
    if (labels.length >= maxAttachments) break;
    labels.push(`Skill: ${skill.name}`);
  }
  if (labels.length === 0) return null;
  const attachmentCount =
    (message.files?.length ?? 0) + (message.agents?.length ?? 0) + (message.skills?.length ?? 0);
  const keyedLabels = withOccurrenceKeys(labels);
  return (
    <View accessibilityLabel={`${attachmentCount} attachments`} style={styles.attachments}>
      {keyedLabels.map(({ key, label }) => (
        <View key={key} style={styles.attachmentChip}>
          <Text
            dynamicTypeRamp={typeRamp.control}
            numberOfLines={largeText ? undefined : 2}
            style={styles.attachmentLabel}
          >
            {sanitizeTranscriptText(label, 256)}
          </Text>
        </View>
      ))}
      {attachmentCount > labels.length ? (
        <Text style={styles.omittedText}>Additional attachments omitted.</Text>
      ) : null}
    </View>
  );
}

type AssistantPresentationItem =
  | { key: string; part: AssistantPart; type: "part" }
  | { key: string; tools: AssistantTool[]; type: "exploration" }
  | { category: ToolGroupCategory; key: string; tools: AssistantTool[]; type: "tools" };
type ToolCategory = "edit" | "exploration" | "other" | "shell" | "skill";
type ToolGroupCategory = Exclude<ToolCategory, "exploration">;

function groupAssistantParts(content: AssistantMessage["content"]): AssistantPresentationItem[] {
  const items: AssistantPresentationItem[] = [];
  let textOrdinal = 0;
  let reasoningOrdinal = 0;
  let tools: AssistantTool[] = [];
  const flushTools = () => {
    let start = 0;
    while (start < tools.length) {
      const category = toolCategory(tools[start] as AssistantTool);
      let end = start + 1;
      while (end < tools.length && toolCategory(tools[end] as AssistantTool) === category) end += 1;
      const run = tools.slice(start, end);
      const first = run[0] as AssistantTool;
      if (category === "exploration") {
        items.push({ key: `exploration:${first.id}`, tools: run, type: "exploration" });
      } else if (run.length > 1 && run.every((tool) => tool.state.status === "completed")) {
        items.push({ category, key: `tools:${first.id}`, tools: run, type: "tools" });
      } else {
        for (const tool of run) {
          items.push({ key: `tool:${tool.id}`, part: tool, type: "part" });
        }
      }
      start = end;
    }
    tools = [];
  };

  for (const part of content) {
    if (part.type === "tool" && !getSubagentPresentation(part)) {
      tools.push(part);
      continue;
    }
    flushTools();
    if (part.type === "tool") {
      items.push({ key: `tool:${part.id}`, part, type: "part" });
      continue;
    }
    if (part.type === "text") {
      textOrdinal += 1;
      items.push({ key: `text:${textOrdinal}`, part, type: "part" });
      continue;
    }
    reasoningOrdinal += 1;
    items.push({ key: `reasoning:${reasoningOrdinal}`, part, type: "part" });
  }
  flushTools();
  return items;
}

function hasNarrativeContent(message: AssistantMessage) {
  return message.content.some((part) => part.type === "text" || part.type === "reasoning");
}

function withOccurrenceKeys(labels: string[]) {
  const occurrences = new Map<string, number>();
  return labels.map((label) => {
    const occurrence = (occurrences.get(label) ?? 0) + 1;
    occurrences.set(label, occurrence);
    return { key: `${label}:${occurrence}`, label };
  });
}

function ExplorationDisclosure({
  largeText,
  onOpenSubagent,
  tools,
}: {
  largeText: boolean;
  onOpenSubagent?: ((sessionID: string) => void) | undefined;
  tools: AssistantTool[];
}) {
  const [expanded, setExpanded] = useState(false);
  const allReads = tools.every((tool) => tool.name.trim().toLocaleLowerCase() === "read");
  const noun = allReads ? "read" : "search";
  const status = activityGroupStatus(tools);
  const plural = tools.length === 1 ? noun : noun === "search" ? "searches" : "reads";
  const detail = `${tools.length} ${plural}${status ? ` · ${status}` : ""}`;
  return (
    <View style={styles.activity}>
      <ActivityHeader
        canExpand
        detail={detail}
        expanded={expanded}
        label={isActivityInFlight(tools) ? "Exploring" : "Explored"}
        largeText={largeText}
        onPress={() => setExpanded((current) => !current)}
      />
      {expanded
        ? tools.map((tool) => (
            <ToolDisclosure
              key={tool.id}
              largeText={largeText}
              nested
              onOpenSubagent={onOpenSubagent}
              tool={tool}
            />
          ))
        : null}
    </View>
  );
}

function ToolGroupDisclosure({
  category,
  largeText,
  onOpenDiff,
  onOpenSubagent,
  tools,
}: {
  category: ToolGroupCategory;
  largeText: boolean;
  onOpenDiff?: (() => void) | undefined;
  onOpenSubagent?: ((sessionID: string) => void) | undefined;
  tools: AssistantTool[];
}) {
  const [expanded, setExpanded] = useState(false);
  const { detail, label } = toolGroupPresentation(category, tools);
  const canExpand = tools.some(canExpandTool);
  return (
    <View style={styles.activity}>
      <ActivityHeader
        canExpand={canExpand}
        detail={detail}
        expanded={expanded}
        label={label}
        largeText={largeText}
        onPress={() => setExpanded((current) => !current)}
      />
      {expanded
        ? tools.map((tool) => (
            <ToolDisclosure
              key={tool.id}
              largeText={largeText}
              nested
              onOpenDiff={onOpenDiff}
              onOpenSubagent={onOpenSubagent}
              tool={tool}
            />
          ))
        : null}
      {category === "edit" && onOpenDiff ? <DiffAction onPress={onOpenDiff} /> : null}
    </View>
  );
}

function ToolDisclosure({
  largeText,
  nested = false,
  onOpenDiff,
  onOpenSubagent,
  tool,
}: {
  largeText: boolean;
  nested?: boolean;
  onOpenDiff?: (() => void) | undefined;
  onOpenSubagent?: ((sessionID: string) => void) | undefined;
  tool: AssistantTool;
}) {
  const [expanded, setExpanded] = useState(false);
  const subagent = getSubagentPresentation(tool);
  if (subagent) {
    return (
      <SubagentCard largeText={largeText} onOpenSubagent={onOpenSubagent} presentation={subagent} />
    );
  }
  const content =
    tool.state.status === "completed" || tool.state.status === "error"
      ? (tool.state.content ?? [])
      : [];
  const error = tool.state.status === "error" ? tool.state.error.message : undefined;
  const presentation = toolPresentation(tool);
  const canExpand = canExpandTool(tool);
  const category = toolCategory(tool);
  const label =
    !nested && tool.state.status === "completed"
      ? completedToolLabel(category, presentation.label)
      : presentation.label;
  const visibleContent = content.slice(0, maxToolOutputs);
  return (
    <View style={[styles.activity, nested && styles.activityNested]}>
      <ActivityHeader
        canExpand={canExpand}
        detail={presentation.detail}
        expanded={expanded}
        label={label}
        largeText={largeText}
        onPress={() => setExpanded((current) => !current)}
      />
      {expanded
        ? presentation.files.map((file) => (
            <Text
              dynamicTypeRamp={typeRamp.control}
              key={file}
              selectable
              style={styles.activityFile}
            >
              {file}
            </Text>
          ))
        : null}
      {expanded && presentation.command ? (
        <Text dynamicTypeRamp={typeRamp.body} selectable style={styles.outputText}>
          {`$ ${presentation.command}`}
        </Text>
      ) : null}
      {expanded
        ? keyToolContent(visibleContent).map(({ item, key }) =>
            item.type === "text" ? (
              <ExpandableText
                key={key}
                style={styles.outputText}
                text={parseSubagentProtocolText(item.text).text}
              />
            ) : (
              <Text dynamicTypeRamp={typeRamp.body} key={key} selectable style={styles.outputText}>
                {sanitizeTranscriptText(
                  item.name?.trim() ? basename(item.name.trim()) : "File result",
                  256,
                )}
              </Text>
            ),
          )
        : null}
      {expanded && content.length > visibleContent.length ? (
        <Text style={styles.omittedText}>Additional tool output omitted on this device.</Text>
      ) : null}
      {expanded && error ? <ExpandableText error style={styles.errorText} text={error} /> : null}
      {!nested && category === "edit" && onOpenDiff ? <DiffAction onPress={onOpenDiff} /> : null}
    </View>
  );
}

function DiffAction({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.diffAction, pressed && styles.pressed]}
    >
      <Text dynamicTypeRamp={typeRamp.control} style={styles.diffActionLabel}>
        Review current changes
      </Text>
    </Pressable>
  );
}

function ActivityHeader({
  canExpand,
  detail,
  expanded,
  label,
  largeText,
  onPress,
}: {
  canExpand: boolean;
  detail?: string | undefined;
  expanded: boolean;
  label: string;
  largeText: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={canExpand ? "button" : undefined}
      accessibilityState={canExpand ? { expanded } : undefined}
      disabled={!canExpand}
      onPress={onPress}
      style={({ pressed }) => [
        styles.activityHeader,
        largeText && styles.activityHeaderLargeText,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.activityCopy, largeText && styles.activityCopyLargeText]}>
        <Text dynamicTypeRamp={typeRamp.control} style={styles.activityLabel}>
          {sanitizeTranscriptText(label, 128)}
        </Text>
        {detail ? (
          <Text
            dynamicTypeRamp={typeRamp.control}
            numberOfLines={largeText ? undefined : 2}
            style={styles.activityDetail}
          >
            {sanitizeTranscriptText(detail, 512)}
          </Text>
        ) : null}
      </View>
      {canExpand ? (
        <Text
          dynamicTypeRamp={typeRamp.control}
          style={[styles.activityAction, largeText && styles.activityActionLargeText]}
        >
          {expanded ? "Hide" : "Show"}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ShellDisclosure({ largeText, message }: { largeText: boolean; message: ShellMessage }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(message.output?.output);
  const status = shellStatusLabel(message);
  const detail = `${message.command}${status ? ` · ${status}` : ""}`;
  return (
    <View style={styles.activityStandalone}>
      <View style={styles.activity}>
        <ActivityHeader
          canExpand={canExpand}
          detail={detail}
          expanded={expanded}
          label={message.status === "running" ? "Running" : "Ran"}
          largeText={largeText}
          onPress={() => setExpanded((current) => !current)}
        />
        {expanded ? (
          <Text dynamicTypeRamp={typeRamp.body} selectable style={styles.outputText}>
            {`$ ${message.command}`}
          </Text>
        ) : null}
        {expanded && message.output?.output ? (
          <ExpandableText style={styles.outputText} text={message.output.output} />
        ) : null}
      </View>
    </View>
  );
}

function AssistantFooter({ message }: { message: AssistantMessage }) {
  const duration =
    message.time.completed !== undefined
      ? formatDuration(message.time.completed - message.time.created)
      : undefined;
  return (
    <Text dynamicTypeRamp={typeRamp.caption} style={styles.assistantFooter}>
      {sanitizeTranscriptText(sentenceCase(message.agent || "Assistant"), 128)} ·{" "}
      {sanitizeTranscriptText(message.model.id, 128)}
      {duration ? ` · ${duration}` : ""}
    </Text>
  );
}

function SubagentResultCard({
  largeText,
  onOpenSubagent,
  protocol,
}: {
  largeText: boolean;
  onOpenSubagent?: ((sessionID: string) => void) | undefined;
  protocol: SubagentProtocolText;
}) {
  return (
    <SubagentCard
      largeText={largeText}
      onOpenSubagent={onOpenSubagent}
      presentation={{
        background: true,
        ...(protocol.childSessionID ? { childSessionID: protocol.childSessionID } : {}),
        ...(protocol.text ? { result: protocol.text } : {}),
        state: protocol.state ?? "completed",
        title: protocol.summary || "Subagent result",
      }}
    />
  );
}

function SubagentCard({
  largeText,
  onOpenSubagent,
  presentation,
}: {
  largeText: boolean;
  onOpenSubagent?: ((sessionID: string) => void) | undefined;
  presentation: SubagentPresentation;
}) {
  const [expanded, setExpanded] = useState(false);
  const canOpen = Boolean(presentation.childSessionID && onOpenSubagent);
  const canExpand = Boolean(presentation.result);
  const stateLabel = subagentStateLabel(presentation.state);
  return (
    <View
      accessibilityLabel={`Subagent ${presentation.title}. ${stateLabel}`}
      style={[styles.subagent, presentation.state === "completed" && styles.subagentCompleted]}
    >
      <View style={[styles.subagentHeading, largeText && styles.subagentHeadingLargeText]}>
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.subagentLabel}>
          {presentation.background ? "BACKGROUND SUBAGENT" : "SUBAGENT"}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          dynamicTypeRamp={typeRamp.caption}
          style={[
            styles.subagentState,
            presentation.state === "error" && styles.subagentStateError,
            presentation.state === "running" && styles.subagentStateRunning,
          ]}
        >
          {stateLabel}
        </Text>
      </View>
      <Text dynamicTypeRamp={typeRamp.subheading} style={styles.subagentTitle}>
        {sanitizeTranscriptText(presentation.title, 256)}
      </Text>
      {presentation.agent ? (
        <Text dynamicTypeRamp={typeRamp.control} style={styles.subagentAgent}>
          @{sanitizeTranscriptText(presentation.agent, 128)}
        </Text>
      ) : null}
      {canOpen || canExpand ? (
        <View style={styles.subagentActions}>
          {canOpen ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (presentation.childSessionID) onOpenSubagent?.(presentation.childSessionID);
              }}
              style={({ pressed }) => [styles.subagentAction, pressed && styles.pressed]}
            >
              <Text dynamicTypeRamp={typeRamp.control} style={styles.subagentActionLabel}>
                Open child
              </Text>
            </Pressable>
          ) : null}
          {canExpand ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded((current) => !current)}
              style={({ pressed }) => [styles.subagentAction, pressed && styles.pressed]}
            >
              <Text dynamicTypeRamp={typeRamp.control} style={styles.subagentActionLabel}>
                {expanded ? "Hide result" : "Show result"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {expanded && presentation.result ? (
        <ExpandableText markdown style={styles.subagentResult} text={presentation.result} />
      ) : null}
    </View>
  );
}

function Disclosure({
  label,
  largeText,
  markdown = false,
  text,
}: {
  label: string;
  largeText: boolean;
  markdown?: boolean;
  text: string | string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const entries = keyDisclosureText(typeof text === "string" ? [text] : text);
  const hasText = entries.some((entry) => Boolean(entry.text));
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole={hasText ? "button" : undefined}
        accessibilityState={hasText ? { expanded } : undefined}
        disabled={!hasText}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [
          styles.disclosureHeader,
          largeText && styles.disclosureHeaderLargeText,
          pressed && styles.pressed,
        ]}
      >
        <Text
          dynamicTypeRamp={typeRamp.control}
          style={[styles.disclosureLabel, largeText && styles.disclosureLabelLargeText]}
        >
          {sanitizeTranscriptText(label, 256)}
        </Text>
        {hasText ? (
          <Text
            dynamicTypeRamp={typeRamp.control}
            style={[styles.disclosureAction, largeText && styles.disclosureActionLargeText]}
          >
            {expanded ? "Hide" : "Show"}
          </Text>
        ) : null}
      </Pressable>
      {expanded
        ? entries.map(({ key, text: entry }) =>
            entry ? (
              <ExpandableText
                key={key}
                markdown={markdown}
                style={styles.outputText}
                text={entry}
              />
            ) : null,
          )
        : null}
    </View>
  );
}

function Notice({ label, text }: { label: string; text?: string }) {
  return (
    <View style={styles.notice}>
      <Text dynamicTypeRamp={typeRamp.caption} style={styles.noticeLabel}>
        {sanitizeTranscriptText(label, 256)}
      </Text>
      {text ? <ExpandableText style={styles.noticeText} text={text} /> : null}
    </View>
  );
}

function ExpandableText({
  error,
  markdown = false,
  style,
  text,
}: {
  error?: boolean;
  markdown?: boolean;
  style: object;
  text: string;
}) {
  const [visibleCharacters, setVisibleCharacters] = useState(textStep);
  const boundedInput = text.slice(0, maxSanitizedInput);
  const safeText = sanitizeTranscriptText(boundedInput, maxVisibleText + 1);
  const visibleLimit = Math.min(visibleCharacters, maxVisibleText);
  const visibleText = safeText.slice(0, visibleLimit);
  const canShowMore = visibleLimit < Math.min(safeText.length, maxVisibleText);
  const omitted =
    (safeText.length > maxVisibleText && visibleLimit >= maxVisibleText) ||
    (text.length > maxSanitizedInput && !canShowMore);

  return (
    <View>
      {markdown ? (
        <MarkdownText style={style} text={visibleText} />
      ) : (
        <LinkifiedText style={style} text={visibleText} />
      )}
      {canShowMore ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisibleCharacters((current) => current + textStep)}
          style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}
        >
          <Text
            dynamicTypeRamp={typeRamp.control}
            style={[styles.textActionLabel, error && styles.errorText]}
          >
            Show more
          </Text>
        </Pressable>
      ) : null}
      {omitted ? (
        <Text style={styles.omittedText}>Remaining content omitted on this device.</Text>
      ) : null}
    </View>
  );
}

type MarkdownBlock =
  | { text: string; type: "text" }
  | { language?: string; text: string; type: "code" };

function MarkdownText({ style, text }: { style: object; text: string }) {
  const blocks = keyMarkdownBlocks(splitCodeBlocks(text));
  return (
    <View>
      {blocks.map(({ block, key }, index) =>
        block.type === "text" ? (
          <InlineMarkdownText
            key={key}
            style={[style, index > 0 && styles.markdownBlockSpacing]}
            text={block.text}
          />
        ) : (
          <View
            accessibilityLabel={block.language ? `Code block, ${block.language}` : "Code block"}
            key={key}
            style={[styles.codeBlock, index > 0 && styles.markdownBlockSpacing]}
          >
            {block.language ? (
              <Text dynamicTypeRamp={typeRamp.caption} style={styles.codeLanguage}>
                {block.language.toLocaleUpperCase()}
              </Text>
            ) : null}
            <Text dynamicTypeRamp={typeRamp.body} selectable style={styles.codeText}>
              {block.text}
            </Text>
          </View>
        ),
      )}
    </View>
  );
}

function InlineMarkdownText({
  prefix,
  prefixStyle,
  style,
  text,
}: {
  prefix?: string;
  prefixStyle?: object;
  style: object | object[];
  text: string;
}) {
  return (
    <Text dynamicTypeRamp={typeRamp.body} selectable style={style}>
      {prefix ? <Text style={prefixStyle}>{`${prefix}  `}</Text> : null}
      {splitBoldText(text).map((token) => (
        <LinkifiedTextContent
          key={token.key}
          {...(token.bold ? { style: styles.boldText } : {})}
          text={token.text}
        />
      ))}
    </Text>
  );
}

function LinkifiedText({ style, text }: { style: object; text: string }) {
  return (
    <Text dynamicTypeRamp={typeRamp.body} selectable style={style}>
      <LinkifiedTextContent text={text} />
    </Text>
  );
}

function LinkifiedTextContent({ style, text }: { style?: object; text: string }) {
  return splitWebUrls(text).map((token) => {
    const href = token.href;
    return href ? (
      <Text
        accessibilityRole="link"
        key={token.key}
        onPress={() => openTranscriptUrl(href)}
        style={[style, styles.linkText]}
      >
        {token.text}
      </Text>
    ) : (
      <Text key={token.key} style={style}>
        {token.text}
      </Text>
    );
  });
}

function splitWebUrls(text: string) {
  const tokens: { href?: string; key: string; text: string }[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let cursor = 0;
  let ordinal = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const candidate = match[0];
    if (start > cursor) {
      tokens.push({ key: `text:${ordinal}`, text: text.slice(cursor, start) });
      ordinal += 1;
    }

    const { suffix, url } = trimUrlPunctuation(candidate);
    let href: string | undefined;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") href = parsed.toString();
    } catch {
      // Keep malformed URL-like text selectable without making it actionable.
    }
    tokens.push({ ...(href ? { href } : {}), key: `url:${ordinal}`, text: url });
    ordinal += 1;
    if (suffix) {
      tokens.push({ key: `text:${ordinal}`, text: suffix });
      ordinal += 1;
    }
    cursor = start + candidate.length;
  }

  if (cursor < text.length || tokens.length === 0) {
    tokens.push({ key: `text:${ordinal}`, text: text.slice(cursor) });
  }
  return tokens;
}

function trimUrlPunctuation(candidate: string) {
  let end = candidate.length;
  while (end > 0 && /[.,!?;:]/.test(candidate[end - 1] as string)) end -= 1;

  const pairs = { ")": "(", "]": "[", "}": "{" } as const;
  while (end > 0) {
    const closing = candidate[end - 1] as keyof typeof pairs;
    const opening = pairs[closing];
    if (!opening) break;
    const value = candidate.slice(0, end);
    if (value.split(closing).length <= value.split(opening).length) break;
    end -= 1;
  }
  return { suffix: candidate.slice(end), url: candidate.slice(0, end) };
}

function openTranscriptUrl(url: string) {
  const parsed = new URL(url);
  Alert.alert(
    "Open external link?",
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

function splitBoldText(text: string) {
  const tokens: { bold: boolean; key: string; text: string }[] = [];
  let cursor = 0;
  let ordinal = 0;
  while (cursor < text.length) {
    const opening = text.indexOf("**", cursor);
    const closing = opening >= 0 ? text.indexOf("**", opening + 2) : -1;
    if (opening < 0 || closing < 0) {
      tokens.push({ bold: false, key: `text:${ordinal}`, text: text.slice(cursor) });
      break;
    }
    if (opening > cursor) {
      tokens.push({ bold: false, key: `text:${ordinal}`, text: text.slice(cursor, opening) });
      ordinal += 1;
    }
    tokens.push({ bold: true, key: `bold:${ordinal}`, text: text.slice(opening + 2, closing) });
    ordinal += 1;
    cursor = closing + 2;
  }
  return tokens;
}

function splitCodeBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const prose: string[] = [];
  const code: string[] = [];
  let fence: string | undefined;
  let language: string | undefined;

  const flushProse = () => {
    const value = prose.join("\n").replace(/^\n+|\n+$/g, "");
    if (value) blocks.push({ text: value, type: "text" });
    prose.length = 0;
  };
  const flushCode = () => {
    blocks.push({ ...(language ? { language } : {}), text: code.join("\n"), type: "code" });
    code.length = 0;
  };

  for (const line of text.split(/\r?\n/)) {
    if (!fence) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!opening || (opening[1]?.startsWith("`") && opening[2]?.includes("`"))) {
        prose.push(line);
        continue;
      }
      flushProse();
      fence = opening[1];
      language = opening[2]?.trim().split(/\s+/, 1)[0]?.slice(0, 32) || undefined;
      continue;
    }

    const closing = line.match(/^ {0,3}(`+|~+)\s*$/)?.[1];
    if (closing && closing[0] === fence[0] && closing.length >= fence.length) {
      flushCode();
      fence = undefined;
      language = undefined;
    } else {
      code.push(line);
    }
  }

  if (fence) flushCode();
  flushProse();
  return blocks;
}

function keyMarkdownBlocks(blocks: MarkdownBlock[]) {
  let textOrdinal = 0;
  let codeOrdinal = 0;
  return blocks.map((block) => {
    if (block.type === "text") {
      textOrdinal += 1;
      return { block, key: `text:${textOrdinal}` };
    }
    codeOrdinal += 1;
    return { block, key: `code:${codeOrdinal}` };
  });
}

const explorationToolNames = new Set([
  "find",
  "glob",
  "grep",
  "read",
  "search",
  "web_search",
  "websearch",
]);
const patchToolNames = new Set([
  "apply_patch",
  "edit",
  "multi_edit",
  "multiedit",
  "patch",
  "write",
]);
const shellToolNames = new Set(["bash", "command", "exec", "shell", "terminal"]);
const skillToolNames = new Set(["skill", "use_skill"]);

function toolCategory(tool: AssistantTool): ToolCategory {
  const name = tool.name.trim().toLocaleLowerCase();
  if (explorationToolNames.has(name)) return "exploration";
  if (patchToolNames.has(name)) return "edit";
  if (shellToolNames.has(name)) return "shell";
  if (skillToolNames.has(name)) return "skill";
  return "other";
}

function toolGroupPresentation(category: ToolGroupCategory, tools: AssistantTool[]) {
  if (category === "edit") {
    const files = new Set(tools.flatMap((tool) => toolPresentation(tool).files));
    return {
      detail:
        files.size > 0
          ? `${files.size} ${files.size === 1 ? "file" : "files"}`
          : `${tools.length} edits`,
      label: "Edited",
    };
  }
  if (category === "shell") {
    return { detail: `${tools.length} commands`, label: "Ran shell" };
  }
  if (category === "skill") {
    const skills = [...new Set(tools.map((tool) => toolPresentation(tool).detail).filter(Boolean))];
    return {
      detail: skills.length > 0 ? skills.join(", ") : `${tools.length} uses`,
      label: "Used Skill",
    };
  }

  const labels: string[] = [];
  for (const tool of tools) {
    const label = capitalize(toolPresentation(tool).label);
    if (!labels.includes(label)) labels.push(label);
  }
  const visibleLabels = labels.slice(0, 3);
  const omittedLabels = labels.length - visibleLabels.length;
  return {
    detail: `${tools.length} calls`,
    label: `Used ${visibleLabels.join(", ")}${omittedLabels > 0 ? `, +${omittedLabels}` : ""}`,
  };
}

function completedToolLabel(category: ToolCategory, fallback: string) {
  if (category === "edit") return "Edited";
  if (category === "shell") return "Ran";
  if (category === "skill") return "Used Skill";
  return `Used ${capitalize(fallback)}`;
}

function toolPresentation(tool: AssistantTool) {
  const name = tool.name.trim().toLocaleLowerCase();
  const input = toolInputRecord(tool);
  const files = patchToolNames.has(name) ? patchFiles(input) : [];
  const status = toolStatusLabel(tool);
  let command: string | undefined;
  let label = tool.name.trim() || "Tool";
  let detail: string | undefined;

  if (explorationToolNames.has(name)) {
    label = sentenceCase(name.replaceAll("_", " "));
    detail = firstInputString(
      input,
      name === "read" ? ["path", "filePath", "file_path"] : ["pattern", "query", "path"],
    );
  } else if (patchToolNames.has(name)) {
    label = "Patch";
    detail = files.length > 1 ? `${files.length} files` : files[0];
  } else if (shellToolNames.has(name)) {
    label = "Shell";
    command = firstInputString(input, ["command", "cmd"]);
    detail = command;
  } else if (skillToolNames.has(name)) {
    label = "Skill";
    detail = firstInputString(input, ["name", "skill"]);
  }

  return {
    command,
    detail: [detail, status].filter(Boolean).join(" · ") || undefined,
    files,
    label,
  };
}

function canExpandTool(tool: AssistantTool) {
  if (tool.state.status === "error") return true;
  if (tool.state.status !== "completed") return false;
  return Boolean(tool.state.content?.length || toolPresentation(tool).files.length);
}

function toolInputRecord(tool: AssistantTool): Record<string, unknown> | undefined {
  if (tool.state.status !== "streaming") return tool.state.input;
  if (tool.state.input.length > 16_384) return undefined;
  try {
    const value: unknown = JSON.parse(tool.state.input);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function firstInputString(
  input: Record<string, unknown> | undefined,
  keys: string[],
  maxCharacters = 384,
) {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, maxCharacters);
  }
  return undefined;
}

function patchFiles(input: Record<string, unknown> | undefined) {
  const files: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const file = value.trim().replace(/^[ab]\//, "");
    if (file && file !== "/dev/null" && !files.includes(file) && files.length < maxAttachments) {
      files.push(sanitizeTranscriptText(file, 256));
    }
  };
  for (const key of ["path", "file", "filePath", "file_path"]) add(input?.[key]);
  const inputFiles = input?.files;
  if (Array.isArray(inputFiles)) for (const file of inputFiles) add(file);
  const patch = firstInputString(input, ["patchText", "patch", "diff"], maxSanitizedInput);
  if (patch) {
    for (const line of patch.split(/\r?\n/)) {
      const match =
        /^(?:\*\*\* (?:Add|Update|Delete) File:|\*\*\* Move to:|--- [ab]\/|\+\+\+ [ab]\/)(.+)$/.exec(
          line,
        );
      if (match?.[1]) add(match[1]);
    }
  }
  return files;
}

function toolStatusLabel(tool: AssistantTool) {
  switch (tool.state.status) {
    case "streaming":
      return "Preparing";
    case "running":
      return "Running";
    case "error":
      return "Failed";
    case "completed":
      return undefined;
  }
}

function activityGroupStatus(tools: AssistantTool[]) {
  if (tools.some((tool) => tool.state.status === "error")) return "Failed";
  if (tools.some((tool) => tool.state.status === "running")) return "Running";
  if (tools.some((tool) => tool.state.status === "streaming")) return "Preparing";
  return undefined;
}

function isActivityInFlight(tools: AssistantTool[]) {
  return tools.some((tool) => tool.state.status === "running" || tool.state.status === "streaming");
}

function shellStatusLabel(message: ShellMessage) {
  if (message.status === "running") return "Running";
  if (message.status === "timeout") return "Timed out";
  if (message.status === "killed") return "Killed";
  if (message.exit !== undefined && message.exit !== 0) return "Failed";
  return undefined;
}

function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return undefined;
  if (milliseconds < 1_000) return `${Math.max(1, Math.round(milliseconds))}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInlineReasoning(text: string) {
  return text.length <= maxInlineReasoning && !/[\r\n]/.test(text);
}

function isSettledReasoning(
  message: AssistantMessage,
  part: Extract<AssistantPart, { type: "reasoning" }>,
) {
  return part.time?.completed !== undefined || message.time.completed !== undefined;
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Location";
}

function sentenceCase(value: string) {
  return value ? `${value[0]?.toLocaleUpperCase()}${value.slice(1).toLocaleLowerCase()}` : value;
}

function capitalize(value: string) {
  return value ? `${value[0]?.toLocaleUpperCase()}${value.slice(1)}` : value;
}

function subagentStateLabel(state: SubagentPresentation["state"]) {
  switch (state) {
    case "streaming":
      return "PREPARING";
    case "running":
      return "RUNNING";
    case "completed":
      return "COMPLETED";
    case "error":
      return "FAILED";
  }
}

function keyToolContent(content: ToolOutput[]) {
  let textOrdinal = 0;
  let fileOrdinal = 0;
  return content.map((item) => {
    if (item.type === "text") {
      textOrdinal += 1;
      return { item, key: `text:${textOrdinal}` };
    }
    fileOrdinal += 1;
    return { item, key: `file:${fileOrdinal}` };
  });
}

function keyDisclosureText(entries: string[]) {
  let ordinal = 0;
  return entries.map((text) => {
    ordinal += 1;
    return { key: `text:${ordinal}`, text };
  });
}

const styles = StyleSheet.create({
  activity: {
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  activityAction: { color: palette.signal, fontSize: 11, fontWeight: "700" },
  activityActionLargeText: { alignSelf: "flex-start" },
  activityCopy: {
    alignItems: "baseline",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.xs,
    minWidth: 0,
  },
  activityCopyLargeText: { alignItems: "flex-start", flexDirection: "column", gap: 2 },
  activityDetail: { color: palette.dim, flexShrink: 1, fontSize: 13, lineHeight: 18 },
  activityFile: {
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    color: palette.dim,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  activityHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "space-between",
    minHeight: 44,
    paddingVertical: 8,
  },
  activityHeaderLargeText: { alignItems: "flex-start", flexDirection: "column" },
  activityLabel: { color: palette.ink, fontSize: 13, fontWeight: "800" },
  activityNested: { marginLeft: 12 },
  activityStandalone: { marginHorizontal: space.lg, paddingVertical: space.xs },
  assistantFooter: { color: palette.dim, fontSize: 11, marginTop: space.xs },
  assistantRow: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  attachmentChip: {
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "100%",
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  attachmentLabel: { color: palette.dim, fontSize: 11, fontWeight: "600" },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.sm },
  bodyText: { color: palette.ink, fontSize: 16, lineHeight: 24 },
  boldText: { fontWeight: "800" },
  codeBlock: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: space.xs,
    padding: 12,
  },
  codeLanguage: {
    color: palette.signal,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  codeText: {
    color: palette.ink,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
  },
  disclosure: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  disclosureAction: { color: palette.signal, fontSize: 12, fontWeight: "700" },
  disclosureActionLargeText: { alignSelf: "flex-start" },
  disclosureHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.xs,
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  disclosureHeaderLargeText: { alignItems: "flex-start", flexDirection: "column" },
  disclosureLabel: {
    color: palette.dim,
    flex: 1,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    minWidth: 0,
  },
  disclosureLabelLargeText: { flex: 0, width: "100%" },
  diffAction: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: 44,
    paddingRight: space.md,
  },
  diffActionLabel: { color: palette.signal, fontSize: 13, fontWeight: "700" },
  errorText: { color: palette.danger, fontSize: 14, lineHeight: 21 },
  markdownBlockSpacing: { marginTop: space.sm },
  linkText: { color: palette.signal, textDecorationLine: "underline" },
  notice: {
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: space.lg,
    paddingVertical: 12,
  },
  noticeLabel: { color: palette.warm, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  noticeText: { color: palette.dim, fontSize: 13, lineHeight: 19, marginTop: 5 },
  omittedText: { color: palette.dim, fontSize: 11, marginTop: 7 },
  outputText: {
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    color: palette.dim,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
  },
  pressed: { opacity: 0.7 },
  reasoningLabel: { color: palette.warm, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  reasoningText: { color: palette.dim, fontSize: 13, lineHeight: 19 },
  statusText: { color: palette.dim, fontSize: 12 },
  subagent: {
    backgroundColor: palette.signalDark,
    borderColor: palette.signal,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.xs,
    padding: 12,
  },
  subagentCompleted: {
    backgroundColor: "transparent",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    borderRadius: 0,
    borderWidth: 0,
    gap: 2,
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  subagentAction: { justifyContent: "center", minHeight: 44, paddingRight: space.md },
  subagentActionLabel: { color: palette.signal, fontSize: 13, fontWeight: "700" },
  subagentActions: { flexDirection: "row", flexWrap: "wrap" },
  subagentAgent: { color: palette.dim, fontSize: 12 },
  subagentHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    justifyContent: "space-between",
  },
  subagentHeadingLargeText: { alignItems: "flex-start", flexDirection: "column", gap: space.xs },
  subagentLabel: { color: palette.signal, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  subagentResult: {
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 21,
    paddingTop: space.sm,
  },
  subagentState: { color: palette.dim, fontSize: 10, fontWeight: "900", letterSpacing: 0.6 },
  subagentStateError: { color: palette.danger },
  subagentStateRunning: { color: palette.warm },
  subagentTitle: { color: palette.ink, fontSize: 16, fontWeight: "700" },
  textAction: { alignSelf: "flex-start", minHeight: 40, paddingVertical: 10 },
  textActionLabel: { color: palette.signal, fontSize: 12, fontWeight: "700" },
  userBubble: {
    backgroundColor: palette.signalDark,
    borderColor: palette.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    maxWidth: "92%",
    padding: 14,
  },
  userBubbleLargeText: { maxWidth: "100%" },
  userLabel: { color: palette.warm, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  userRow: { alignItems: "flex-end", paddingHorizontal: space.lg, paddingVertical: space.sm },
  userText: { color: palette.ink, fontSize: 16, lineHeight: 23, marginTop: 7 },
});
