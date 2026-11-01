import { describe, expect, it, vi } from "vitest";

import {
  createBoundedOpenCodeFetch,
  getOpenCodeSessionMessage,
  listOpenCodeFormRequests,
  listOpenCodePermissionRequests,
  listOpenCodeProjects,
  listOpenCodeSessionInbox,
  type OpenCodeClient,
  openCodeDirectoryExists,
  probePtyTransport,
} from "./index";

const location = { directory: "/workspace" };

function stubClient(client: object) {
  return client as unknown as OpenCodeClient;
}

describe("project validation", () => {
  const project = {
    canonical: "/workspace",
    id: "project-1",
    sandboxes: ["/workspace/.worktree/one"],
    time: { created: 1, updated: 2 },
  };
  const listProjects = (projects: unknown) =>
    listOpenCodeProjects(stubClient({ project: { list: vi.fn(async () => projects) } }));

  it("accepts well-formed projects", async () => {
    await expect(listProjects([project, { ...project, sandboxes: [] }])).resolves.toHaveLength(2);
  });

  it.each([
    ["a non-array response", { data: [project] }],
    ["a non-record project", [null]],
    ["a missing id", [{ ...project, id: undefined }]],
    ["an empty id", [{ ...project, id: "" }]],
    ["a non-string canonical", [{ ...project, canonical: 1 }]],
    ["a blank canonical", [{ ...project, canonical: "  " }]],
    ["non-array sandboxes", [{ ...project, sandboxes: "/workspace" }]],
    ["a non-string sandbox", [{ ...project, sandboxes: [1] }]],
    ["an empty sandbox", [{ ...project, sandboxes: [""] }]],
    ["a missing time", [{ ...project, time: null }]],
    ["a non-number created time", [{ ...project, time: { created: "1", updated: 2 } }]],
    ["a non-finite created time", [{ ...project, time: { created: Number.NaN, updated: 2 } }]],
    ["a non-number updated time", [{ ...project, time: { created: 1, updated: "2" } }]],
    [
      "a non-finite updated time",
      [{ ...project, time: { created: 1, updated: Number.POSITIVE_INFINITY } }],
    ],
  ])("rejects %s", async (_, projects) => {
    await expect(listProjects(projects)).rejects.toThrow("MALFORMED_PROJECT_LIST");
  });
});

describe("permission request validation", () => {
  const request = {
    action: "edit",
    id: "per_1",
    resources: ["src/index.ts"],
    sessionID: "ses_1",
  };
  const listRequests = (data: unknown) =>
    listOpenCodePermissionRequests(
      stubClient({
        permission: { request: { list: vi.fn(async () => ({ data, location })) } },
      }),
      location,
    );

  it("accepts well-formed permission requests", async () => {
    await expect(listRequests([request, { ...request, resources: [] }])).resolves.toMatchObject({
      data: [request, { ...request, resources: [] }],
    });
  });

  it.each([
    ["a non-array response", { request }],
    ["a non-record request", ["per_1"]],
    ["a non-string id", [{ ...request, id: 1 }]],
    ["a non-string session", [{ ...request, sessionID: null }]],
    ["a non-string action", [{ ...request, action: undefined }]],
    ["non-array resources", [{ ...request, resources: "src/index.ts" }]],
    ["a non-string resource", [{ ...request, resources: ["src/index.ts", 1] }]],
  ])("rejects %s", async (_, data) => {
    await expect(listRequests(data)).rejects.toThrow("MALFORMED_PERMISSION_LIST");
  });
});

describe("session inbox validation", () => {
  const item = {
    delivery: "queue",
    id: "inb_1",
    payload: { text: "Hello" },
    sessionID: "ses_1",
    time: { created: 1 },
    type: "user",
  };
  const mention = { end: 5, start: 0, text: "@file" };
  const listInbox = (items: unknown[]) =>
    listOpenCodeSessionInbox(
      stubClient({ session: { inbox: { list: vi.fn(async () => items) } } }),
      "ses_1",
    );

  it.each([
    ["a queued user prompt", item],
    ["a steered user prompt", { ...item, delivery: "steer" }],
    [
      "a user prompt with attachments",
      {
        ...item,
        payload: {
          agents: [{ name: "build" }, { mention, name: "plan" }],
          files: [
            { data: "aGk=", mime: "text/plain", source: { type: "inline" } },
            {
              data: "aGk=",
              description: "Notes",
              mention,
              mime: "text/plain",
              name: "notes.txt",
              source: { type: "uri", uri: "file:///notes.txt" },
            },
          ],
          skills: [{ id: "skill-1", mention, name: "Review" }],
          text: "Hello",
        },
      },
    ],
    ["a synthetic prompt", { ...item, payload: { text: "Continue" }, type: "synthetic" }],
    [
      "a described synthetic prompt",
      { ...item, payload: { description: "Retry", text: "Continue" }, type: "synthetic" },
    ],
    ["a compaction request", { ...item, payload: {}, type: "compaction" }],
    [
      "a move request",
      {
        ...item,
        payload: { location: { directory: "/workspace/child" }, projectID: "project-1" },
        type: "move",
      },
    ],
    [
      "a workspace move request",
      {
        ...item,
        payload: {
          location: { directory: "/workspace", workspaceID: "wrk_1" },
          projectID: "project-1",
        },
        type: "move",
      },
    ],
  ])("accepts %s", async (_, value) => {
    await expect(listInbox([value])).resolves.toEqual([value]);
  });

  it.each([
    ["a non-record item", null],
    ["a non-string id", { ...item, id: 1 }],
    ["an empty id", { ...item, id: "" }],
    ["a non-string session", { ...item, sessionID: 1 }],
    ["a non-session owner", { ...item, sessionID: "global" }],
    ["a missing time", { ...item, time: undefined }],
    ["a non-number created time", { ...item, time: { created: "1" } }],
    ["a non-finite created time", { ...item, time: { created: Number.NaN } }],
    ["an unknown delivery", { ...item, delivery: "later" }],
    ["a missing payload", { ...item, payload: undefined }],
    ["an unknown type", { ...item, type: "future" }],
    ["a missing type", { ...item, type: undefined }],
    ["an inherited type name", { ...item, type: "constructor" }],
    ["a user prompt without text", { ...item, payload: {} }],
    ["user files that are not an array", { ...item, payload: { files: {}, text: "Hello" } }],
    [
      "a user file without a source",
      { ...item, payload: { files: [{ data: "aGk=", mime: "text/plain" }], text: "Hello" } },
    ],
    [
      "a user file with an unknown source",
      {
        ...item,
        payload: {
          files: [{ data: "aGk=", mime: "text/plain", source: { type: "remote" } }],
          text: "Hello",
        },
      },
    ],
    [
      "a uri user file without a uri",
      {
        ...item,
        payload: {
          files: [{ data: "aGk=", mime: "text/plain", source: { type: "uri" } }],
          text: "Hello",
        },
      },
    ],
    [
      "a user file with a non-string name",
      {
        ...item,
        payload: {
          files: [{ data: "aGk=", mime: "text/plain", name: 1, source: { type: "inline" } }],
          text: "Hello",
        },
      },
    ],
    [
      "a user file with a malformed mention",
      {
        ...item,
        payload: {
          files: [
            {
              data: "aGk=",
              mention: { end: 1.5, start: 0, text: "@" },
              mime: "text/plain",
              source: { type: "inline" },
            },
          ],
          text: "Hello",
        },
      },
    ],
    ["a malformed user agent", { ...item, payload: { agents: [{}], text: "Hello" } }],
    [
      "a malformed user skill",
      { ...item, payload: { skills: [{ name: "Review" }], text: "Hello" } },
    ],
    ["a synthetic prompt without text", { ...item, payload: {}, type: "synthetic" }],
    [
      "a synthetic prompt with a non-string description",
      { ...item, payload: { description: 1, text: "Continue" }, type: "synthetic" },
    ],
    ["a move without a location", { ...item, payload: { projectID: "project-1" }, type: "move" }],
    [
      "a move to a blank directory",
      { ...item, payload: { location: { directory: " " }, projectID: "project-1" }, type: "move" },
    ],
    [
      "a move to a malformed workspace",
      {
        ...item,
        payload: {
          location: { directory: "/workspace", workspaceID: "workspace-1" },
          projectID: "project-1",
        },
        type: "move",
      },
    ],
    [
      "a move without a project",
      { ...item, payload: { location: { directory: "/workspace" } }, type: "move" },
    ],
  ])("rejects %s", async (_, value) => {
    await expect(listInbox([value])).rejects.toThrow("MALFORMED_INBOX_LIST");
  });
});

describe("session message validation", () => {
  const model = { id: "model-1", providerID: "provider" };
  const error = { message: "Failed", type: "ProviderError" };
  const base = { id: "msg_1", time: { created: 1 } };
  const getMessage = (message: unknown) =>
    getOpenCodeSessionMessage(
      stubClient({ session: { message: { get: vi.fn(async () => message) } } }),
      "ses_1",
      "msg_1",
    );
  const tool = (state: unknown) => ({
    agent: "build",
    content: [{ id: "call_1", name: "read", state, time: { created: 1 }, type: "tool" }],
    model,
    type: "assistant",
  });

  it.each([
    ["an idle message", { outcome: "succeeded", type: "idle" }],
    ["an agent switch", { agent: "build", type: "agent-switched" }],
    ["an agent switch with history", { agent: "build", previous: "plan", type: "agent-switched" }],
    ["a model switch", { model, type: "model-switched" }],
    [
      "a model switch with history",
      { model: { ...model, variant: "high" }, previous: model, type: "model-switched" },
    ],
    ["a location switch", { location: { directory: "/workspace" }, type: "location-switched" }],
    ["a user message", { text: "Hello", type: "user" }],
    [
      "a user message with attachments",
      {
        agents: [{ name: "build" }],
        files: [{ data: "aGk=", mime: "text/plain", source: { type: "inline" } }],
        skills: [{ id: "skill-1", name: "Review" }],
        text: "Hello",
        type: "user",
      },
    ],
    ["a synthetic message", { text: "Continue", type: "synthetic" }],
    ["a system message", { description: "Rules", text: "Be brief", type: "system" }],
    ["a skill message", { name: "Review", skill: "skill-1", text: "Check", type: "skill" }],
    ["a running shell", { command: "build", shellID: "sh_1", status: "running", type: "shell" }],
    ...["exited", "timeout", "killed"].flatMap((status) =>
      [0, "Infinity", "-Infinity", "NaN"].map((exit): [string, object] => [
        `a ${status} shell with exit ${exit}`,
        {
          command: "build",
          exit,
          output: { cursor: 0, output: "done", size: 4, truncated: false },
          shellID: "sh_1",
          status,
          type: "shell",
        },
      ]),
    ),
    ["an empty assistant message", { agent: "build", content: [], model, type: "assistant" }],
    [
      "an assistant message with text, reasoning, error, and retry",
      {
        agent: "build",
        content: [
          { text: "Answer", type: "text" },
          { text: "Thinking", type: "reasoning" },
        ],
        error: { ...error, status: 500 },
        model,
        retry: { at: 2, attempt: 0, error },
        type: "assistant",
      },
    ],
    ["a streaming tool", tool({ input: "{", status: "streaming" })],
    ["a running tool", tool({ input: {}, metadata: {}, status: "running" })],
    [
      "a completed tool",
      tool({
        content: [
          { text: "file", type: "text" },
          { mime: "image/png", type: "file", uri: "file:///a.png" },
          { mime: "image/png", name: null, type: "file", uri: "file:///b.png" },
          { mime: "image/png", name: "c.png", type: "file", uri: "file:///c.png" },
        ],
        input: {},
        status: "completed",
      }),
    ],
    ["a failed tool", tool({ error, input: {}, status: "error" })],
    [
      "a failed tool with content",
      tool({ content: [{ text: "partial", type: "text" }], error, input: {}, status: "error" }),
    ],
    [
      "a running compaction",
      { reason: "auto", status: "running", summary: "", type: "compaction" },
    ],
    [
      "a completed compaction",
      { reason: "manual", status: "completed", summary: "Done", type: "compaction" },
    ],
    ["a failed compaction", { error, reason: "auto", status: "failed", type: "compaction" }],
  ])("accepts %s", async (_, message) => {
    await expect(getMessage({ ...base, ...message })).resolves.toMatchObject(base);
  });

  it.each([
    ["a non-record message", null],
    ["a non-string id", { ...base, id: 1, type: "user", text: "Hello" }],
    ["a mismatched id", { ...base, id: "msg_2", type: "user", text: "Hello" }],
    ["a missing time", { id: "msg_1", text: "Hello", type: "user" }],
    ["a non-finite time", { ...base, text: "Hello", time: { created: Number.NaN }, type: "user" }],
    ["a non-string type", { ...base, text: "Hello", type: 1 }],
    ["an unknown type", { ...base, text: "Hello", type: "future" }],
    ["an inherited type name", { ...base, text: "Hello", type: "toString" }],
    ["an agent switch without an agent", { ...base, type: "agent-switched" }],
    [
      "an agent switch with a non-string previous agent",
      { ...base, agent: "build", previous: 1, type: "agent-switched" },
    ],
    ["a model switch without a model", { ...base, type: "model-switched" }],
    [
      "a model switch with an empty model id",
      { ...base, model: { ...model, id: "" }, type: "model-switched" },
    ],
    [
      "a model switch with an empty provider",
      { ...base, model: { ...model, providerID: "" }, type: "model-switched" },
    ],
    [
      "a model switch with a non-string variant",
      { ...base, model: { ...model, variant: 1 }, type: "model-switched" },
    ],
    [
      "a model switch with a malformed previous model",
      { ...base, model, previous: {}, type: "model-switched" },
    ],
    ["a location switch without a location", { ...base, type: "location-switched" }],
    ["a user message without text", { ...base, type: "user" }],
    ["a user message with malformed files", { ...base, files: [{}], text: "Hello", type: "user" }],
    ["a user message with malformed agents", { ...base, agents: {}, text: "Hello", type: "user" }],
    [
      "a user message with malformed skills",
      { ...base, skills: [{}], text: "Hello", type: "user" },
    ],
    ["a synthetic message without text", { ...base, type: "synthetic" }],
    [
      "a system message with a non-string description",
      { ...base, description: 1, text: "Rules", type: "system" },
    ],
    ["a skill message without a skill", { ...base, name: "Review", text: "Check", type: "skill" }],
    ["a skill message without a name", { ...base, skill: "skill-1", text: "Check", type: "skill" }],
    ["a skill message without text", { ...base, name: "Review", skill: "skill-1", type: "skill" }],
    ["a shell without an id", { ...base, command: "build", status: "running", type: "shell" }],
    ["a shell without a command", { ...base, shellID: "sh_1", status: "running", type: "shell" }],
    [
      "a shell with an unknown status",
      { ...base, command: "build", shellID: "sh_1", status: "paused", type: "shell" },
    ],
    [
      "a shell with a malformed exit",
      { ...base, command: "build", exit: "1", shellID: "sh_1", status: "exited", type: "shell" },
    ],
    [
      "a shell with malformed output",
      {
        ...base,
        command: "build",
        output: { cursor: 0.5, output: "done", size: 4, truncated: false },
        shellID: "sh_1",
        status: "exited",
        type: "shell",
      },
    ],
    ["an assistant message without an agent", { ...base, content: [], model, type: "assistant" }],
    [
      "an assistant message without a model",
      { ...base, agent: "build", content: [], type: "assistant" },
    ],
    [
      "an assistant message with non-array content",
      { ...base, agent: "build", content: {}, model, type: "assistant" },
    ],
    [
      "an assistant message with an unknown part",
      { ...base, agent: "build", content: [{ type: "image" }], model, type: "assistant" },
    ],
    [
      "an assistant message with a malformed text part",
      { ...base, agent: "build", content: [{ type: "text" }], model, type: "assistant" },
    ],
    [
      "an assistant message with a malformed error",
      {
        ...base,
        agent: "build",
        content: [],
        error: { ...error, status: "500" },
        model,
        type: "assistant",
      },
    ],
    [
      "an assistant message with a negative retry attempt",
      {
        ...base,
        agent: "build",
        content: [],
        model,
        retry: { at: 2, attempt: -1, error },
        type: "assistant",
      },
    ],
    [
      "an assistant message with a non-finite retry time",
      {
        ...base,
        agent: "build",
        content: [],
        model,
        retry: { at: Number.POSITIVE_INFINITY, attempt: 0, error },
        type: "assistant",
      },
    ],
    ["a tool without state", { ...base, ...tool(undefined) }],
    ["a tool with an unknown state", { ...base, ...tool({ status: "queued" }) }],
    [
      "a streaming tool with parsed input",
      { ...base, ...tool({ input: {}, status: "streaming" }) },
    ],
    ["a running tool without metadata", { ...base, ...tool({ input: {}, status: "running" }) }],
    [
      "a completed tool without content",
      { ...base, ...tool({ content: [], input: {}, status: "completed" }) },
    ],
    [
      "a completed tool with malformed file content",
      {
        ...base,
        ...tool({
          content: [{ mime: "image/png", name: 1, type: "file", uri: "file:///a.png" }],
          input: {},
          status: "completed",
        }),
      },
    ],
    [
      "a failed tool with empty content",
      { ...base, ...tool({ content: [], error, input: {}, status: "error" }) },
    ],
    ["a failed tool without an error", { ...base, ...tool({ input: {}, status: "error" }) }],
    [
      "a compaction with an unknown reason",
      { ...base, reason: "idle", status: "completed", summary: "Done", type: "compaction" },
    ],
    [
      "a failed compaction without an error",
      { ...base, reason: "auto", status: "failed", type: "compaction" },
    ],
    [
      "a compaction with an unknown status",
      { ...base, reason: "auto", status: "queued", summary: "Done", type: "compaction" },
    ],
    [
      "a compaction without a summary",
      { ...base, reason: "auto", status: "completed", type: "compaction" },
    ],
  ])("rejects %s", async (_, message) => {
    await expect(getMessage(message)).rejects.toThrow("MALFORMED_SESSION_MESSAGE");
  });
});

describe("form field validation", () => {
  const listForms = (fields: unknown[]) =>
    listOpenCodeFormRequests(
      stubClient({
        form: {
          list: vi.fn(async () => ({
            data: [{ fields, id: "frm_1", sessionID: "ses_1", title: "Form" }],
            location,
          })),
        },
      }),
      location,
    );
  const condition = { key: "other", op: "eq", value: "yes" };
  const option = { label: "One", value: "one" };

  it.each([
    ["an external field", { key: "login", type: "external", url: "https://example.test" }],
    [
      "a described external field",
      {
        description: "Sign in",
        key: "login",
        required: "ignored",
        title: "Login",
        type: "external",
        url: "https://example.test",
        when: "ignored",
      },
    ],
    ["a boolean field", { key: "enabled", type: "boolean" }],
    [
      "a conditional boolean field",
      {
        default: true,
        key: "enabled",
        required: false,
        type: "boolean",
        when: [
          condition,
          { key: "count", op: "neq", value: 1 },
          { key: "flag", op: "eq", value: false },
        ],
      },
    ],
    ["a number field", { key: "ratio", type: "number" }],
    [
      "a bounded number field",
      { default: 0.5, key: "ratio", maximum: "Infinity", minimum: "-Infinity", type: "number" },
    ],
    ["an integer field with a NaN default", { default: "NaN", key: "count", type: "integer" }],
    ["a multiselect field", { key: "targets", options: [], type: "multiselect" }],
    [
      "a complete multiselect field",
      {
        custom: true,
        default: ["one"],
        key: "targets",
        maxItems: 2,
        minItems: 0,
        options: [option, { ...option, description: "First" }],
        type: "multiselect",
      },
    ],
    ["a string field", { key: "name", type: "string" }],
    ...["email", "uri", "date", "date-time"].map((format): [string, object] => [
      `a ${format} string field`,
      { format, key: "name", type: "string" },
    ]),
    [
      "a complete string field",
      {
        custom: false,
        default: "Ada",
        key: "name",
        maxLength: 10,
        minLength: 1,
        options: [option],
        pattern: "^A",
        placeholder: "Name",
        type: "string",
      },
    ],
  ])("accepts %s", async (_, field) => {
    await expect(listForms([field])).resolves.toMatchObject({ data: [{ id: "frm_1" }] });
  });

  it.each([
    ["a non-record field", "name"],
    ["a non-string key", { key: 1, type: "string" }],
    ["an empty key", { key: "", type: "string" }],
    ["a non-string title", { key: "name", title: 1, type: "string" }],
    ["a non-string description", { description: 1, key: "name", type: "string" }],
    ["an external field without a url", { key: "login", type: "external" }],
    ["an external field with an empty url", { key: "login", type: "external", url: "" }],
    ["a non-boolean required flag", { key: "name", required: "yes", type: "string" }],
    ["non-array conditions", { key: "name", type: "string", when: condition }],
    ["a non-record condition", { key: "name", type: "string", when: [null] }],
    ["a condition without a key", { key: "name", type: "string", when: [{ op: "eq", value: 1 }] }],
    [
      "a condition with an unknown operator",
      { key: "name", type: "string", when: [{ ...condition, op: "gt" }] },
    ],
    [
      "a condition with an object value",
      { key: "name", type: "string", when: [{ ...condition, value: {} }] },
    ],
    ["a missing type", { key: "name" }],
    ["an unknown type", { key: "name", type: "date" }],
    ["an inherited type name", { key: "name", type: "constructor" }],
    ["a non-boolean boolean default", { default: "true", key: "enabled", type: "boolean" }],
    ["a malformed minimum", { key: "ratio", minimum: "0", type: "number" }],
    ["a non-finite maximum", { key: "ratio", maximum: Number.POSITIVE_INFINITY, type: "number" }],
    ["a malformed integer default", { default: null, key: "count", type: "integer" }],
    ["a multiselect field without options", { key: "targets", type: "multiselect" }],
    ["a malformed multiselect option", { key: "targets", options: [{}], type: "multiselect" }],
    [
      "a multiselect option with a non-string description",
      { key: "targets", options: [{ ...option, description: 1 }], type: "multiselect" },
    ],
    [
      "a negative minItems",
      { key: "targets", minItems: -1, options: [option], type: "multiselect" },
    ],
    [
      "a fractional maxItems",
      { key: "targets", maxItems: 1.5, options: [option], type: "multiselect" },
    ],
    [
      "a non-boolean multiselect custom flag",
      { custom: "yes", key: "targets", options: [option], type: "multiselect" },
    ],
    [
      "a non-array multiselect default",
      { default: "one", key: "targets", options: [option], type: "multiselect" },
    ],
    [
      "a non-string multiselect default",
      { default: [1], key: "targets", options: [option], type: "multiselect" },
    ],
    ["an unknown string format", { format: "phone", key: "name", type: "string" }],
    ["a negative minLength", { key: "name", minLength: -1, type: "string" }],
    ["a fractional maxLength", { key: "name", maxLength: 0.5, type: "string" }],
    ["a non-string pattern", { key: "name", pattern: 1, type: "string" }],
    ["a non-string placeholder", { key: "name", placeholder: 1, type: "string" }],
    ["a non-string default", { default: 1, key: "name", type: "string" }],
    ["non-array string options", { key: "name", options: option, type: "string" }],
    ["a malformed string option", { key: "name", options: [{ value: "one" }], type: "string" }],
    ["a non-boolean string custom flag", { custom: 1, key: "name", type: "string" }],
  ])("rejects %s", async (_, field) => {
    await expect(listForms([field])).rejects.toThrow("MALFORMED_FORM_LIST");
  });

  it("rejects duplicate field keys", async () => {
    await expect(
      listForms([
        { key: "name", type: "string" },
        { key: "name", type: "boolean" },
      ]),
    ).rejects.toThrow("MALFORMED_FORM_LIST");
  });
});

describe("directory presence validation", () => {
  const listDirectory = (data: unknown, directory = "/workspace") =>
    vi.fn(async () => ({ data, location: { directory } }));
  const directoryExists = (
    root: { directory: string; workspaceID?: string },
    directory: string,
    list = listDirectory([]),
  ) => openCodeDirectoryExists(stubClient({ file: { list } }), root, directory);

  it("lists the root itself for a direct child of the filesystem root", async () => {
    const list = listDirectory([{ path: "workspace", type: "directory" }], "/");
    await expect(directoryExists({ directory: "/" }, "/workspace", list)).resolves.toBe(true);
    expect(list).toHaveBeenCalledWith({ location: { directory: "/" }, path: "." }, undefined);
  });

  it("lists the root for a direct child of the project", async () => {
    const list = listDirectory([{ path: "child", type: "directory" }]);
    await expect(directoryExists(location, "/workspace/child", list)).resolves.toBe(true);
    await expect(directoryExists(location, "/workspace/other", list)).resolves.toBe(false);
    expect(list).toHaveBeenCalledWith({ location, path: "." }, undefined);
  });

  it("normalizes a trailing slash on the root", async () => {
    const list = listDirectory([{ path: ".worktree/live", type: "directory" }], "/workspace/");
    await expect(
      directoryExists({ directory: "/workspace/" }, "/workspace/.worktree/live", list),
    ).resolves.toBe(true);
    expect(list).toHaveBeenCalledWith(
      { location: { directory: "/workspace/" }, path: ".worktree" },
      undefined,
    );
  });

  it("checks a sibling Windows directory on the same drive", async () => {
    const list = listDirectory([{ path: "../other", type: "directory" }], "C:/workspace");
    await expect(directoryExists({ directory: "C:/workspace" }, "C:/other", list)).resolves.toBe(
      true,
    );
    expect(list).toHaveBeenCalledWith(
      { location: { directory: "C:/workspace" }, path: ".." },
      undefined,
    );
  });

  it.each([
    ["a workspace root", { directory: "/workspace", workspaceID: "wrk_1" }, "/workspace/child"],
    ["a different Windows drive", { directory: "C:\\workspace" }, "D:\\workspace\\child"],
    ["a Windows target from a POSIX root", location, "C:\\workspace\\child"],
    ["a POSIX target from a Windows root", { directory: "C:\\workspace" }, "/workspace/child"],
  ])("rejects %s as outside the project", async (_, root, directory) => {
    const list = listDirectory([]);
    await expect(directoryExists(root, directory, list)).rejects.toThrow(
      "DIRECTORY_OUTSIDE_PROJECT",
    );
    expect(list).not.toHaveBeenCalled();
  });

  it.each([
    ["a relative root", { directory: "workspace" }, "/workspace/child"],
    ["a root with a parent segment", { directory: "/workspace/../other" }, "/workspace/child"],
    ["a root with a current segment", { directory: "/workspace/./child" }, "/workspace/child"],
    ["the root itself", location, "/workspace"],
    ["the root with a trailing slash", location, "/workspace/"],
    ["an ancestor of the root", location, "/"],
    ["a parent of the root", { directory: "/workspace/child" }, "/workspace"],
    ["a target with a current segment", location, "/workspace/./child"],
  ])("rejects %s as an invalid path", async (_, root, directory) => {
    const list = listDirectory([]);
    await expect(directoryExists(root, directory, list)).rejects.toThrow("INVALID_DIRECTORY_PATH");
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects a blank root before listing", async () => {
    const list = listDirectory([]);
    await expect(directoryExists({ directory: "" }, "/workspace/child", list)).rejects.toThrow(
      "LOCATION_REQUIRED",
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects a listing resolved at a malformed location", async () => {
    const list = vi.fn(async () => ({ data: [], location: { directory: " " } }));
    await expect(directoryExists(location, "/workspace/child", list)).rejects.toThrow(
      "MALFORMED_LOCATION",
    );
  });

  it.each([
    ["a listing for a different directory", [], "/elsewhere"],
    ["a non-array listing", { path: "child", type: "directory" }, "/workspace"],
    ["a non-record entry", ["child"], "/workspace"],
    ["an entry without a path", [{ type: "directory" }], "/workspace"],
    ["an entry with an unknown type", [{ path: "child", type: "symlink" }], "/workspace"],
    ["an empty entry path", [{ path: "", type: "directory" }], "/workspace"],
    ["a slash entry path", [{ path: "/", type: "directory" }], "/workspace"],
    ["a dot entry path", [{ path: ".", type: "directory" }], "/workspace"],
    ["a backslash entry path", [{ path: "child\\nested", type: "directory" }], "/workspace"],
    ["a drive entry path", [{ path: "C:\\", type: "directory" }], "/workspace"],
  ])("rejects %s", async (_, data, directory) => {
    await expect(
      directoryExists(location, "/workspace/child", listDirectory(data, directory)),
    ).rejects.toThrow("MALFORMED_DIRECTORY_LIST");
  });

  it("rejects a nested backslash entry under the requested parent", async () => {
    await expect(
      directoryExists(
        location,
        "/workspace/.worktree/live",
        listDirectory([{ path: ".worktree/a\\b", type: "directory" }]),
      ),
    ).rejects.toThrow("MALFORMED_DIRECTORY_LIST");
  });
});

describe("UTF-8 response bounds", () => {
  const readBounded = async (text: string, maxBytes: number) => {
    const response = {
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => text,
    } as unknown as Response;
    const bounded = createBoundedOpenCodeFetch(
      vi.fn(async () => response),
      maxBytes,
    );
    return (await bounded("https://open.tailnet.ts.net/api/info")).text();
  };

  it.each([
    ["empty text", "", 0],
    ["ASCII", "abcd", 4],
    ["the last one-byte code point", "\u007f", 1],
    ["two-byte code points", "øø", 4],
    ["the last two-byte code point", "\u07ff", 2],
    ["the first three-byte code point", "\u0800", 3],
    ["a three-byte code point", "€", 3],
    ["the last BMP code point", "\uffff", 3],
    ["a surrogate pair", "😀", 4],
    ["mixed widths", "a ø € 😀", 13],
  ])("counts %s at its exact UTF-8 length", async (_, text, bytes) => {
    expect(new TextEncoder().encode(text).byteLength).toBe(bytes);
    await expect(readBounded(text, bytes)).resolves.toBe(text);
    if (bytes > 0) {
      await expect(readBounded(text, bytes - 1)).rejects.toMatchObject({
        reason: "ResponseTooLarge",
      });
    }
  });

  it.each([
    ["a lone high surrogate", "\ud800", 3],
    ["a high surrogate before ASCII", "\udbffa", 4],
    ["a high surrogate before another high surrogate", "\ud800\ud800", 6],
    ["a lone low surrogate", "\udc00", 3],
    ["a reversed surrogate pair", "\ude00\ud83d", 6],
  ])("counts %s as replacement characters", async (_, text, bytes) => {
    await expect(readBounded(text, bytes)).resolves.toBe(text);
    await expect(readBounded(text, bytes - 1)).rejects.toMatchObject({
      reason: "ResponseTooLarge",
    });
  });

  it("rejects as soon as the running count exceeds the limit", async () => {
    await expect(readBounded(`a${"\ud800".repeat(1000)}`, 3)).rejects.toMatchObject({
      reason: "ResponseTooLarge",
    });
  });
});

describe("PTY message decoding", () => {
  const encoder = new TextEncoder();
  const arrayBuffer = (text: string) => {
    const bytes = encoder.encode(text);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  };

  function probeWithFrames(frames: (marker: string) => unknown[]) {
    class FrameWebSocket extends EventTarget {
      binaryType: BinaryType = "blob";
      readyState = 0;

      constructor() {
        super();
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
        });
      }

      send(data: string) {
        for (const frame of frames(data.trimEnd())) {
          this.dispatchEvent(new MessageEvent("message", { data: frame }));
        }
      }

      close() {
        this.readyState = 3;
      }
    }
    const client = {
      location: { get: vi.fn(async () => ({ directory: "/workspace" })) },
      pty: {
        connect: {
          token: vi.fn(async () => ({ data: { expires_in: 30, ticket: "ticket_test" } })),
        },
        create: vi.fn(async () => ({ data: { id: "pty_test" } })),
        remove: vi.fn(async () => undefined),
      },
    } as unknown as Parameters<typeof probePtyTransport>[0];
    return probePtyTransport(client, "http://open.tailnet.ts.net", {
      socketTimeoutMs: 50,
      WebSocketConstructor: FrameWebSocket as unknown as typeof WebSocket,
    });
  }

  it("decodes ArrayBuffer frames", async () => {
    await expect(probeWithFrames((marker) => [arrayBuffer(marker)])).resolves.toMatchObject({
      output: true,
    });
  });

  it("decodes typed-array views over their own byte range", async () => {
    await expect(
      probeWithFrames((marker) => {
        const bytes = encoder.encode(`\u0000xx${marker}yy`);
        return [bytes.subarray(3, bytes.length - 2)];
      }),
    ).resolves.toMatchObject({ output: true });
  });

  it("decodes DataView frames", async () => {
    await expect(
      probeWithFrames((marker) => {
        const bytes = encoder.encode(`#${marker}`);
        return [new DataView(bytes.buffer, bytes.byteOffset + 1, bytes.byteLength - 1)];
      }),
    ).resolves.toMatchObject({ output: true });
  });

  it("decodes markers split across frames", async () => {
    await expect(
      probeWithFrames((marker) => [
        marker.slice(0, 5),
        encoder.encode(marker.slice(5, 10)),
        arrayBuffer(marker.slice(10)),
      ]),
    ).resolves.toMatchObject({ output: true });
  });

  it.each([
    ["zero-prefixed control frames", (marker: string) => [encoder.encode(`\u0000${marker}`)]],
    ["zero-prefixed ArrayBuffer frames", (marker: string) => [arrayBuffer(`\u0000${marker}`)]],
    ["empty binary frames", () => [new ArrayBuffer(0)]],
    ["non-binary frames", (marker: string) => [new Blob([marker]), 42, null]],
  ])("ignores %s", async (_, frames) => {
    await expect(probeWithFrames(frames)).rejects.toMatchObject({ reason: "SOCKET_TIMEOUT" });
  });
});
