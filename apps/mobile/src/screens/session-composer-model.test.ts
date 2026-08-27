import { expect, test } from "@jest/globals";
import type {
  AgentInfo,
  CommandInfo,
  FileSystemEntry,
  SkillInfo,
} from "@opencode2-mobile/opencode-adapter";

import {
  applyMentionCompletion,
  applySlashCompletion,
  findMentionTrigger,
  listMentionCompletions,
  listSlashCompletions,
  rebaseComposerMentions,
  resolveComposerSubmitIntent,
  serverFileUri,
} from "./session-composer-model";

const commands = [{ name: "review" }, { name: "release-notes" }] as CommandInfo[];
const agents = [
  { hidden: false, id: "build", mode: "primary", name: "Build" },
  { hidden: false, id: "explore", mode: "subagent", name: "Explore" },
] as AgentInfo[];
const skills = [
  {
    content: "Content",
    id: "release",
    location: "/skills/release.md",
    name: "Release workflow",
    slash: false,
  },
] as SkillInfo[];
const files = [
  { path: "src/index.ts", type: "file" },
  { path: "src", type: "directory" },
] as FileSystemEntry[];

test("keeps slash completion command-only", () => {
  expect(listSlashCompletions("/re", commands).map((item) => item.name)).toEqual([
    "release-notes",
    "review",
  ]);
  expect(listSlashCompletions("Explain /review", commands)).toEqual([]);
  expect(listSlashCompletions("/review arguments", commands)).toEqual([]);
  expect(applySlashCompletion("/rev", { label: "review", name: "review" })).toBe("/review ");
});

test("finds an at trigger at the caret only after a text boundary", () => {
  expect(findMentionTrigger("Ask @src/in", { end: 11, start: 11 })).toEqual({
    end: 11,
    query: "src/in",
    start: 4,
  });
  expect(findMentionTrigger("mail@example", { end: 12, start: 12 })).toBeUndefined();
  expect(findMentionTrigger("@one two", { end: 8, start: 8 })).toBeUndefined();
  expect(findMentionTrigger("@file", { end: 3, start: 1 })).toBeUndefined();
  expect(findMentionTrigger("Ask @src/index.ts now", { end: 8, start: 8 })).toEqual({
    end: 17,
    query: "src",
    start: 4,
  });
});

test("combines files, skills, and non-primary agents for at completion", () => {
  expect(listMentionCompletions("", agents, skills, files).map((item) => item.type)).toEqual([
    "agent",
    "skill",
    "file",
  ]);
  expect(listMentionCompletions("rel", agents, skills, [])).toMatchObject([
    { id: "release", type: "skill" },
  ]);
  expect(listMentionCompletions("index", agents, skills, files)).toMatchObject([
    { path: "src/index.ts", type: "file" },
  ]);
});

test("preserves fuzzy-ranked file results from the server", () => {
  const rankedFiles = [
    { path: "src/session-input.ts", type: "file" },
    { path: "src/index.ts", type: "file" },
  ] as FileSystemEntry[];

  expect(listMentionCompletions("sit", [], [], rankedFiles).map((item) => item.label)).toEqual([
    "src/session-input.ts",
    "src/index.ts",
  ]);
});

test("inserts a structured mention and rebases it around later edits", () => {
  const trigger = findMentionTrigger("Ask @ind now", { end: 8, start: 8 });
  if (!trigger) throw new Error("Expected mention trigger");
  const inserted = applyMentionCompletion(
    "Ask @ind now",
    trigger,
    { label: "src/index.ts", path: "src/index.ts", type: "file" },
    [],
  );

  expect(inserted.draft).toBe("Ask @src/index.ts now");
  expect(inserted.mentions).toEqual([
    {
      mention: { end: 17, start: 4, text: "@src/index.ts" },
      path: "src/index.ts",
      type: "file",
    },
  ]);
  expect(
    rebaseComposerMentions(inserted.draft, `Please ${inserted.draft}`, inserted.mentions),
  ).toEqual([
    {
      mention: { end: 24, start: 11, text: "@src/index.ts" },
      path: "src/index.ts",
      type: "file",
    },
  ]);
  expect(rebaseComposerMentions(inserted.draft, "Ask @broken now", inserted.mentions)).toEqual([]);
});

test("keeps separate ranges when the same item is mentioned twice", () => {
  const firstTrigger = findMentionTrigger("@src", { end: 4, start: 4 });
  if (!firstTrigger) throw new Error("Expected first mention trigger");
  const first = applyMentionCompletion(
    "@src",
    firstTrigger,
    { label: "src/index.ts", path: "src/index.ts", type: "file" },
    [],
  );
  const secondDraft = `${first.draft}@src`;
  const secondTrigger = findMentionTrigger(secondDraft, {
    end: secondDraft.length,
    start: secondDraft.length,
  });
  if (!secondTrigger) throw new Error("Expected second mention trigger");
  const second = applyMentionCompletion(
    secondDraft,
    secondTrigger,
    { label: "src/index.ts", path: "src/index.ts", type: "file" },
    first.mentions,
  );

  expect(second.mentions).toHaveLength(2);
  expect(second.mentions.map((item) => item.mention.start)).toEqual([0, 14]);
});

test("keeps the surviving attachment identity when equal mention text repeats", () => {
  const mentions = [
    {
      mention: { end: 4, start: 0, text: "@foo" },
      name: "foo",
      type: "agent" as const,
    },
    {
      id: "foo",
      mention: { end: 9, start: 5, text: "@foo" },
      type: "skill" as const,
    },
  ];

  expect(rebaseComposerMentions("@foo @foo", "@foo", mentions, { end: 5, start: 0 })).toEqual([
    {
      id: "foo",
      mention: { end: 4, start: 0, text: "@foo" },
      type: "skill",
    },
  ]);
  expect(rebaseComposerMentions("@foo @foo", "@foo", mentions, { end: 9, start: 4 })).toEqual([
    {
      mention: { end: 4, start: 0, text: "@foo" },
      name: "foo",
      type: "agent",
    },
  ]);
});

test("builds generated prompt attachments with UTF-16 mention ranges", () => {
  const draft = "Check æ @src/a#b.ts with @Explore and @release";
  const fileText = "@src/a#b.ts";
  const agentText = "@Explore";
  const skillText = "@release";
  const fileStart = draft.indexOf(fileText);
  const agentStart = draft.indexOf(agentText);
  const skillStart = draft.indexOf(skillText);

  expect(
    resolveComposerSubmitIntent(
      draft,
      commands,
      [
        {
          mention: { end: fileStart + fileText.length, start: fileStart, text: fileText },
          path: "src/a#b.ts",
          type: "file",
        },
        {
          mention: { end: agentStart + agentText.length, start: agentStart, text: agentText },
          name: "Explore",
          type: "agent",
        },
        {
          id: "release",
          mention: { end: skillStart + skillText.length, start: skillStart, text: skillText },
          type: "skill",
        },
      ],
      { directory: "/workspace" },
    ),
  ).toEqual({
    agents: [{ mention: { end: 33, start: 25, text: "@Explore" }, name: "Explore" }],
    files: [
      {
        mention: { end: 19, start: 8, text: "@src/a#b.ts" },
        name: "src/a#b.ts",
        uri: "file:///workspace/src/a%23b.ts",
      },
    ],
    skills: [{ id: "release", mention: { end: 46, start: 38, text: "@release" } }],
    type: "prompt",
  });
});

test("preserves command arguments and structured mentions", () => {
  const draft = "/review @src/index.ts\nthen tests";
  expect(
    resolveComposerSubmitIntent(
      draft,
      commands,
      [
        {
          mention: { end: 21, start: 8, text: "@src/index.ts" },
          path: "src/index.ts",
          type: "file",
        },
      ],
      { directory: "/workspace" },
    ),
  ).toMatchObject({
    arguments: "@src/index.ts\nthen tests",
    command: "review",
    files: [
      {
        mention: { end: 13, start: 0, text: "@src/index.ts" },
        uri: "file:///workspace/src/index.ts",
      },
    ],
    type: "command",
  });
  expect(
    resolveComposerSubmitIntent("/unknown value", commands, [], { directory: "/workspace" }),
  ).toEqual({
    type: "prompt",
  });
});

test("preserves multiline command arguments after removing one separator space", () => {
  expect(
    resolveComposerSubmitIntent("/review  indented", commands, [], { directory: "/workspace" }),
  ).toMatchObject({ arguments: " indented", type: "command" });
  expect(
    resolveComposerSubmitIntent("/review\nnext line", commands, [], { directory: "/workspace" }),
  ).toMatchObject({ arguments: "\nnext line", type: "command" });
});

test("creates server-local file URLs without treating hostile path characters as URL syntax", () => {
  expect(serverFileUri("/workspace", "odd name?#.ts")).toBe(
    "file:///workspace/odd%20name%3F%23.ts",
  );
  expect(serverFileUri("C:\\workspace", "src\\index.ts")).toBe("file:///C:/workspace/src/index.ts");
  expect(() => serverFileUri("/workspace", "../secret.txt")).toThrow(
    "FILE_MENTION_OUTSIDE_LOCATION",
  );
  expect(() => serverFileUri("/workspace", "/etc/passwd")).toThrow("FILE_MENTION_OUTSIDE_LOCATION");
  expect(() => serverFileUri("C:\\workspace", "C:\\outside.txt")).toThrow(
    "FILE_MENTION_OUTSIDE_LOCATION",
  );
});
