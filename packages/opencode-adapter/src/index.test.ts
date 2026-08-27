import { createFakeOpenCodeApi } from "@opencode2-mobile/test-fixtures";
import { describe, expect, it, vi } from "vitest";

import type { OpenCodeEvent, SessionsResponse } from "./index";
import {
  backgroundOpenCodeSession,
  cancelOpenCodeForm,
  cancelOpenCodeSessionInboxItem,
  classifyOpenCodeError,
  createBoundedOpenCodeFetch,
  createOpenCodeClient,
  createOpenCodeSession,
  createRedirectSafeOpenCodeFetch,
  findOpenCodeFiles,
  getCurrentOpenCodeProject,
  getDefaultOpenCodeAgent,
  getDefaultOpenCodeLocation,
  getDefaultOpenCodeModel,
  getOpenCodeFormState,
  getOpenCodeLocation,
  getOpenCodeSession,
  getOpenCodeSessionMessage,
  getOpenCodeVcs,
  getOpenCodeVcsDiff,
  interruptOpenCodeSession,
  listActiveOpenCodeSessions,
  listOpenCodeAgents,
  listOpenCodeCommands,
  listOpenCodeFormRequests,
  listOpenCodeMessages,
  listOpenCodeModels,
  listOpenCodePermissionRequests,
  listOpenCodeProjectSessions,
  listOpenCodeSessionInbox,
  listOpenCodeSessions,
  listOpenCodeSkills,
  normalizeOpenCodeBaseUrl,
  openEventStreamGeneration,
  probeEventStream,
  probePtyTransport,
  promptOpenCodeSession,
  ptyWebSocketUrl,
  queueOpenCodeSessionInboxItem,
  removeOpenCodeSession,
  renameOpenCodeSession,
  replyOpenCodeForm,
  replyOpenCodePermissionRequest,
  runOpenCodeSessionCommand,
  startEventStreamProbe,
  steerOpenCodeSessionInboxItem,
  switchOpenCodeSessionAgent,
  switchOpenCodeSessionModel,
  waitForOpenCodeSession,
} from "./index";

describe("normalizeOpenCodeBaseUrl", () => {
  it("normalizes an origin", () => {
    expect(normalizeOpenCodeBaseUrl(" https://open.tailnet.ts.net:4096/ ")).toBe(
      "https://open.tailnet.ts.net:4096",
    );
  });

  it.each([
    "ftp://open.tailnet.ts.net",
    "https://user:secret@open.tailnet.ts.net",
    "https://open.tailnet.ts.net/api",
    "https://open.tailnet.ts.net?secret=value",
  ])("rejects unsafe or non-origin URL %s", (value) => {
    expect(() => normalizeOpenCodeBaseUrl(value)).toThrow();
  });
});

it("validates form variants and forwards form state, reply, and cancel", async () => {
  const resolvedLocation = {
    directory: "/workspace",
    project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
  };
  const forms = [
    {
      fields: [
        { key: "name", minLength: 1, required: true, type: "string" as const },
        { key: "ratio", maximum: 1, minimum: 0, type: "number" as const },
        { key: "count", minimum: 1, type: "integer" as const },
        { default: false, key: "enabled", type: "boolean" as const },
        {
          key: "details",
          type: "string" as const,
          when: [{ key: "showDetails", op: "eq" as const, value: true }],
        },
        { key: "showDetails", type: "boolean" as const },
        {
          key: "targets",
          maxItems: 2,
          options: [{ label: "One", value: "one" }],
          type: "multiselect" as const,
        },
        { key: "login", type: "external" as const, url: "https://example.test/login" },
      ],
      id: "frm_test",
      sessionID: "ses_test",
      title: "Configure",
    },
    {
      fields: [{ key: "continue", type: "boolean" as const }],
      id: "frm_global",
      sessionID: "global",
      title: "Global elicitation",
    },
  ];
  const list = vi.fn(async () => ({ data: forms, location: resolvedLocation }));
  const state = vi.fn(async () => ({ status: "pending" as const }));
  const reply = vi.fn(async () => undefined);
  const cancel = vi.fn(async () => undefined);
  const client = {
    form: { cancel, reply, request: { list }, state },
  } as unknown as ReturnType<typeof createOpenCodeClient>;
  const options = { signal: new AbortController().signal };

  await expect(
    listOpenCodeFormRequests(client, { directory: "/workspace" }, options),
  ).resolves.toMatchObject({ data: [{ id: "frm_test" }, { id: "frm_global" }] });
  await expect(getOpenCodeFormState(client, "ses_test", "frm_test", options)).resolves.toEqual({
    status: "pending",
  });
  await expect(getOpenCodeFormState(client, "global", "frm_global", options)).resolves.toEqual({
    status: "pending",
  });
  await replyOpenCodeForm(client, "ses_test", "frm_test", { name: "Ada" }, options);
  await cancelOpenCodeForm(client, "ses_test", "frm_test", options);

  expect(state).toHaveBeenCalledWith({ formID: "frm_test", sessionID: "ses_test" }, options);
  expect(reply).toHaveBeenCalledWith(
    { answer: { name: "Ada" }, formID: "frm_test", sessionID: "ses_test" },
    options,
  );
  expect(cancel).toHaveBeenCalledWith({ formID: "frm_test", sessionID: "ses_test" }, options);
});

it("rejects malformed form fields and state", async () => {
  const location = {
    directory: "/workspace",
    project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
  };
  const list = vi.fn(async () => ({
    data: [
      {
        fields: [{ key: "value", type: "unsupported" }],
        id: "frm_test",
        sessionID: "ses_test",
        title: "Bad form",
      },
    ],
    location,
  }));
  const state = vi.fn(async () => ({ status: "answered", answer: null }));
  const client = { form: { request: { list }, state } } as unknown as ReturnType<
    typeof createOpenCodeClient
  >;

  await expect(listOpenCodeFormRequests(client, { directory: "/workspace" })).rejects.toThrow(
    "MALFORMED_FORM_LIST",
  );
  await expect(getOpenCodeFormState(client, "ses_test", "frm_test")).rejects.toThrow(
    "MALFORMED_FORM_STATE",
  );
});

it("settles forms through the generated HTTP client against the fake API", async () => {
  const forms = [
    {
      fields: [{ key: "name", required: true, type: "string" }],
      id: "frm_reply",
      sessionID: "ses_test",
      title: "Reply",
    },
    {
      fields: [{ key: "confirmed", type: "boolean" }],
      id: "frm_cancel",
      sessionID: "ses_test",
      title: "Cancel",
    },
  ];
  const fake = createFakeOpenCodeApi({
    forms,
    location: {
      directory: "/workspace",
      project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
    },
  });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: fake.fetch });

  await expect(getOpenCodeFormState(client, "ses_test", "frm_reply")).resolves.toEqual({
    status: "pending",
  });
  await replyOpenCodeForm(client, "ses_test", "frm_reply", { name: "Ada" });
  await expect(getOpenCodeFormState(client, "ses_test", "frm_reply")).resolves.toEqual({
    answer: { name: "Ada" },
    status: "answered",
  });
  await cancelOpenCodeForm(client, "ses_test", "frm_cancel");
  await expect(getOpenCodeFormState(client, "ses_test", "frm_cancel")).resolves.toEqual({
    status: "cancelled",
  });
  await expect(
    listOpenCodeFormRequests(client, { directory: "/workspace" }),
  ).resolves.toMatchObject({ data: [] });
  expect(fake.requests.filter((request) => request.path.endsWith("/reply"))[0]?.jsonBody).toEqual({
    answer: { name: "Ada" },
  });
});

it("lists and validates sessions for one project", async () => {
  const sessionList = vi.fn(
    async (): Promise<SessionsResponse> => ({
      cursor: { next: "older" },
      data: [
        {
          cost: 0,
          id: "ses_project",
          location: { directory: "/workspace" },
          projectID: "project-1",
          time: { created: 1, updated: 2 },
          tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
        },
      ],
    }),
  );
  const client = { session: { list: sessionList } } as unknown as ReturnType<
    typeof createOpenCodeClient
  >;
  const options = { signal: new AbortController().signal };

  await expect(
    listOpenCodeProjectSessions(
      client,
      "project-1",
      { cursor: "newer", limit: 30, order: "desc", parentID: null, search: "query" },
      options,
    ),
  ).resolves.toMatchObject({ data: [{ id: "ses_project" }] });
  expect(sessionList).toHaveBeenCalledWith(
    {
      cursor: "newer",
      limit: 30,
      order: "desc",
      parentID: null,
      project: "project-1",
      search: "query",
    },
    options,
  );

  sessionList.mockResolvedValueOnce({
    cursor: {},
    data: [
      {
        cost: 0,
        id: "ses_wrong_project",
        location: { directory: "/other" },
        projectID: "project-2",
        time: { created: 1, updated: 2 },
        tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
      },
    ],
  });
  await expect(listOpenCodeProjectSessions(client, "project-1")).rejects.toThrow(
    "MALFORMED_PROJECT_SESSION_LIST",
  );

  sessionList.mockResolvedValueOnce({
    cursor: {},
    data: [
      {
        cost: 0,
        id: "ses_child",
        location: { directory: "/workspace" },
        parentID: "ses_parent",
        projectID: "project-1",
        time: { created: 1, updated: 2 },
        tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
      },
    ],
  });
  await expect(
    listOpenCodeProjectSessions(client, "project-1", { parentID: null }),
  ).rejects.toThrow("MALFORMED_SESSION_PARENT_FILTER");
});

it("requires and forwards explicit locations for location-scoped operations", async () => {
  const resolvedLocation = {
    directory: "/workspace",
    project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
    workspaceID: "wrk_test",
  };
  const locationGet = vi.fn(async () => resolvedLocation);
  const projectCurrent = vi.fn(async () => ({ id: "project-1" }));
  const sessionList = vi.fn(async () => ({ cursor: {}, data: [] }));
  const permissionList = vi.fn(async () => ({ data: [], location: resolvedLocation }));
  const formList = vi.fn(async () => ({ data: [], location: resolvedLocation }));
  const client = {
    form: { request: { list: formList } },
    location: { get: locationGet },
    permission: { request: { list: permissionList } },
    project: { current: projectCurrent },
    session: { list: sessionList },
  } as unknown as ReturnType<typeof createOpenCodeClient>;
  const location = { directory: "/workspace", workspaceID: "wrk_test" };

  await Promise.all([
    getOpenCodeLocation(client, location),
    getCurrentOpenCodeProject(client, location),
    listOpenCodeSessions(client, location, { limit: 50, order: "desc" }),
    listOpenCodePermissionRequests(client, location),
    listOpenCodeFormRequests(client, location),
  ]);

  expect(locationGet).toHaveBeenCalledWith(
    { location: { directory: "/workspace", workspace: "wrk_test" } },
    undefined,
  );
  expect(projectCurrent).toHaveBeenCalledWith(
    { location: { directory: "/workspace", workspace: "wrk_test" } },
    undefined,
  );
  expect(sessionList).toHaveBeenCalledWith(
    { directory: "/workspace", limit: 50, order: "desc", workspace: "wrk_test" },
    undefined,
  );
});

it("validates default and explicit resolved locations", async () => {
  const valid = {
    directory: "/workspace",
    project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
  };
  const locationGet = vi.fn().mockResolvedValueOnce(valid).mockResolvedValueOnce({ directory: "" });
  const client = { location: { get: locationGet } } as unknown as ReturnType<
    typeof createOpenCodeClient
  >;

  await expect(getDefaultOpenCodeLocation(client)).resolves.toEqual(valid);
  await expect(getOpenCodeLocation(client, { directory: "/workspace" })).rejects.toThrow(
    "MALFORMED_LOCATION",
  );
  expect(locationGet).toHaveBeenNthCalledWith(1, undefined, undefined);
});

it("validates and forwards location-scoped VCS information", async () => {
  const api = createFakeOpenCodeApi({ vcs: { branch: { current: "feature/mobile" } } });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });

  await expect(
    getOpenCodeVcs(client, { directory: "/workspace", workspaceID: "wrk_test" }),
  ).resolves.toMatchObject({ data: { branch: { current: "feature/mobile" } } });
  expect(api.requests.at(-1)).toMatchObject({
    path: "/api/vcs",
    query: {
      "location[directory]": ["/workspace"],
      "location[workspace]": ["wrk_test"],
    },
  });

  const malformedApi = createFakeOpenCodeApi({ vcs: { branch: { current: null } } });
  const malformedClient = createOpenCodeClient({
    baseUrl: "https://fake.invalid",
    fetch: malformedApi.fetch,
  });
  await expect(getOpenCodeVcs(malformedClient, { directory: "/workspace" })).rejects.toThrow(
    "MALFORMED_VCS_INFO",
  );
});

it("validates and forwards location-scoped working-tree diffs", async () => {
  const diff = {
    additions: 2,
    deletions: 1,
    file: "src/app.ts",
    patch: "@@ -1 +1 @@\n-old\n+new",
    status: "modified",
  };
  const api = createFakeOpenCodeApi({ vcsDiff: [diff] });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });

  await expect(
    getOpenCodeVcsDiff(client, { directory: "/workspace", workspaceID: "wrk_test" }, "working", {
      context: 5,
    }),
  ).resolves.toMatchObject({ data: [diff] });
  expect(api.requests.at(-1)).toMatchObject({
    path: "/api/vcs/diff",
    query: {
      context: ["5"],
      "location[directory]": ["/workspace"],
      "location[workspace]": ["wrk_test"],
      mode: ["working"],
    },
  });

  const malformedApi = createFakeOpenCodeApi({ vcsDiff: [{ ...diff, additions: -1 }] });
  const malformedClient = createOpenCodeClient({
    baseUrl: "https://fake.invalid",
    fetch: malformedApi.fetch,
  });
  await expect(
    getOpenCodeVcsDiff(malformedClient, { directory: "/workspace" }, "working"),
  ).rejects.toThrow("MALFORMED_VCS_DIFF");
});

it("validates and forwards location-scoped agent and model choices", async () => {
  const location = {
    directory: "/workspace",
    project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
    workspaceID: "wrk_test",
  };
  const agentList = vi.fn(async () => ({
    data: [{ hidden: false, id: "build", mode: "primary", name: "Build" }],
    location,
  }));
  const modelList = vi.fn(async () => ({
    data: [
      {
        enabled: true,
        id: "model-1",
        name: "Model",
        providerID: "provider-1",
        status: "active",
        variants: [],
      },
    ],
    location,
  }));
  const modelDefault = vi.fn(async () => ({
    data: {
      enabled: true,
      id: "model-1",
      name: "Model",
      providerID: "provider-1",
      status: "active",
      variants: [],
    },
    location,
  }));
  const client = {
    agent: { list: agentList },
    model: { default: modelDefault, list: modelList },
  } as unknown as ReturnType<typeof createOpenCodeClient>;

  await expect(
    listOpenCodeAgents(client, { directory: "/workspace", workspaceID: "wrk_test" }),
  ).resolves.toMatchObject({ data: [{ id: "build" }] });
  await expect(
    listOpenCodeModels(client, { directory: "/workspace", workspaceID: "wrk_test" }),
  ).resolves.toMatchObject({ data: [{ id: "model-1" }] });
  await expect(
    getDefaultOpenCodeModel(client, { directory: "/workspace", workspaceID: "wrk_test" }),
  ).resolves.toMatchObject({ data: { id: "model-1" } });
  expect(agentList).toHaveBeenCalledWith(
    { location: { directory: "/workspace", workspace: "wrk_test" } },
    undefined,
  );
  expect(modelList).toHaveBeenCalledWith(
    { location: { directory: "/workspace", workspace: "wrk_test" } },
    undefined,
  );
  expect(modelDefault).toHaveBeenCalledWith(
    { location: { directory: "/workspace", workspace: "wrk_test" } },
    undefined,
  );

  modelList.mockResolvedValueOnce({
    data: [
      {
        enabled: true,
        id: "model-1",
        name: "Model",
        providerID: "provider-1",
        status: "active",
      },
    ],
    location,
  } as never);
  await expect(listOpenCodeModels(client, { directory: "/workspace" })).rejects.toThrow(
    "MALFORMED_MODEL_LIST",
  );
});

it("lists location-scoped commands and skills through the generated client", async () => {
  const api = createFakeOpenCodeApi({
    commands: [{ description: "Review changes", name: "review" }],
    location: {
      directory: "/workspace",
      project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
      workspaceID: "wrk_test",
    },
    skills: [
      {
        content: "Skill content",
        id: "release",
        location: "/workspace/.opencode/skills/release.md",
        name: "Release",
        slash: true,
      },
    ],
  });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });
  const location = { directory: "/workspace", workspaceID: "wrk_test" };

  await expect(listOpenCodeCommands(client, location)).resolves.toMatchObject({
    data: [{ name: "review" }],
  });
  await expect(listOpenCodeSkills(client, location)).resolves.toMatchObject({
    data: [{ id: "release", slash: true }],
  });
  expect(api.requests.slice(-2).map((request) => request.query)).toEqual([
    {
      "location[directory]": ["/workspace"],
      "location[workspace]": ["wrk_test"],
    },
    {
      "location[directory]": ["/workspace"],
      "location[workspace]": ["wrk_test"],
    },
  ]);

  await runOpenCodeSessionCommand(client, "ses_test", {
    command: "review",
    delivery: "queue",
    text: "src/index.ts",
  });
  expect(api.requests.at(-1)).toMatchObject({
    jsonBody: {
      command: "review",
      delivery: "queue",
      text: "src/index.ts",
    },
    path: "/api/session/ses_test/command",
  });

  await expect(interruptOpenCodeSession(client, "ses_test", false)).resolves.toEqual({
    interrupted: true,
  });
  expect(api.requests.at(-1)).toMatchObject({
    path: "/api/session/ses_test/interrupt",
    query: { continue: ["false"] },
  });
});

it("finds bounded files at an exact location", async () => {
  const api = createFakeOpenCodeApi({
    files: [{ path: "src/index.ts", type: "file" }],
  });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });

  await expect(
    findOpenCodeFiles(client, { directory: "/workspace", workspaceID: "wrk_test" }, "index", {
      limit: 20,
    }),
  ).resolves.toMatchObject({ data: [{ path: "src/index.ts" }] });
  expect(api.requests.at(-1)).toMatchObject({
    path: "/api/fs/find",
    query: {
      limit: ["20"],
      "location[directory]": ["/workspace"],
      "location[workspace]": ["wrk_test"],
      query: ["index"],
      type: ["file"],
    },
  });
});

it("rejects malformed command and skill catalogs", async () => {
  const location = {
    directory: "/workspace",
    project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
  };
  const client = {
    command: { list: vi.fn(async () => ({ data: [{ name: "" }], location })) },
    skill: {
      list: vi.fn(async () => ({ data: [{ id: "release", name: "Release" }], location })),
    },
  } as unknown as ReturnType<typeof createOpenCodeClient>;

  await expect(listOpenCodeCommands(client, { directory: "/workspace" })).rejects.toThrow(
    "MALFORMED_COMMAND_LIST",
  );
  await expect(listOpenCodeSkills(client, { directory: "/workspace" })).rejects.toThrow(
    "MALFORMED_SKILL_LIST",
  );
});

it("rejects malformed or over-limit file search results", async () => {
  const location = {
    directory: "/workspace",
    project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
  };
  const client = {
    file: {
      find: vi
        .fn()
        .mockResolvedValueOnce({ data: [{ path: "src" }], location })
        .mockResolvedValueOnce({
          data: [
            { path: "one.ts", type: "file" },
            { path: "two.ts", type: "file" },
          ],
          location,
        }),
    },
  } as unknown as ReturnType<typeof createOpenCodeClient>;

  await expect(findOpenCodeFiles(client, { directory: "/workspace" }, "src")).rejects.toThrow(
    "MALFORMED_FILE_FIND",
  );
  await expect(
    findOpenCodeFiles(client, { directory: "/workspace" }, "src", { limit: 1 }),
  ).rejects.toThrow("MALFORMED_FILE_FIND");
});

it.each(["../secret.txt", "src/../../secret.txt", "/etc/passwd", "C:/outside.txt", "//host/share"])(
  "rejects an out-of-location file search path: %s",
  async (path) => {
    const location = {
      directory: "/workspace",
      project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
    };
    const client = {
      file: { find: vi.fn(async () => ({ data: [{ path, type: "file" }], location })) },
    } as unknown as ReturnType<typeof createOpenCodeClient>;

    await expect(findOpenCodeFiles(client, { directory: "/workspace" }, "file")).rejects.toThrow(
      "MALFORMED_FILE_FIND",
    );
  },
);

it("resolves the highest-priority configured default agent", async () => {
  const api = createFakeOpenCodeApi({
    configEntries: [
      { info: { default_agent: "plan" }, path: "/global/opencode.json", type: "document" },
      { path: "/workspace/.opencode", type: "directory" },
      { path: "/workspace/.opencode/agents", type: "agents" },
      { info: {}, path: "/workspace/opencode.json", type: "document" },
      {
        info: { default_agent: "review" },
        path: "/workspace/.opencode/opencode.json",
        type: "document",
      },
    ],
  });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });

  await expect(
    getDefaultOpenCodeAgent(client, { directory: "/workspace", workspaceID: "wrk_test" }),
  ).resolves.toBe("review");
  expect(api.requests.at(-1)).toMatchObject({
    path: "/api/config",
    query: {
      "location[directory]": ["/workspace"],
      "location[workspace]": ["wrk_test"],
    },
  });
});

it("returns null when no config document defines a default agent", async () => {
  const api = createFakeOpenCodeApi({
    configEntries: [{ info: {}, path: "/workspace/opencode.json", type: "document" }],
  });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });

  await expect(getDefaultOpenCodeAgent(client, { directory: "/workspace" })).resolves.toBeNull();
});

it("forwards composer and execution operations", async () => {
  const item = {
    delivery: "queue" as const,
    id: "msg_admission",
    payload: { text: "Hello" },
    sessionID: "ses_test",
    timeCreated: 1,
    type: "user" as const,
  };
  const switchAgent = vi.fn(async () => undefined);
  const switchModel = vi.fn(async () => undefined);
  const prompt = vi.fn(async () => item);
  const command = vi.fn(async () => undefined);
  const permissionReply = vi.fn(async () => undefined);
  const list = vi.fn(async () => [item]);
  const projectedMessage = {
    id: "msg_admission",
    text: "Hello",
    time: { created: 1 },
    type: "user" as const,
  };
  const message = vi.fn(async () => projectedMessage);
  const cancel = vi.fn(async () => undefined);
  const steer = vi.fn(async () => undefined);
  const queue = vi.fn(async () => undefined);
  const interrupt = vi.fn(async () => ({ interrupted: true }));
  const background = vi.fn(async () => undefined);
  const wait = vi.fn(async () => undefined);
  const client = {
    permission: { reply: permissionReply },
    session: {
      background,
      command,
      inbox: { cancel, list, queue, steer },
      interrupt,
      message,
      prompt,
      switchAgent,
      switchModel,
      wait,
    },
  } as unknown as ReturnType<typeof createOpenCodeClient>;
  const options = { signal: new AbortController().signal };
  const model = { id: "model-1", providerID: "provider-1", variant: "fast" };

  await switchOpenCodeSessionAgent(client, "ses_test", "build", options);
  await switchOpenCodeSessionModel(client, "ses_test", model, options);
  await expect(
    promptOpenCodeSession(
      client,
      "ses_test",
      { delivery: "queue", id: "msg_admission", text: "Hello" },
      options,
    ),
  ).resolves.toBe(item);
  await expect(
    runOpenCodeSessionCommand(
      client,
      "ses_test",
      {
        command: "review",
        delivery: "queue",
        text: "src unicode-æ",
      },
      options,
    ),
  ).resolves.toBeUndefined();
  await expect(listOpenCodeSessionInbox(client, "ses_test", options)).resolves.toEqual([item]);
  await expect(
    getOpenCodeSessionMessage(client, "ses_test", "msg_admission", options),
  ).resolves.toBe(projectedMessage);
  await cancelOpenCodeSessionInboxItem(client, "ses_test", "msg_admission", options);
  await steerOpenCodeSessionInboxItem(client, "ses_test", "msg_admission", options);
  await queueOpenCodeSessionInboxItem(client, "ses_test", "msg_admission", options);
  await expect(interruptOpenCodeSession(client, "ses_test", true, options)).resolves.toEqual({
    interrupted: true,
  });
  await backgroundOpenCodeSession(client, "ses_test", options);
  await waitForOpenCodeSession(client, "ses_test", options);
  await replyOpenCodePermissionRequest(client, "ses_test", "per_test", "once", options);

  expect(switchAgent).toHaveBeenCalledWith({ agent: "build", sessionID: "ses_test" }, options);
  expect(switchModel).toHaveBeenCalledWith({ model, sessionID: "ses_test" }, options);
  expect(prompt).toHaveBeenCalledWith(
    { delivery: "queue", id: "msg_admission", sessionID: "ses_test", text: "Hello" },
    options,
  );
  expect(command).toHaveBeenCalledWith(
    {
      command: "review",
      delivery: "queue",
      sessionID: "ses_test",
      text: "src unicode-æ",
    },
    options,
  );
  expect(list).toHaveBeenCalledWith({ sessionID: "ses_test" }, options);
  expect(message).toHaveBeenCalledWith(
    { messageID: "msg_admission", sessionID: "ses_test" },
    options,
  );
  expect(cancel).toHaveBeenCalledWith({ inboxID: "msg_admission", sessionID: "ses_test" }, options);
  expect(steer).toHaveBeenCalledWith({ inboxID: "msg_admission", sessionID: "ses_test" }, options);
  expect(queue).toHaveBeenCalledWith({ inboxID: "msg_admission", sessionID: "ses_test" }, options);
  expect(interrupt).toHaveBeenCalledWith({ continue: true, sessionID: "ses_test" }, options);
  expect(background).toHaveBeenCalledWith({ sessionID: "ses_test" }, options);
  expect(wait).toHaveBeenCalledWith({ sessionID: "ses_test" }, options);
  expect(permissionReply).toHaveBeenCalledWith(
    { reply: "once", requestID: "per_test", sessionID: "ses_test" },
    options,
  );
});

it("rejects invalid prompt admission IDs before transmission", async () => {
  const prompt = vi.fn();
  const client = { session: { prompt } } as unknown as ReturnType<typeof createOpenCodeClient>;

  await expect(
    promptOpenCodeSession(client, "ses_test", {
      delivery: "steer",
      id: "admission",
      text: "Hello",
    }),
  ).rejects.toThrow("INVALID_MESSAGE_ID");
  expect(prompt).not.toHaveBeenCalled();
});

it("validates active session state", async () => {
  const active = vi.fn<() => Promise<Record<string, { type: "running" }>>>(async () => ({
    ses_running: { type: "running" },
  }));
  const client = { session: { active } } as unknown as ReturnType<typeof createOpenCodeClient>;

  await expect(listActiveOpenCodeSessions(client)).resolves.toEqual({
    ses_running: { type: "running" },
  });
  active.mockResolvedValueOnce({ invalid: { type: "running" } });
  await expect(listActiveOpenCodeSessions(client)).rejects.toThrow("MALFORMED_ACTIVE_SESSIONS");
});

it("forwards explicit locations and request cancellation through session CRUD", async () => {
  const session = (id: string) => ({
    cost: 0,
    id,
    location: { directory: "/workspace", workspaceID: "wrk_test" },
    projectID: "project-1",
    time: { created: 1, updated: 1 },
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  });
  const create = vi.fn(async () => session("ses_new"));
  const get = vi.fn(async () => session("ses_existing"));
  const rename = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const client = { session: { create, get, remove, rename } } as unknown as ReturnType<
    typeof createOpenCodeClient
  >;
  const controller = new AbortController();
  const options = { signal: controller.signal };

  await createOpenCodeSession(
    client,
    { directory: "/workspace", workspaceID: "wrk_test" },
    { agent: "build", title: "Mobile" },
    options,
  );
  await getOpenCodeSession(client, "ses_existing", options);
  await renameOpenCodeSession(client, "ses_existing", "Renamed", options);
  await removeOpenCodeSession(client, "ses_existing", options);

  expect(create).toHaveBeenCalledWith(
    {
      agent: "build",
      location: { directory: "/workspace", workspaceID: "wrk_test" },
      title: "Mobile",
    },
    options,
  );
  expect(get).toHaveBeenCalledWith({ sessionID: "ses_existing" }, options);
  expect(rename).toHaveBeenCalledWith({ sessionID: "ses_existing", title: "Renamed" }, options);
  expect(remove).toHaveBeenCalledWith({ sessionID: "ses_existing" }, options);

  get.mockResolvedValueOnce(session("ses_different"));
  await expect(getOpenCodeSession(client, "ses_existing", options)).rejects.toThrow(
    "MALFORMED_SESSION",
  );
});

it("rejects an empty explicit location", async () => {
  const client = {} as ReturnType<typeof createOpenCodeClient>;
  await expect(listOpenCodeSessions(client, { directory: "" })).rejects.toThrow(
    "LOCATION_REQUIRED",
  );
});

it("follows same-origin redirects manually", async () => {
  const delegate = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, {
        headers: { location: "/api/health/" },
        status: 307,
      }),
    )
    .mockResolvedValueOnce(Response.json({ healthy: true }));
  const fetch = createRedirectSafeOpenCodeFetch(delegate);

  await expect(
    fetch("https://open.tailnet.ts.net/api/health", {
      headers: { authorization: "Bearer test-secret" },
    }),
  ).resolves.toMatchObject({ status: 200 });
  expect(delegate).toHaveBeenNthCalledWith(
    2,
    new URL("https://open.tailnet.ts.net/api/health/"),
    expect.objectContaining({ redirect: "manual" }),
  );
});

it.each(["https://other.tailnet.ts.net/api/health", "http://open.tailnet.ts.net/api/health"])(
  "rejects an unsafe redirect without forwarding credentials to %s",
  async (location) => {
    const delegate = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        headers: { location },
        status: 307,
      }),
    );
    const fetch = createRedirectSafeOpenCodeFetch(delegate);

    const error = await fetch("https://open.tailnet.ts.net/api/health", {
      headers: { authorization: "Bearer test-secret" },
    }).catch((caught: unknown) => caught);

    expect(classifyOpenCodeError(error)).toBe("UNSAFE_REDIRECT");
    expect(delegate).toHaveBeenCalledTimes(1);
  },
);

it("passes authorization to the generated Promise client", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ healthy: true, version: "test", pid: 42 }),
  );
  const client = createOpenCodeClient({
    authorization: "Bearer test-secret",
    baseUrl: "https://open.tailnet.ts.net",
    fetch,
  });

  await expect(client.health.get()).resolves.toMatchObject({ healthy: true, pid: 42 });
  const [url, init] = fetch.mock.calls[0] ?? [];

  expect(String(url)).toBe("https://open.tailnet.ts.net/api/health");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
});

it("recognizes an abort wrapped by the generated client", () => {
  expect(
    classifyOpenCodeError(
      new Error("transport", { cause: new DOMException("aborted", "AbortError") }),
    ),
  ).toBe("TIMEOUT");
});

it.each([
  new Error("transport", { cause: { code: "CERT_HAS_EXPIRED" } }),
  new Error("transport", { cause: { code: -1202 } }),
  new Error("transport", { cause: new Error("Trust anchor for certification path not found") }),
])("recognizes a TLS failure without returning transport details", (error) => {
  expect(classifyOpenCodeError(error)).toBe("TLS");
});

it("recognizes an unauthorized error wrapped by the generated client", () => {
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "UnauthorizedError" } })),
  ).toBe("UNAUTHORIZED");
  expect(classifyOpenCodeError(new Error("transport", { cause: { _tag: "ConflictError" } }))).toBe(
    "CONFLICT",
  );
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "SessionBusyError" } })),
  ).toBe("CONFLICT");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "FormAlreadySettledError" } })),
  ).toBe("CONFLICT");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "InvalidRequestError" } })),
  ).toBe("INVALID_REQUEST");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "FormInvalidAnswerError" } })),
  ).toBe("INVALID_REQUEST");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "SessionNotFoundError" } })),
  ).toBe("NOT_FOUND");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "ProjectNotFoundError" } })),
  ).toBe("NOT_FOUND");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "FormNotFoundError" } })),
  ).toBe("NOT_FOUND");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "CommandNotFoundError" } })),
  ).toBe("NOT_FOUND");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "SkillNotFoundError" } })),
  ).toBe("NOT_FOUND");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "CommandEvaluationError" } })),
  ).toBe("INVALID_REQUEST");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "CommandExecutionError" } })),
  ).toBe("INVALID_REQUEST");
  expect(
    classifyOpenCodeError(new Error("transport", { cause: { _tag: "MessageNotFoundError" } })),
  ).toBe("MESSAGE_NOT_FOUND");
});

it("rejects declared oversized JSON before reading its body", async () => {
  const cancel = vi.fn(async () => undefined);
  const text = vi.fn(async () => '{"healthy":true}');
  const response = {
    body: { cancel },
    headers: new Headers({
      "content-length": "1025",
      "content-type": "application/json",
    }),
    text,
  } as unknown as Response;
  const delegate = vi.fn(async () => response) as unknown as typeof fetch;
  const boundedFetch = createBoundedOpenCodeFetch(delegate, 1024);

  await expect(boundedFetch("https://open.tailnet.ts.net/api/health")).rejects.toMatchObject({
    reason: "ResponseTooLarge",
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(text).not.toHaveBeenCalled();
});

it("rejects oversized JSON without a declared content length", async () => {
  const delegate = vi.fn(async () => {
    return new Response('{"value":"123456789"}', {
      headers: { "content-type": "application/json" },
    });
  });
  const client = createOpenCodeClient({
    baseUrl: "https://open.tailnet.ts.net",
    fetch: createBoundedOpenCodeFetch(delegate, 8),
  });

  const error = await client.health.get().catch((caught: unknown) => caught);
  expect(classifyOpenCodeError(error)).toBe("RESPONSE_TOO_LARGE");
});

it("allows JSON within the response limit", async () => {
  const body = JSON.stringify({ healthy: true, pid: 42, version: "test" });
  const delegate = vi.fn(async () => {
    return new Response(body, {
      headers: {
        "content-length": String(body.length),
        "content-type": "application/json",
      },
    });
  });
  const client = createOpenCodeClient({
    baseUrl: "https://open.tailnet.ts.net",
    fetch: createBoundedOpenCodeFetch(delegate, 1024),
  });

  await expect(client.health.get()).resolves.toMatchObject({ healthy: true, pid: 42 });
});

it("matches the fake API REST, stream, cancellation, and reconnect contract", async () => {
  const api = createFakeOpenCodeApi();
  const client = createOpenCodeClient({
    authorization: "Bearer test-secret",
    baseUrl: "https://fake.invalid",
    fetch: createBoundedOpenCodeFetch(api.fetch, 1024),
  });

  await Promise.all([
    client.health.get(),
    client.server.get(),
    client.session.list({ limit: 1, order: "desc" }),
  ]);
  for (let generation = 0; generation < 2; generation += 1) {
    const probe = startEventStreamProbe(client);
    await expect(probe.firstEvent).resolves.toEqual({ eventType: "server.connected" });
    await expect(probe.stop()).resolves.toBeUndefined();
  }

  expect(api.requests.map(({ method, path }) => ({ method, path }))).toEqual([
    { method: "GET", path: "/api/health" },
    { method: "GET", path: "/api/server" },
    { method: "GET", path: "/api/session" },
    { method: "GET", path: "/api/event" },
    { method: "GET", path: "/api/event" },
  ]);
  expect(api.cancelledStreams).toBe(2);
  expect(api.eventGenerations).toBe(2);
});

it("runs paginated search and session lifecycle against the deterministic fake API", async () => {
  const session = (id: string, title: string, updated: number, parentID?: string) => ({
    cost: 0,
    id,
    location: { directory: "/workspace", workspaceID: "wrk_test" },
    ...(parentID ? { parentID } : {}),
    projectID: "project-1",
    time: { created: updated, updated },
    title,
    tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
  });
  const api = createFakeOpenCodeApi({
    location: {
      directory: "/workspace",
      project: { canonical: "/workspace", directory: "/workspace", id: "project-1" },
      workspaceID: "wrk_test",
    },
    pageSize: 2,
    sessions: [
      session("ses_root", "Root", 3),
      session("ses_child", "Child", 2, "ses_root"),
      session("ses_other", "Other", 1),
    ],
  });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });
  const location = { directory: "/workspace", workspaceID: "wrk_test" };

  await expect(getDefaultOpenCodeLocation(client)).resolves.toMatchObject({
    directory: "/workspace",
    workspaceID: "wrk_test",
  });
  const first = await listOpenCodeSessions(client, location, { limit: 2, order: "desc" });
  expect(first.data.map((item) => item.id)).toEqual(["ses_root", "ses_child"]);
  expect(first.cursor.next).toBe("fake:2");
  const second = await listOpenCodeSessions(client, location, {
    ...(first.cursor.next ? { cursor: first.cursor.next } : {}),
    limit: 2,
    order: "desc",
  });
  expect(second.data.map((item) => item.id)).toEqual(["ses_other"]);
  await expect(listOpenCodeSessions(client, location, { search: "other" })).resolves.toMatchObject({
    data: [{ id: "ses_other" }],
  });

  const created = await createOpenCodeSession(client, location, { title: "Created" });
  await expect(getOpenCodeSession(client, created.id)).resolves.toMatchObject({ title: "Created" });
  await renameOpenCodeSession(client, created.id, "Renamed");
  await expect(getOpenCodeSession(client, created.id)).resolves.toMatchObject({ title: "Renamed" });
  await removeOpenCodeSession(client, "ses_root");
  expect(api.sessions.map((item) => item.id)).not.toContain("ses_root");
  expect(api.sessions.map((item) => item.id)).not.toContain("ses_child");
});

it("loads every current message variant and follows descending cursors toward older messages", async () => {
  const messages = [
    {
      agent: "build",
      id: "msg_agent",
      previous: "plan",
      time: { created: 1 },
      type: "agent-switched",
    },
    {
      id: "msg_model",
      model: { id: "model-2", providerID: "provider" },
      previous: { id: "model-1", providerID: "provider" },
      time: { created: 2 },
      type: "model-switched",
    },
    {
      id: "msg_location",
      location: { directory: "/workspace", workspaceID: "wrk_test" },
      time: { created: 3 },
      type: "location-switched",
    },
    {
      agents: [{ name: "review", mention: { end: 7, start: 0, text: "@review" } }],
      files: [
        {
          data: "dGVzdA==",
          mime: "text/plain",
          name: "note.txt",
          source: { type: "inline" },
        },
      ],
      id: "msg_user",
      skills: [{ id: "skill-1", name: "Review" }],
      text: "Review this",
      time: { created: 4 },
      type: "user",
    },
    {
      description: "Generated context",
      id: "msg_synthetic",
      text: "Synthetic text",
      time: { created: 5 },
      type: "synthetic",
    },
    {
      id: "msg_system",
      text: "System text",
      time: { created: 6 },
      type: "system",
    },
    {
      id: "msg_skill",
      name: "Review",
      skill: "review",
      text: "Skill text",
      time: { created: 7 },
      type: "skill",
    },
    {
      command: "pnpm test",
      exit: 0,
      id: "msg_shell",
      output: { cursor: 2, output: "ok", size: 2, truncated: false },
      shellID: "shell-1",
      status: "exited",
      time: { completed: 9, created: 8 },
      type: "shell",
    },
    {
      agent: "build",
      content: [
        { text: "Answer", type: "text" },
        { text: "Reasoning", type: "reasoning" },
        {
          id: "tool-streaming",
          name: "read",
          state: { input: "{", status: "streaming" },
          time: { created: 9 },
          type: "tool",
        },
        {
          id: "tool-running",
          name: "grep",
          state: { input: {}, metadata: {}, status: "running" },
          time: { created: 9 },
          type: "tool",
        },
        {
          id: "tool-completed",
          name: "test",
          state: {
            content: [
              { text: "passed", type: "text" },
              { mime: "text/plain", name: "result.txt", type: "file", uri: "file:///result" },
            ],
            input: {},
            status: "completed",
          },
          time: { completed: 10, created: 9 },
          type: "tool",
        },
        {
          id: "tool-error",
          name: "write",
          state: {
            content: [{ text: "failed", type: "text" }],
            error: { message: "Failed", status: 500, type: "ToolError" },
            input: {},
            status: "error",
          },
          time: { completed: 10, created: 9 },
          type: "tool",
        },
      ],
      id: "msg_assistant",
      model: { id: "model-2", providerID: "provider" },
      retry: {
        at: 11,
        attempt: 2,
        error: { message: "Retrying", type: "ProviderError" },
      },
      time: { completed: 10, created: 9 },
      type: "assistant",
    },
    {
      id: "msg_compaction_running",
      reason: "auto",
      recent: "Recent",
      status: "running",
      summary: "Summary",
      time: { created: 10 },
      type: "compaction",
    },
    {
      id: "msg_compaction_completed",
      reason: "manual",
      recent: "Recent",
      status: "completed",
      summary: "Summary",
      time: { created: 11 },
      type: "compaction",
    },
    {
      error: { message: "Failed", type: "CompactionError" },
      id: "msg_compaction_failed",
      reason: "auto",
      status: "failed",
      time: { created: 12 },
      type: "compaction",
    },
  ];
  const api = createFakeOpenCodeApi({ messagePageSize: 5, messages: { ses_test: messages } });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });

  const first = await listOpenCodeMessages(client, "ses_test", { limit: 5, order: "desc" });
  expect(first.data.map(({ id }) => id)).toEqual([
    "msg_compaction_failed",
    "msg_compaction_completed",
    "msg_compaction_running",
    "msg_assistant",
    "msg_shell",
  ]);
  expect(first.cursor.next).toBe("message:desc:5");

  const second = await listOpenCodeMessages(client, "ses_test", {
    cursor: first.cursor.next ?? undefined,
    limit: 5,
  });
  expect(second.data.map(({ id }) => id)).toEqual([
    "msg_skill",
    "msg_system",
    "msg_synthetic",
    "msg_user",
    "msg_location",
  ]);
  expect(second.cursor.previous).toBe("message:desc:0");
  expect(api.requests.at(-1)?.query.order).toBeUndefined();

  const third = await listOpenCodeMessages(client, "ses_test", {
    cursor: second.cursor.next ?? undefined,
    limit: 5,
  });
  expect(third.data.map(({ id }) => id)).toEqual(["msg_model", "msg_agent"]);
});

it("preserves ascending message order across opaque cursor requests", async () => {
  const messages = [1, 2, 3].map((created) => ({
    id: `msg_${created}`,
    text: `Message ${created}`,
    time: { created },
    type: "user",
  }));
  const api = createFakeOpenCodeApi({ messagePageSize: 2, messages: { ses_test: messages } });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });

  const first = await listOpenCodeMessages(client, "ses_test", { limit: 2, order: "asc" });
  const second = await listOpenCodeMessages(client, "ses_test", {
    cursor: first.cursor.next ?? undefined,
    limit: 2,
  });

  expect(first.data.map(({ id }) => id)).toEqual(["msg_1", "msg_2"]);
  expect(second.data.map(({ id }) => id)).toEqual(["msg_3"]);
});

it("rejects invalid message pagination and malformed projected messages", async () => {
  const api = createFakeOpenCodeApi({
    failures: {
      "/api/session/ses_test/message": {
        body: {
          cursor: {},
          data: [{ id: "msg_unknown", time: { created: 1 }, type: "future-message" }],
        },
        status: 200,
      },
    },
  });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch: api.fetch });

  await expect(
    listOpenCodeMessages(client, "ses_test", { cursor: "message:desc:1", order: "desc" }),
  ).rejects.toThrow("MESSAGE_CURSOR_WITH_ORDER");
  await expect(listOpenCodeMessages(client, "ses_test")).rejects.toThrow("MALFORMED_MESSAGE_LIST");
});

it("rejects malformed assistant retry state", async () => {
  const client = {
    message: {
      list: vi.fn(async () => ({
        cursor: {},
        data: [
          {
            agent: "build",
            content: [],
            id: "msg_assistant",
            model: { id: "model-1", providerID: "provider" },
            retry: {
              at: 2,
              attempt: "2",
              error: { message: "Retrying", type: "ProviderError" },
            },
            time: { created: 1 },
            type: "assistant",
          },
        ],
      })),
    },
  } as unknown as Parameters<typeof listOpenCodeMessages>[0];

  await expect(listOpenCodeMessages(client, "ses_test")).rejects.toThrow("MALFORMED_MESSAGE_LIST");
});

it("forwards message-list cancellation to the generated client", async () => {
  const api = createFakeOpenCodeApi({ messages: { ses_test: [] } });
  const controller = new AbortController();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.signal).toBe(controller.signal);
    return api.fetch(input, init);
  });
  const client = createOpenCodeClient({ baseUrl: "https://fake.invalid", fetch });

  await expect(
    listOpenCodeMessages(client, "ses_test", {}, { signal: controller.signal }),
  ).resolves.toEqual({ cursor: {}, data: [] });
});

it("classifies fake API failures without exposing their bodies", async () => {
  const api = createFakeOpenCodeApi({
    failures: {
      "/api/health": {
        body: { _tag: "UnauthorizedError", message: "test-only detail" },
        status: 401,
      },
    },
  });
  const client = createOpenCodeClient({
    baseUrl: "https://fake.invalid",
    fetch: api.fetch,
  });

  const error = await client.health.get().catch((caught: unknown) => caught);
  expect(classifyOpenCodeError(error)).toBe("UNAUTHORIZED");
});

it("classifies a malformed fake API event frame", async () => {
  const api = createFakeOpenCodeApi({ eventFrame: "data: not-json\n\n" });
  const client = createOpenCodeClient({
    baseUrl: "https://fake.invalid",
    fetch: api.fetch,
  });
  const iterator = client.event.subscribe()[Symbol.asyncIterator]();

  const error = await iterator.next().catch((caught: unknown) => caught);
  expect(classifyOpenCodeError(error)).toBe("MALFORMED_RESPONSE");
});

it("classifies a missing required V2 endpoint as incompatible", async () => {
  const api = createFakeOpenCodeApi({
    failures: { "/api/project": { body: {}, status: 404 } },
  });
  const client = createOpenCodeClient({
    baseUrl: "https://fake.invalid",
    fetch: api.fetch,
  });

  const error = await client.project.list().catch((caught: unknown) => caught);
  expect(classifyOpenCodeError(error)).toBe("INCOMPATIBLE");
});

it("receives an event and cancels the generated SSE iterator", async () => {
  const encoder = new TextEncoder();
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"id":"evt_test","type":"server.connected","data":{}}\n\n'),
        );
        init?.signal?.addEventListener("abort", () => {
          controller.error(new Error("The native request was cancelled"));
        });
      },
    });

    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  const client = createOpenCodeClient({
    baseUrl: "https://open.tailnet.ts.net",
    fetch,
  });

  await expect(probeEventStream(client)).resolves.toEqual({
    cancellation: true,
    eventType: "server.connected",
  });
});

it("rejects an SSE event above the generated 16 MiB limit", async () => {
  const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
  const delegate = vi.fn(async () => {
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent < 17) {
          sent += 1;
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  const client = createOpenCodeClient({
    baseUrl: "https://open.tailnet.ts.net",
    fetch: delegate,
  });
  const iterator = client.event.subscribe()[Symbol.asyncIterator]();

  const error = await iterator.next().catch((caught: unknown) => caught);
  expect(classifyOpenCodeError(error)).toBe("SSE_TOO_LARGE");
});

it("reports an event stream that ignores cancellation", async () => {
  const event: OpenCodeEvent = { data: {}, id: "evt_test", type: "server.connected" };
  const client = {
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {
          while (true) yield event;
        },
      }),
    },
  };

  await expect(
    probeEventStream(client, { cancellationTimeoutMs: 10, firstEventTimeoutMs: 10 }),
  ).rejects.toMatchObject({ reason: "CANCELLATION_IGNORED" });
});

it("keeps an event generation open until lifecycle cancellation", async () => {
  let aborted = false;
  const event: OpenCodeEvent = { data: {}, id: "evt_test", type: "server.connected" };
  const client = {
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          yield event;
          if (signal.aborted) {
            aborted = true;
            return;
          }
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            });
          });
        },
      }),
    },
  } as unknown as Parameters<typeof openEventStreamGeneration>[0];

  const generation = await openEventStreamGeneration(client);
  expect(generation.eventType).toBe("server.connected");
  expect(aborted).toBe(false);

  await generation.cancel();
  expect(aborted).toBe(true);
});

it("reports a pending event read that ignores lifecycle cancellation", async () => {
  const event: OpenCodeEvent = { data: {}, id: "evt_test", type: "server.connected" };
  const client = {
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {
          yield event;
          await new Promise(() => undefined);
        },
      }),
    },
  } as unknown as Parameters<typeof openEventStreamGeneration>[0];

  const generation = await openEventStreamGeneration(client, { cancellationTimeoutMs: 10 });
  await expect(generation.cancel()).rejects.toMatchObject({ reason: "CANCELLATION_IGNORED" });
});

it("can stop an event probe before its first event", async () => {
  let aborted = false;
  const client = {
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<OpenCodeEvent>>((_resolve, reject) => {
                signal.addEventListener("abort", () => {
                  aborted = true;
                  reject(new Error("The native request was cancelled"));
                });
              }),
          };
        },
      }),
    },
  } as unknown as Parameters<typeof startEventStreamProbe>[0];
  const probe = startEventStreamProbe(client);

  await expect(Promise.all([probe.stop(), probe.stop()])).resolves.toEqual([undefined, undefined]);
  await expect(probe.firstEvent).rejects.toThrow("The native request was cancelled");
  expect(aborted).toBe(true);
});

it("builds a ticketed PTY WebSocket URL", () => {
  const url = new URL(
    ptyWebSocketUrl("https://open.tailnet.ts.net", "pty/test", "/workspace one", "secret"),
  );

  expect(url.protocol).toBe("wss:");
  expect(url.pathname).toBe("/api/pty/pty%2Ftest/connect");
  expect(url.searchParams.get("location[directory]")).toBe("/workspace one");
  expect(url.searchParams.get("cursor")).toBe("-1");
  expect(url.searchParams.get("ticket")).toBe("secret");
});

it("probes PTY output and removes the created PTY", async () => {
  class EchoWebSocket extends EventTarget {
    binaryType: BinaryType = "blob";
    readyState = 0;

    constructor(readonly url: string | URL) {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }

    send(data: string) {
      this.dispatchEvent(new MessageEvent("message", { data }));
    }

    close() {
      this.readyState = 3;
    }
  }
  const create = vi.fn(async () => ({
    data: { id: "pty_test" },
    location: { directory: "/workspace" },
  }));
  const remove = vi.fn(async () => undefined);
  const client = {
    location: {
      get: vi.fn(async () => ({ directory: "/workspace" })),
    },
    pty: {
      create,
      connect: {
        token: vi.fn(async () => ({
          data: { expires_in: 30, ticket: "ticket_test" },
        })),
      },
      remove,
    },
  } as unknown as Parameters<typeof probePtyTransport>[0];

  await expect(
    probePtyTransport(client, "http://open.tailnet.ts.net", {
      WebSocketConstructor: EchoWebSocket as unknown as typeof WebSocket,
    }),
  ).resolves.toEqual({ cleanup: true, output: true, ticketExpiresIn: 30 });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ location: { directory: "/workspace" } }),
    expect.anything(),
  );
  expect(remove).toHaveBeenCalledWith(
    {
      location: { directory: "/workspace" },
      ptyID: "pty_test",
    },
    expect.anything(),
  );
});

it("removes the created PTY when its WebSocket fails", async () => {
  class FailedWebSocket extends EventTarget {
    binaryType: BinaryType = "blob";
    readyState = 0;

    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("error")));
    }

    close() {
      this.readyState = 3;
    }
  }
  const remove = vi.fn(async () => undefined);
  const client = {
    location: {
      get: vi.fn(async () => ({ directory: "/workspace" })),
    },
    pty: {
      create: vi.fn(async () => ({
        data: { id: "pty_test" },
        location: { directory: "/workspace" },
      })),
      connect: {
        token: vi.fn(async () => ({
          data: { expires_in: 30, ticket: "ticket_test" },
        })),
      },
      remove,
    },
  } as unknown as Parameters<typeof probePtyTransport>[0];

  await expect(
    probePtyTransport(client, "http://open.tailnet.ts.net", {
      WebSocketConstructor: FailedWebSocket as unknown as typeof WebSocket,
    }),
  ).rejects.toMatchObject({ reason: "SOCKET_ERROR" });
  expect(remove).toHaveBeenCalledOnce();
});
