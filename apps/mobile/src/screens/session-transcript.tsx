import type { SessionMessageInfo } from "@opencode2-mobile/opencode-adapter";
import { memo, useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { applicationName } from "../application-name";
import { CopyTextButton } from "../components/copy-text-button";
import { SelectableTranscriptText } from "../components/selectable-transcript-text";
import { useDelayedVisibility } from "../components/use-delayed-visibility";
import { recordTranscriptRowCommit } from "../state/transcript-performance";
import { markdownPalette, palette, radius, space, typeRamp, typography } from "../theme";
import type { PendingPromptPreview } from "./prompt-admission-model";
import { ShellObservation } from "./session-shell-output";
import {
  getSubagentPresentation,
  parseSubagentProtocolText,
  type SubagentPresentation,
  type SubagentProtocolText,
  sanitizeTranscriptText,
} from "./session-transcript-model";
import { parseTranscriptLink } from "./transcript-link-card";
import { InlineTranscriptMarkdown, TranscriptMarkdown } from "./transcript-markdown";

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

export type TranscriptItem =
  | SessionMessageInfo
  | {
      type: "updates-group";
      id: string;
      messages: SessionMessageInfo[];
    }
  | {
      type: "activity-group";
      id: string;
      messages: SessionMessageInfo[];
      count: number;
      running: boolean;
    };

export type TranscriptListItem = TranscriptItem | PendingPromptPreview;

export function PendingPromptRow({
  preview,
  largeText = false,
}: {
  preview: PendingPromptPreview;
  largeText?: boolean;
}) {
  const label = {
    sending: "Sending",
    queued: "Queued",
    steering: "Waiting to steer",
    "awaiting-transcript": "Sent · waiting for transcript",
    "unknown-delivery": "Delivery unknown",
  }[preview.status];
  return (
    <View style={styles.userRow}>
      <View
        style={[styles.userBubble, styles.pendingBubble, largeText && styles.userBubbleLargeText]}
      >
        <ExpandableText measureWidth style={styles.pendingText} text={preview.text} />
        <Text
          accessibilityLiveRegion="polite"
          dynamicTypeRamp={typeRamp.caption}
          style={styles.pendingLabel}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

export function groupTranscriptMessages(
  messages: SessionMessageInfo[],
  detailed: boolean,
  _showReasoning: boolean,
): TranscriptItem[] {
  // Empty assistant snapshots arrive before their first projected part. They
  // are not transcript content and must not split a tool group or add spacing.
  const visibleMessages = messages.filter((message) => !isEmptyAssistantSnapshot(message));
  if (detailed) return visibleMessages;
  const result: TranscriptItem[] = [];
  let pending: SessionMessageInfo[] = [];
  let count = 0;
  let running = false;
  const flush = () => {
    const first = pending[0];
    if (first && count > 0) {
      result.push({
        type: "activity-group",
        id: `activity:${first.id}`,
        messages: pending,
        count,
        running,
      });
    } else {
      for (const message of pending) {
        if (isTranscriptUpdate(message)) {
          const previous = result.at(-1);
          if (previous?.type === "updates-group") previous.messages.push(message);
          else
            result.push({
              type: "updates-group",
              id: `updates:${message.id}`,
              messages: [message],
            });
        } else result.push(message);
      }
    }
    pending = [];
    count = 0;
    running = false;
  };
  // Split mixed assistant messages at prose boundaries so adjacent tool runs
  // share one disclosure, even when the server batches prose and tools together.
  const segments = visibleMessages.flatMap((message): SessionMessageInfo[] => {
    if (message.type !== "assistant" || message.error || message.retry) return [message];
    const runs: AssistantMessage["content"][] = [];
    for (const part of message.content) {
      const previous = runs[runs.length - 1];
      if (previous && (previous[0]?.type === "text") === (part.type === "text"))
        previous.push(part);
      else runs.push([part]);
    }
    if (runs.length < 2) return [message];
    return runs.map((content, index) => ({
      ...message,
      id: index === 0 ? message.id : `${message.id}:segment:${index}`,
      content,
    }));
  });
  for (const message of segments) {
    if (message.type === "idle" && message.outcome === "succeeded") continue;
    if (isTranscriptUpdate(message)) {
      pending.push(message);
      continue;
    }
    if (
      message.type === "assistant" &&
      !message.error &&
      !message.retry &&
      message.content.length > 0 &&
      message.content.every((part) =>
        part.type === "reasoning" ? true : part.type === "tool" && !getSubagentPresentation(part),
      )
    ) {
      pending.push(message);
      for (const part of message.content) {
        if (part.type !== "tool") continue;
        count += 1;
        running ||= part.state.status === "running" || part.state.status === "streaming";
      }
    } else {
      flush();
      result.push(message);
    }
  }
  flush();
  return result;
}

function isTranscriptUpdate(message: SessionMessageInfo) {
  return message.type === "synthetic" || message.type === "system" || message.type === "skill";
}

function isEmptyAssistantSnapshot(message: SessionMessageInfo) {
  return (
    message.type === "assistant" && message.content.length === 0 && !message.error && !message.retry
  );
}

// The server pages are newest-first; assistant parts inside a message are not.
// Group in reading order, then invert only the resulting rows for the native list.
export function buildTranscriptPresentation(
  messages: SessionMessageInfo[],
  detailed: boolean,
  showReasoning: boolean,
) {
  const chronological = [...messages].reverse();
  const items = groupTranscriptMessages(chronological, detailed, showReasoning);
  const footers = new Map<string, number | undefined>();
  let hasTurnStart = false;
  let start: number | undefined;
  let end: number | undefined;
  let incomplete = false;
  let lastResponse: string | undefined;
  const finish = () => {
    if (lastResponse) {
      footers.set(
        lastResponse,
        hasTurnStart && !incomplete && start !== undefined && end !== undefined
          ? Math.max(0, end - start)
          : undefined,
      );
    }
    start = undefined;
    end = undefined;
    incomplete = false;
    lastResponse = undefined;
  };
  for (const item of items) {
    if (item.type === "user") {
      finish();
      hasTurnStart = true;
      start = item.time.created;
      continue;
    }
    const messages =
      item.type === "activity-group" || item.type === "updates-group" ? item.messages : [item];
    for (const message of messages) {
      if (message.type !== "assistant") continue;
      if (message.time.completed === undefined) incomplete = true;
      else end = Math.max(end ?? message.time.completed, message.time.completed);
      if (
        item.type === "assistant" &&
        message.content.some((part) => part.type === "text" && part.text.trim())
      ) {
        lastResponse = item.id;
      }
    }
  }
  finish();
  return { items: items.reverse(), footers };
}

export function TranscriptUpdatesGroup({
  item,
  largeText,
  onOpenSubagent,
}: {
  item: Extract<TranscriptItem, { type: "updates-group" }>;
  largeText: boolean;
  onOpenSubagent: (sessionID: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.activityGroup}>
      <ActivityHeader
        canExpand
        expanded={expanded}
        label="Updates"
        largeText={largeText}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded
        ? item.messages.map((message) => (
            <SessionTranscriptRow
              key={message.id}
              message={message}
              detailed
              compactActivity
              largeText={largeText}
              onOpenSubagent={onOpenSubagent}
            />
          ))
        : null}
    </View>
  );
}

export function activitySummary(messages: SessionMessageInfo[]) {
  const counts = new Map<string, number>();
  let failures = 0;
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool") continue;
      if (part.state.status === "error") failures += 1;
      const label = capitalize(part.name);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return `Used ${total} ${[...counts.keys()].join(", ")}${failures ? ` · ${failures} failed` : ""}`;
}

export function activityFailureSummary(messages: SessionMessageInfo[]) {
  let failed = 0;
  let interrupted = 0;
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool" || part.state.status !== "error") continue;
      // Classify only. Never promote raw server error text into the summary.
      if (/\b(abort(?:ed)?|interrupt(?:ed)?|cancel(?:led|ed)?)\b/i.test(part.state.error.message)) {
        interrupted += 1;
      } else {
        failed += 1;
      }
    }
  }
  return [failed ? `${failed} failed` : "", interrupted ? `${interrupted} interrupted` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function TranscriptActivityGroup({
  waitingFor,
  item,
  largeText,
  showReasoning,
  onOpenDiff,
  onOpenSubagent,
}: {
  waitingFor?: "permission" | "input" | undefined;
  item: Extract<TranscriptItem, { type: "activity-group" }>;
  largeText: boolean;
  showReasoning: boolean;
  onOpenDiff: () => void;
  onOpenSubagent: (sessionID: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const failureSummary = activityFailureSummary(item.messages);
  const hasRun = useRef(item.running);
  if (item.running) hasRun.current = true;
  const settled = useDelayedVisibility(hasRun.current && !item.running, item.id);
  const running = item.running || (hasRun.current && !settled && !failureSummary);
  const progressLabel = waitingFor
    ? `Waiting for ${waitingFor}`
    : item.running
      ? "Running"
      : failureSummary
        ? /failed/.test(failureSummary)
          ? "Failed"
          : "Interrupted"
        : running
          ? "Running"
          : "Finished";
  return (
    <View style={styles.activityGroup}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.count} tool calls`}
        accessibilityHint={`${item.running ? (waitingFor ? `Waiting for ${waitingFor}. ` : "Running. ") : ""}${activitySummary(item.messages)}. ${failureSummary ? `${failureSummary}. ` : ""}Expand or collapse execution details.`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={[styles.activityGroupHeader, largeText && styles.activityGroupHeaderLargeText]}
      >
        <Text
          dynamicTypeRamp={typeRamp.control}
          style={[styles.activitySummary, largeText && styles.activitySummaryLargeText]}
        >
          Used <Text style={styles.activityLabel}>{activitySummary(item.messages).slice(5)}</Text>
        </Text>
        <Text
          dynamicTypeRamp={typeRamp.caption}
          style={[styles.toolProgress, failureSummary && styles.toolProgressFailed]}
        >
          {progressLabel}
        </Text>
        <Text accessibilityElementsHidden style={styles.disclosureAction}>
          {expanded ? "⌄" : "›"}
        </Text>
      </Pressable>
      {failureSummary && !expanded ? (
        <Text dynamicTypeRamp={typeRamp.caption} style={styles.activityFailureSummary}>
          {failureSummary}. Expand for details.
        </Text>
      ) : null}
      {expanded
        ? item.messages.map((message) => (
            <SessionTranscriptRow
              key={message.id}
              detailed
              compactActivity
              message={message}
              largeText={largeText}
              showReasoning={showReasoning}
              onOpenDiff={onOpenDiff}
              onOpenSubagent={onOpenSubagent}
            />
          ))
        : null}
    </View>
  );
}

export const SessionTranscriptRow = memo(function SessionTranscriptRow({
  detailed = false,
  compactActivity = false,
  hideFooter = false,
  showReasoning = true,
  largeText = false,
  message,
  modelName,
  turnDuration,
  onOpenDiff,
  onOpenSubagent,
}: {
  detailed?: boolean;
  compactActivity?: boolean;
  hideFooter?: boolean;
  showReasoning?: boolean;
  largeText?: boolean;
  message: SessionMessageInfo;
  modelName?: string | undefined;
  turnDuration?: number | null | undefined;
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
            <ExpandableText measureWidth style={styles.userText} text={message.text} />
            <AttachmentLabels largeText={largeText} message={message} />
          </View>
        </View>
      );
    case "assistant": {
      if (isEmptyAssistantSnapshot(message)) return null;
      const visibleContent = message.content.slice(0, maxAssistantParts);
      const responseParts = visibleContent.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      );
      let copyTruncated = message.content
        .slice(maxAssistantParts)
        .some((part) => part.type === "text");
      const responseText = responseParts
        .map((text) => {
          const safe = sanitizeTranscriptText(text.slice(0, maxSanitizedInput), maxVisibleText + 1);
          copyTruncated ||= safe.length > maxVisibleText || text.length > maxSanitizedInput;
          return safe.slice(0, maxVisibleText);
        })
        .join("\n\n");
      return (
        <View style={compactActivity ? styles.compactActivity : styles.assistantRow}>
          {(detailed
            ? visibleContent.map(
                (part, index): AssistantPresentationItem => ({
                  type: "part",
                  key: `part:${index}`,
                  part,
                }),
              )
            : groupAssistantParts(visibleContent)
          ).map((item) => {
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
              if (!showReasoning) return null;
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
                nested={compactActivity}
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
          {!hideFooter && (responseText || (!compactActivity && hasNarrativeContent(message))) ? (
            <View style={styles.responseFooter}>
              {responseText && !hideFooter ? (
                <CopyTextButton
                  iconOnly
                  label={copyTruncated ? "Copy available response" : "Copy response"}
                  text={responseText}
                />
              ) : null}
              {!compactActivity && !hideFooter && hasNarrativeContent(message) ? (
                <AssistantFooter
                  message={message}
                  modelName={modelName}
                  turnDuration={turnDuration}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      );
    }
    case "shell":
      return <ShellDisclosure largeText={largeText} message={message} />;
    case "synthetic":
      return (
        <Notice
          compact={!detailed}
          label={message.description || "Generated context"}
          text={message.text}
        />
      );
    case "system":
      return (
        <Notice compact={!detailed} label={message.description || "System"} text={message.text} />
      );
    case "skill":
      return (
        <View style={compactActivity ? styles.compactActivity : styles.activityStandalone}>
          <Disclosure
            label={`Loaded ${message.name} skill`}
            largeText={largeText}
            markdown
            text={message.text}
          />
        </View>
      );
    case "agent-switched":
      return (
        <View style={styles.notice}>
          <Text dynamicTypeRamp={typeRamp.control} style={styles.activitySummary}>
            Agent changed to{" "}
            <Text style={styles.activityLabel}>
              {sanitizeTranscriptText(capitalize(message.agent), 256)}
            </Text>
          </Text>
        </View>
      );
    case "model-switched":
      return <Notice compact={!detailed} label="Model changed" text={message.model.id} />;
    case "location-switched":
      return (
        <Notice
          compact={!detailed}
          label="Location changed"
          text={basename(message.location.directory)}
        />
      );
    case "idle":
      if (!detailed && message.outcome === "succeeded") return null;
      return (
        <Notice
          error={message.outcome === "failed"}
          label={
            message.outcome === "succeeded"
              ? "Turn completed"
              : message.outcome === "failed"
                ? "Turn failed"
                : "Turn interrupted"
          }
        />
      );
    case "compaction":
      return message.status === "failed" ? (
        <Notice error label="Compaction failed" text={message.error.message} />
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
    if (part.type === "tool" && part.state.status !== "error" && !getSubagentPresentation(part)) {
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
  if (skillToolNames.has(tool.name.trim().toLocaleLowerCase()) && tool.state.status !== "error") {
    const metadata = tool.state.status === "streaming" ? undefined : tool.state.metadata;
    const name =
      firstInputString(metadata, ["name"]) ??
      firstInputString(toolInputRecord(tool), ["id", "name", "skill"]);
    const running = tool.state.status === "running" || tool.state.status === "streaming";
    const content = tool.state.status === "completed" ? tool.state.content : [];
    const label = `${running ? "Loading" : "Loaded"} ${name ? `${sanitizeTranscriptText(name, 256)} skill` : "Skill"}`;
    return (
      <View>
        <Pressable
          accessibilityRole={content.length ? "button" : undefined}
          accessibilityLabel={label}
          accessibilityState={content.length ? { expanded } : undefined}
          disabled={!content.length}
          onPress={() => setExpanded((value) => !value)}
          style={styles.loadedSkill}
        >
          <Text dynamicTypeRamp={typeRamp.control} style={styles.activitySummary}>
            {running ? "Loading" : "Loaded"}{" "}
            <Text style={styles.activityLabel}>
              {name ? sanitizeTranscriptText(name, 256) : "Skill"}
            </Text>
            {name ? " skill" : ""}
          </Text>
        </Pressable>
        {expanded ? (
          <ScrollView
            accessibilityLabel="Skill content"
            nestedScrollEnabled
            style={styles.toolOutputScroll}
          >
            {keyToolContent(content.slice(0, maxToolOutputs)).map(({ item, key }) => (
              <ExpandableText
                key={key}
                style={styles.outputText}
                text={item.type === "text" ? item.text : (item.name ?? "File result")}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>
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
  const metadata = tool.state.status === "streaming" ? undefined : tool.state.metadata;
  // A terminal snapshot already contains the authoritative result. Background
  // handoffs keep metadata.status="running" even after the command later exits.
  const savedShellOutput =
    metadata?.status === "exited" ||
    metadata?.status === "timeout" ||
    metadata?.status === "killed";
  const shellID =
    category === "shell" && !savedShellOutput && typeof metadata?.shellID === "string"
      ? metadata.shellID
      : undefined;
  const input = toolInputRecord(tool);
  const commandKey = typeof input?.command === "string" ? "command" : "cmd";
  const inputDetails =
    input && category === "shell"
      ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== commandKey))
      : input;
  const label =
    !nested && tool.state.status === "completed" && !shellID
      ? completedToolLabel(category, presentation.label)
      : presentation.label;
  const visibleContent = content.slice(0, maxToolOutputs);
  return (
    <View
      style={[
        styles.activity,
        error && !nested && styles.activityError,
        nested && styles.activityNested,
      ]}
    >
      <ActivityHeader
        canExpand={canExpand}
        detail={expanded ? toolStatusLabel(tool) : nested && error ? error : presentation.detail}
        error={Boolean(error)}
        expanded={expanded}
        label={label}
        largeText={largeText}
        onPress={() => setExpanded((current) => !current)}
      />
      <View style={styles.toolDetails}>
        {expanded && inputDetails && Object.keys(inputDetails).length > 0 ? (
          <ScrollView
            accessibilityLabel={`${presentation.label} input`}
            nestedScrollEnabled
            style={styles.toolOutputScroll}
          >
            <ExpandableText
              style={styles.commandText}
              text={JSON.stringify(inputDetails, null, 2).slice(0, maxSanitizedInput)}
            />
          </ScrollView>
        ) : null}
        {expanded
          ? presentation.files.map((file) => (
              <SelectableTranscriptText
                dynamicTypeRamp={typeRamp.control}
                key={file}
                selectable
                style={styles.activityFile}
              >
                {file}
              </SelectableTranscriptText>
            ))
          : null}
        {expanded && category === "shell" ? (
          <ShellObservation shellID={shellID}>
            {(observation) => (
              <View>
                {observation ? (
                  <Text style={styles.statusText}>
                    {observation.statusLabel === "Running" && tool.state.status === "completed"
                      ? "Running in background"
                      : observation.statusLabel}
                  </Text>
                ) : null}
                {observation?.error ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={observation.retry}
                    style={styles.textAction}
                  >
                    <Text style={styles.textActionLabel}>Retry shell output</Text>
                  </Pressable>
                ) : null}
                {observation?.snapshot?.truncated ? (
                  <Text style={styles.omittedText}>Showing recent output.</Text>
                ) : null}
                <ShellOutput
                  command={firstInputString(input, ["command", "cmd"], maxSanitizedInput)}
                  text={
                    observation
                      ? (observation.snapshot?.output ?? "")
                      : visibleContent
                          .flatMap((item) =>
                            item.type === "text" ? [parseSubagentProtocolText(item.text).text] : [],
                          )
                          .join("\n\n")
                  }
                />
              </View>
            )}
          </ShellObservation>
        ) : null}
        {expanded
          ? keyToolContent(visibleContent).map(({ item, key }) =>
              item.type === "text" ? (
                category === "shell" ? null : (
                  <ScrollView
                    key={key}
                    accessibilityLabel={`${presentation.label} output`}
                    nestedScrollEnabled
                    style={styles.toolOutputScroll}
                  >
                    <ExpandableText
                      style={styles.outputText}
                      text={parseSubagentProtocolText(item.text).text}
                    />
                  </ScrollView>
                )
              ) : (
                <SelectableTranscriptText
                  dynamicTypeRamp={typeRamp.body}
                  key={key}
                  style={styles.outputText}
                >
                  {sanitizeTranscriptText(
                    item.name?.trim() ? basename(item.name.trim()) : "File result",
                    256,
                  )}
                </SelectableTranscriptText>
              ),
            )
          : null}
        {expanded && content.length > visibleContent.length ? (
          <Text style={styles.omittedText}>Additional tool output omitted on this device.</Text>
        ) : null}
        {error && (!nested || expanded) ? (
          <ExpandableText error style={styles.errorText} text={error} />
        ) : null}
        {(!nested || expanded) && category === "edit" && onOpenDiff ? (
          <DiffAction onPress={onOpenDiff} />
        ) : null}
      </View>
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
  error = false,
  detail,
  expanded,
  label,
  largeText,
  onPress,
}: {
  canExpand: boolean;
  error?: boolean;
  detail?: string | undefined;
  expanded: boolean;
  label: string;
  largeText: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={canExpand ? "button" : undefined}
      accessibilityLabel={`${label}${detail ? ` ${detail}` : ""}${canExpand ? (expanded ? " Hide" : " Show") : ""}`}
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
            numberOfLines={largeText ? undefined : 1}
            style={[styles.activityDetail, error && { color: palette.danger }]}
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
          {expanded ? "⌄" : "›"}
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
        {expanded && message.output?.output ? (
          <ShellOutput command={message.command} text={message.output.output} />
        ) : null}
      </View>
    </View>
  );
}

function ShellOutput({ command, text }: { command?: string | undefined; text: string }) {
  const safeText = sanitizeTranscriptText(text, text.length);
  return (
    <View style={styles.shellOutputBox}>
      <View style={styles.shellOutputToolbar}>
        <CopyTextButton iconOnly label="Copy shell output" text={safeText} />
      </View>
      <ScrollView
        accessibilityLabel="Shell output"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        style={styles.shellOutputScroll}
      >
        {command ? (
          <View style={styles.shellCommandHeader}>
            <SelectableTranscriptText dynamicTypeRamp={typeRamp.body} style={styles.shellCommand}>
              {sanitizeTranscriptText(command, maxSanitizedInput)}
            </SelectableTranscriptText>
          </View>
        ) : null}
        <SelectableTranscriptText
          dynamicTypeRamp={typeRamp.body}
          style={[styles.shellOutputText, !command && styles.shellOutputWithoutCommand]}
        >
          {safeText}
        </SelectableTranscriptText>
      </ScrollView>
    </View>
  );
}

function AssistantFooter({
  message,
  modelName,
  turnDuration,
}: {
  message: AssistantMessage;
  modelName?: string | undefined;
  turnDuration?: number | null | undefined;
}) {
  const duration =
    turnDuration === null
      ? undefined
      : turnDuration !== undefined
        ? formatDuration(turnDuration)
        : message.time.completed !== undefined
          ? formatDuration(message.time.completed - message.time.created)
          : undefined;
  return (
    <Text dynamicTypeRamp={typeRamp.caption} style={styles.assistantFooter}>
      {sanitizeTranscriptText(sentenceCase(message.agent || "Assistant"), 128)} ·{" "}
      {sanitizeTranscriptText(modelName || message.model.id, 128)}
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

function Notice({
  compact,
  error,
  label,
  text,
}: {
  compact?: boolean;
  error?: boolean;
  label: string;
  text?: string;
}) {
  if (compact && text && !error)
    return (
      <View style={styles.notice}>
        <Disclosure label={label} largeText={false} text={text} />
      </View>
    );
  return (
    <View style={styles.notice}>
      <Text
        dynamicTypeRamp={typeRamp.caption}
        style={[styles.noticeLabel, error && { color: palette.danger }]}
      >
        {sanitizeTranscriptText(label, 256)}
      </Text>
      {text ? <ExpandableText style={styles.noticeText} text={text} /> : null}
    </View>
  );
}

function ExpandableText({
  error,
  markdown = false,
  measureWidth = false,
  style,
  text,
}: {
  error?: boolean;
  markdown?: boolean;
  measureWidth?: boolean;
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
      {measureWidth && Platform.OS === "ios" ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.textWidthMeasurement}
        >
          <Text dynamicTypeRamp={typeRamp.body} style={style}>
            {visibleText}
          </Text>
        </View>
      ) : null}
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

function MarkdownText({ style, text }: { style: object; text: string }) {
  return <TranscriptMarkdown style={style} text={text} onOpenLink={openTranscriptUrl} />;
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
    <InlineTranscriptMarkdown
      prefix={prefix}
      prefixStyle={prefixStyle}
      style={style}
      text={text}
      onOpenLink={openTranscriptUrl}
    />
  );
}

function LinkifiedText({ style, text }: { style: object; text: string }) {
  return (
    <SelectableTranscriptText dynamicTypeRamp={typeRamp.body} style={style}>
      {LinkifiedTextContent({ text })}
    </SelectableTranscriptText>
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
    const href = parseTranscriptLink(url)?.toString();
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
  const parsed = parseTranscriptLink(url);
  if (!parsed) return;
  Alert.alert(
    "Open external link?",
    `This leaves ${applicationName} and opens ${parsed.host}. The site will receive your device's network address.`,
    [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () =>
          void Linking.openURL(parsed.toString()).catch(() => {
            Alert.alert(
              "Link could not be opened",
              "Try copying the link and opening it in your browser.",
            );
          }),
        text: "Open",
      },
    ],
  );
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
    detail = firstInputString(input, ["id", "name", "skill"]);
  } else if (name === "execute") {
    label = "Execute";
    detail = firstInputString(input, ["code"]);
  } else if (name === "webfetch") {
    label = "Webfetch";
    detail = firstInputString(input, ["url"]);
  }

  return {
    command,
    detail: [detail, status].filter(Boolean).join(" · ") || undefined,
    files,
    label,
  };
}

function canExpandTool(tool: AssistantTool) {
  if (toolInputRecord(tool)) return true;
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
  toolProgress: { ...typography.caption, color: palette.dim, flexShrink: 0 },
  toolProgressFailed: { color: palette.warm },
  activityFailureSummary: {
    ...typography.caption,
    color: palette.danger,
    paddingHorizontal: space.sm,
    paddingBottom: space.sm,
  },
  shellOutputBox: {
    backgroundColor: palette.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    borderRadius: radius.sm,
    overflow: "hidden",
    marginVertical: space.xs,
  },
  shellOutputToolbar: {
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  shellCommandHeader: {
    backgroundColor: palette.background,
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 12,
    paddingRight: 48,
  },
  shellCommand: { ...typography.code, color: palette.ink },
  shellOutputScroll: { maxHeight: 240 },
  shellOutputText: { ...typography.code, color: palette.dim, padding: 12 },
  shellOutputWithoutCommand: { paddingRight: 48 },
  toolOutputScroll: { maxHeight: 240, backgroundColor: palette.raised, borderRadius: radius.sm },
  activityGroup: {
    marginHorizontal: space.md,
    marginVertical: 0,
    overflow: "hidden",
  },
  commandText: {
    ...typography.code,
    backgroundColor: palette.raised,
    color: markdownPalette.code,
    padding: 12,
  },
  activityGroupHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: space.sm,
    justifyContent: "flex-start",
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: space.sm,
  },
  activityGroupHeaderLargeText: { flexWrap: "wrap" },
  activitySummaryLargeText: { flexBasis: "100%" },
  activity: {
    paddingHorizontal: 0,
  },
  loadedSkill: { minHeight: 44, justifyContent: "center", paddingVertical: 4 },
  activityAction: { ...typography.compactControl, color: palette.dim },
  activityError: {
    borderBottomWidth: 0,
    marginHorizontal: -space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.md,
  },
  activityActionLargeText: { alignSelf: "flex-start" },
  activityCopy: {
    alignItems: "baseline",
    flex: 1,
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: space.xs,
    minWidth: 0,
  },
  activityCopyLargeText: { alignItems: "flex-start", flexDirection: "column", gap: 2 },
  activityDetail: { ...typography.caption, color: palette.dim, flexShrink: 1 },
  activityFile: {
    ...typography.code,
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    color: palette.dim,
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
  activityLabel: { ...typography.compactControl, color: palette.ink },
  activitySummary: { ...typography.caption, color: palette.dim, flexShrink: 1 },
  activityNested: { marginLeft: 0 },
  compactActivity: { paddingLeft: space.sm, gap: 2 },
  toolDetails: { paddingLeft: 0 },
  responseFooter: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.xs },
  activityStandalone: { marginHorizontal: space.md, paddingVertical: space.xs },
  assistantFooter: { ...typography.caption, color: palette.dim, flexShrink: 1 },
  assistantRow: {
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
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
  attachmentLabel: { ...typography.label, color: palette.dim },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.sm },
  bodyText: { ...typography.chatBody, color: palette.ink },
  disclosure: {
    backgroundColor: "transparent",
  },
  disclosureAction: { ...typography.compactControl, color: palette.dim },
  disclosureActionLargeText: { alignSelf: "flex-start" },
  disclosureHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.xs,
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 10,
  },
  disclosureHeaderLargeText: { alignItems: "flex-start", flexDirection: "column" },
  disclosureLabel: {
    ...typography.label,
    color: palette.dim,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  disclosureLabelLargeText: { flex: 0, width: "100%" },
  diffAction: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: 44,
    paddingRight: space.md,
  },
  diffActionLabel: { ...typography.control, color: palette.signal },
  errorText: { ...typography.body, color: palette.danger },
  linkText: { color: markdownPalette.linkText, textDecorationLine: "underline" },
  notice: {
    marginHorizontal: space.md,
    paddingVertical: space.xs,
  },
  noticeLabel: { ...typography.label, color: palette.dim },
  noticeText: { ...typography.body, color: palette.dim, marginTop: 5 },
  omittedText: { ...typography.caption, color: palette.dim, marginTop: 7 },
  outputText: {
    ...typography.code,
    color: palette.dim,
    padding: 12,
  },
  pressed: { opacity: 0.7 },
  reasoningLabel: {
    ...typography.label,
    color: markdownPalette.reasoning,
  },
  reasoningText: { ...typography.chatBody, color: markdownPalette.reasoning },
  statusText: { ...typography.caption, color: palette.dim },
  subagent: {
    backgroundColor: palette.card,
    borderColor: palette.activity,
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
  subagentActionLabel: { ...typography.control, color: palette.signal },
  subagentActions: { flexDirection: "row", flexWrap: "wrap" },
  subagentAgent: { ...typography.caption, color: palette.dim },
  subagentHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    justifyContent: "space-between",
  },
  subagentHeadingLargeText: { alignItems: "flex-start", flexDirection: "column", gap: space.xs },
  subagentLabel: { ...typography.label, color: palette.activity },
  subagentResult: {
    ...typography.chatBody,
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    color: palette.ink,
    paddingTop: space.sm,
  },
  subagentState: { ...typography.label, color: palette.dim },
  subagentStateError: { color: palette.danger },
  subagentStateRunning: { color: palette.activity },
  subagentTitle: { ...typography.heading, color: palette.ink },
  textAction: { alignSelf: "flex-start", minHeight: 44, paddingVertical: 10 },
  textActionLabel: { ...typography.label, color: palette.signal },
  userBubble: {
    backgroundColor: palette.prompt,
    borderRadius: radius.sm,
    maxWidth: "90%",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  userBubbleLargeText: { maxWidth: "100%" },
  pendingBubble: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    gap: space.xs,
  },
  pendingText: { ...typography.chatBody, color: palette.dim },
  pendingLabel: { ...typography.caption, color: palette.dim },
  // Supply intrinsic text width to Yoga; the native selection view supplies height.
  textWidthMeasurement: { height: 0, overflow: "hidden", opacity: 0 },
  userRow: { alignItems: "flex-end", paddingHorizontal: space.md, paddingVertical: space.md },
  userText: { ...typography.chatBody, color: palette.ink },
});
