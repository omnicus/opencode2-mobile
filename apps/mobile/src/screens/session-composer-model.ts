import type {
  AgentInfo,
  CommandInfo,
  FileSystemEntry,
  LocationRef,
  SkillInfo,
} from "@opencode2-mobile/opencode-adapter";
import type { SessionDraftMention } from "../storage/draft-repository";

type MentionRange = { end: number; start: number; text: string };

export type ComposerMention = SessionDraftMention;

export type MentionCompletion =
  | { description?: string; label: string; path: string; type: "file" }
  | { description?: string; label: string; name: string; type: "agent" }
  | { description?: string; id: string; label: string; type: "skill" };

export type SlashCompletion = {
  description?: string;
  label: string;
  name: string;
};

type ComposerAttachments = {
  agents?: Array<{ mention: MentionRange; name: string }>;
  files?: Array<{ mention: MentionRange; name: string; uri: string }>;
  skills?: Array<{ id: string; mention: MentionRange }>;
};

export type ComposerSubmitIntent =
  | ({ type: "prompt" } & ComposerAttachments)
  | ({ arguments?: string; command: string; type: "command" } & ComposerAttachments);

export type MentionTrigger = { end: number; query: string; start: number };

const maximumSlashCompletions = 4;
const maximumMentionCompletions = 10;

export function listSlashCompletions(draft: string, commands: readonly CommandInfo[]) {
  const match = draft.match(/^\/([^\s/]*)$/);
  if (!match) return [];
  const query = (match[1] ?? "").toLocaleLowerCase();

  return commands
    .filter(
      (command) =>
        command.name.toLocaleLowerCase().includes(query) ||
        command.description?.toLocaleLowerCase().includes(query),
    )
    .sort((first, second) => {
      const firstStarts = first.name.toLocaleLowerCase().startsWith(query);
      const secondStarts = second.name.toLocaleLowerCase().startsWith(query);
      if (firstStarts !== secondStarts) return firstStarts ? -1 : 1;
      return first.name.localeCompare(second.name);
    })
    .slice(0, maximumSlashCompletions)
    .map(
      (command): SlashCompletion => ({
        ...(command.description ? { description: command.description } : {}),
        label: command.name,
        name: command.name,
      }),
    );
}

export function findMentionTrigger(draft: string, selection: { end: number; start: number }) {
  if (selection.start !== selection.end) return undefined;
  const beforeCursor = draft.slice(0, selection.start);
  const start = beforeCursor.lastIndexOf("@");
  if (start < 0) return undefined;
  const beforeTrigger = start === 0 ? undefined : beforeCursor[start - 1];
  const query = beforeCursor.slice(start + 1);
  if ((beforeTrigger !== undefined && !/\s/.test(beforeTrigger)) || /\s/.test(query)) {
    return undefined;
  }
  const suffix = draft.slice(selection.end);
  const nextWhitespace = suffix.search(/\s/);
  const end = nextWhitespace < 0 ? draft.length : selection.end + nextWhitespace;
  return { end, query, start } satisfies MentionTrigger;
}

export function listMentionCompletions(
  query: string,
  agents: readonly AgentInfo[],
  skills: readonly SkillInfo[],
  files: readonly FileSystemEntry[],
) {
  const normalizedQuery = query.toLocaleLowerCase();
  const nonFileOptions: MentionCompletion[] = [
    ...agents
      .filter((agent) => !agent.hidden && agent.mode !== "primary")
      .map((agent) => ({
        ...(agent.description ? { description: agent.description } : {}),
        label: agent.name,
        name: agent.name,
        type: "agent" as const,
      })),
    ...skills.map((skill) => ({
      ...(skill.description ? { description: skill.description } : {}),
      id: skill.id,
      label: skill.name,
      type: "skill" as const,
    })),
  ];
  const fileOptions: MentionCompletion[] = files
    .filter((file) => file.type === "file")
    .map((file) => ({ label: file.path, path: file.path, type: "file" as const }));

  const matchingNonFiles = nonFileOptions
    .filter((option) => mentionSearchText(option).includes(normalizedQuery))
    .sort((first, second) => {
      const firstStarts = mentionValue(first).toLocaleLowerCase().startsWith(normalizedQuery);
      const secondStarts = mentionValue(second).toLocaleLowerCase().startsWith(normalizedQuery);
      if (firstStarts !== secondStarts) return firstStarts ? -1 : 1;
      const kindOrder = mentionKindOrder(first.type) - mentionKindOrder(second.type);
      return kindOrder || mentionValue(first).localeCompare(mentionValue(second));
    });
  return [...matchingNonFiles, ...fileOptions].slice(0, maximumMentionCompletions);
}

export function applySlashCompletion(draft: string, completion: SlashCompletion) {
  if (!/^\/[^\s/]*$/.test(draft)) return draft;
  return `/${completion.name} `;
}

export function applyMentionCompletion(
  draft: string,
  trigger: MentionTrigger,
  completion: MentionCompletion,
  mentions: readonly ComposerMention[],
) {
  const value = mentionValue(completion);
  const text = `@${value}`;
  const suffix = draft.slice(trigger.end);
  const trailing = suffix.startsWith(" ") ? "" : " ";
  const replacement = `${text}${trailing}`;
  const nextDraft = `${draft.slice(0, trigger.start)}${replacement}${suffix}`;
  const delta = replacement.length - (trigger.end - trigger.start);
  const shifted = mentions
    .filter(
      (mention) => mention.mention.end <= trigger.start || mention.mention.start >= trigger.end,
    )
    .map((mention) =>
      mention.mention.start >= trigger.end ? shiftMention(mention, delta) : mention,
    );
  const range = { end: trigger.start + text.length, start: trigger.start, text };
  const nextMention: ComposerMention =
    completion.type === "file"
      ? { mention: range, path: completion.path, type: "file" }
      : completion.type === "agent"
        ? { mention: range, name: completion.name, type: "agent" }
        : { id: completion.id, mention: range, type: "skill" };

  return {
    draft: nextDraft,
    mentions: [...shifted, nextMention].sort(
      (first, second) => first.mention.start - second.mention.start,
    ),
    selection: { end: range.end + trailing.length, start: range.end + trailing.length },
  };
}

export function rebaseComposerMentions(
  previousDraft: string,
  nextDraft: string,
  mentions: readonly ComposerMention[],
  selection?: { end: number; start: number },
) {
  if (previousDraft === nextDraft || mentions.length === 0) return [...mentions];
  let start = 0;
  while (start < previousDraft.length && previousDraft[start] === nextDraft[start]) start += 1;
  let previousEnd = previousDraft.length;
  let nextEnd = nextDraft.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousDraft[previousEnd - 1] === nextDraft[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  if (selection && selection.start < selection.end) {
    const insertedLength =
      nextDraft.length - (previousDraft.length - selection.end + selection.start);
    if (
      insertedLength >= 0 &&
      `${previousDraft.slice(0, selection.start)}${nextDraft.slice(
        selection.start,
        selection.start + insertedLength,
      )}${previousDraft.slice(selection.end)}` === nextDraft
    ) {
      start = selection.start;
      previousEnd = selection.end;
      nextEnd = selection.start + insertedLength;
    }
  }
  const delta = nextEnd - previousEnd;
  return mentions.flatMap((mention) => {
    if (previousEnd <= mention.mention.start) return [shiftMention(mention, delta)];
    if (start >= mention.mention.end) return [mention];
    return [];
  });
}

export function resolveComposerSubmitIntent(
  draft: string,
  commands: readonly CommandInfo[],
  mentions: readonly ComposerMention[],
  location: LocationRef,
): ComposerSubmitIntent {
  const match = draft.match(/^\/([^\s/]+)([\s\S]*)$/);
  if (!match) return { ...composerAttachments(draft, mentions, location), type: "prompt" };
  const name = match[1] ?? "";
  const remainder = match[2] ?? "";
  const command = commands.find((candidate) => candidate.name === name);
  if (!command) return { ...composerAttachments(draft, mentions, location), type: "prompt" };
  const separatorLength = remainder.startsWith(" ") ? 1 : 0;
  const argumentsText = remainder.slice(separatorLength);
  const argumentsStart = 1 + name.length + separatorLength;
  const attachments = composerAttachments(draft, mentions, location, argumentsStart);
  return {
    ...attachments,
    ...(argumentsText ? { arguments: argumentsText } : {}),
    command: command.name,
    type: "command",
  };
}

export function serverFileUri(directory: string, path: string) {
  const normalizedDirectory = directory.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedPath = path.replaceAll("\\", "/");
  if (!isSafeRelativeFilePath(normalizedPath)) throw new Error("FILE_MENTION_OUTSIDE_LOCATION");
  const absolute = `${normalizedDirectory}/${normalizedPath}`;
  const url = new URL("file:///");
  url.pathname = absolute.startsWith("/") ? absolute : `/${absolute}`;
  return url.href;
}

function isSafeRelativeFilePath(path: string) {
  return (
    Boolean(path) &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:\//.test(path) &&
    path.split("/").every((segment) => Boolean(segment) && segment !== "." && segment !== "..")
  );
}

function composerAttachments(
  draft: string,
  mentions: readonly ComposerMention[],
  location: LocationRef,
  offset = 0,
) {
  const valid = mentions.filter(
    (mention) =>
      mention.mention.start >= offset &&
      mention.mention.end <= draft.length &&
      draft.slice(mention.mention.start, mention.mention.end) === mention.mention.text,
  );
  const files = valid.flatMap((mention) =>
    mention.type === "file"
      ? [
          {
            mention: offsetMention(mention.mention, offset),
            name: mention.path,
            uri: serverFileUri(location.directory, mention.path),
          },
        ]
      : [],
  );
  const agents = valid.flatMap((mention) =>
    mention.type === "agent"
      ? [{ mention: offsetMention(mention.mention, offset), name: mention.name }]
      : [],
  );
  const skills = valid.flatMap((mention) =>
    mention.type === "skill"
      ? [{ id: mention.id, mention: offsetMention(mention.mention, offset) }]
      : [],
  );
  return {
    ...(agents.length ? { agents } : {}),
    ...(files.length ? { files } : {}),
    ...(skills.length ? { skills } : {}),
  };
}

function offsetMention(mention: MentionRange, offset: number) {
  return { ...mention, end: mention.end - offset, start: mention.start - offset };
}

function mentionSearchText(option: MentionCompletion) {
  return `${mentionValue(option)}\n${option.label}\n${option.description ?? ""}`.toLocaleLowerCase();
}

function mentionValue(option: MentionCompletion) {
  return option.type === "file" ? option.path : option.type === "agent" ? option.name : option.id;
}

function mentionKindOrder(type: MentionCompletion["type"]) {
  return type === "agent" ? 0 : type === "skill" ? 1 : 2;
}

function shiftMention(mention: ComposerMention, delta: number): ComposerMention {
  return {
    ...mention,
    mention: {
      ...mention.mention,
      end: mention.mention.end + delta,
      start: mention.mention.start + delta,
    },
  };
}
