export type FakeOpenCodeApiOptions = {
  agents?: unknown[];
  configEntries?: unknown[];
  eventFrame?: string;
  failures?: Record<string, { body: unknown; status: number }>;
  forms?: unknown[];
  location?: {
    directory: string;
    project: { canonical: string; directory: string; id: string };
    workspaceID?: string;
  };
  models?: unknown[];
  messagePageSize?: number;
  messages?: Record<string, unknown[]>;
  pageSize?: number;
  permissions?: unknown[];
  projects?: unknown[];
  sessions?: FakeSession[];
};

export type FakeOpenCodeRequest = {
  jsonBody?: unknown;
  method: string;
  path: string;
  query: Record<string, string[]>;
};

export type FakeSession = {
  agent?: string;
  cost: number;
  id: string;
  location: { directory: string; workspaceID?: string };
  model?: { id: string; providerID: string; variant?: string };
  outcome?: "failed" | "interrupted" | "succeeded";
  parentID?: string;
  projectID: string;
  time: { archived?: number; created: number; updated: number };
  title?: string;
  tokens: {
    cache: { read: number; write: number };
    input: number;
    output: number;
    reasoning: number;
  };
};

export function createFakeOpenCodeApi(options: FakeOpenCodeApiOptions = {}) {
  const requests: FakeOpenCodeRequest[] = [];
  let cancelledStreams = 0;
  let eventGenerations = 0;
  let nextSession = 1;
  let sessions = [...(options.sessions ?? [])];
  let pendingForms = [...(options.forms ?? [])];
  const formStates = new Map<string, unknown>();

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const method = init?.method ?? "GET";
    const jsonBody = await readJsonBody(init?.body);
    const query: Record<string, string[]> = {};
    for (const [key, value] of url.searchParams) {
      const values = query[key] ?? [];
      values.push(value);
      query[key] = values;
    }
    requests.push({
      ...(jsonBody === undefined ? {} : { jsonBody }),
      method,
      path: url.pathname,
      query,
    });

    const failure = options.failures?.[url.pathname];
    if (failure) return json(failure.body, failure.status);

    if (url.pathname === "/api/health") {
      return json({ healthy: true, pid: 42, version: "test" });
    }
    if (url.pathname === "/api/server") {
      return json({ urls: ["http://fake.invalid"] });
    }
    if (url.pathname === "/api/project") {
      return json(options.projects ?? []);
    }
    if (url.pathname === "/api/location") {
      const requestedDirectory = url.searchParams.get("location[directory]");
      const requestedWorkspace = url.searchParams.get("location[workspace]");
      const fallback = options.location ?? {
        directory: "/workspace",
        project: { canonical: "/workspace", directory: "/workspace", id: "project-test" },
      };
      return json({
        ...fallback,
        directory: requestedDirectory ?? fallback.directory,
        ...(requestedWorkspace ? { workspaceID: requestedWorkspace } : {}),
      });
    }
    if (url.pathname === "/api/agent") {
      return json({ location: resolvedLocation(options, url), data: options.agents ?? [] });
    }
    if (url.pathname === "/api/config") {
      return json(options.configEntries ?? []);
    }
    if (url.pathname === "/api/model") {
      return json({ location: resolvedLocation(options, url), data: options.models ?? [] });
    }
    if (url.pathname === "/api/permission/request") {
      return json({ location: resolvedLocation(options, url), data: options.permissions ?? [] });
    }
    if (url.pathname === "/api/form/request") {
      return json({ location: resolvedLocation(options, url), data: pendingForms });
    }
    const formMatch = url.pathname.match(
      /^\/api\/session\/([^/]+)\/form\/([^/]+)\/(state|reply|cancel)$/,
    );
    if (formMatch) {
      const sessionID = formMatch[1] ?? "";
      const formID = formMatch[2] ?? "";
      const operation = formMatch[3];
      const pendingIndex = pendingForms.findIndex(
        (form) => isRecord(form) && form.id === formID && form.sessionID === sessionID,
      );
      if (operation === "state" && method === "GET") {
        const settled = formStates.get(`${sessionID}\u0000${formID}`);
        if (settled) return json({ data: settled });
        if (pendingIndex >= 0) return json({ data: { status: "pending" } });
        return json({ _tag: "FormNotFoundError", message: "Not found" }, 404);
      }
      if ((operation === "reply" || operation === "cancel") && method === "POST") {
        if (pendingIndex < 0) {
          return formStates.has(`${sessionID}\u0000${formID}`)
            ? json({ _tag: "FormAlreadySettledError", message: "Settled" }, 409)
            : json({ _tag: "FormNotFoundError", message: "Not found" }, 404);
        }
        if (operation === "reply" && (!isRecord(jsonBody) || !isRecord(jsonBody.answer))) {
          return json({ _tag: "FormInvalidAnswerError", message: "Invalid answer" }, 400);
        }
        pendingForms = pendingForms.filter((_form, index) => index !== pendingIndex);
        formStates.set(
          `${sessionID}\u0000${formID}`,
          operation === "reply"
            ? { answer: isRecord(jsonBody) ? jsonBody.answer : {}, status: "answered" }
            : { status: "cancelled" },
        );
        return new Response(null, { status: 204 });
      }
    }
    if (url.pathname === "/api/session/active") {
      return json({});
    }
    if (url.pathname === "/api/session" && method === "POST") {
      const body = isRecord(jsonBody) ? jsonBody : {};
      const location = isRecord(body.location) ? body.location : {};
      const now = Date.now();
      const session: FakeSession = {
        cost: 0,
        id: typeof body.id === "string" ? body.id : `ses_fake_${nextSession++}`,
        location: {
          directory: typeof location.directory === "string" ? location.directory : "/workspace",
          ...(typeof location.workspaceID === "string"
            ? { workspaceID: location.workspaceID }
            : {}),
        },
        projectID: options.location?.project.id ?? "project-test",
        time: { created: now, updated: now },
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.agent === "string" ? { agent: body.agent } : {}),
        ...(isModelRef(body.model) ? { model: body.model } : {}),
        tokens: { cache: { read: 0, write: 0 }, input: 0, output: 0, reasoning: 0 },
      };
      sessions = [session, ...sessions];
      return json({ data: session });
    }
    if (url.pathname === "/api/session" && method === "GET") {
      const search = url.searchParams.get("search")?.toLocaleLowerCase();
      const directory = url.searchParams.get("directory");
      const project = url.searchParams.get("project");
      const parentID = url.searchParams.get("parentID");
      const workspace = url.searchParams.get("workspace");
      const cursor = url.searchParams.get("cursor");
      const offset = cursor?.startsWith("fake:") ? Number(cursor.slice(5)) : 0;
      const limit = Number(url.searchParams.get("limit")) || options.pageSize || 50;
      const filtered = sessions
        .filter((session) => !directory || session.location.directory === directory)
        .filter((session) => !project || session.projectID === project)
        .filter((session) => {
          if (parentID === null) return true;
          if (parentID === "null") return session.parentID === undefined;
          return session.parentID === parentID;
        })
        .filter((session) => !workspace || session.location.workspaceID === workspace)
        .filter((session) => !search || (session.title ?? "").toLocaleLowerCase().includes(search))
        .sort((first, second) => second.time.updated - first.time.updated);
      const data = filtered.slice(offset, offset + limit);
      const next =
        offset + data.length < filtered.length ? `fake:${offset + data.length}` : undefined;
      return json({ cursor: { ...(next ? { next } : {}) }, data });
    }
    const messagesMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/message$/);
    if (messagesMatch && method === "GET") {
      const sessionID = messagesMatch[1] ?? "";
      const cursor = url.searchParams.get("cursor");
      const cursorParts = cursor?.split(":");
      if (
        cursor &&
        (cursorParts?.length !== 3 ||
          cursorParts[0] !== "message" ||
          (cursorParts[1] !== "asc" && cursorParts[1] !== "desc") ||
          !Number.isInteger(Number(cursorParts[2])) ||
          Number(cursorParts[2]) < 0)
      ) {
        return json({ _tag: "InvalidRequestError", message: "Invalid cursor" }, 400);
      }
      if (
        !Object.hasOwn(options.messages ?? {}, sessionID) &&
        !sessions.some((session) => session.id === sessionID)
      ) {
        return json({ _tag: "SessionNotFoundError", message: "Not found" }, 404);
      }
      const cursorOrder = cursorParts?.[1] === "asc" ? "asc" : "desc";
      const offset = cursorParts?.[0] === "message" ? Number(cursorParts[2]) : 0;
      const limit =
        Number(url.searchParams.get("limit")) || options.messagePageSize || options.pageSize || 50;
      const order = cursor ? cursorOrder : url.searchParams.get("order") === "asc" ? "asc" : "desc";
      const source = [...(options.messages?.[sessionID] ?? [])].sort(
        (first, second) => messageCreated(first) - messageCreated(second),
      );
      if (order === "desc") source.reverse();
      const data = source.slice(offset, offset + limit);
      const next =
        offset + data.length < source.length
          ? `message:${order}:${offset + data.length}`
          : undefined;
      const previous = offset > 0 ? `message:${order}:${Math.max(0, offset - limit)}` : undefined;
      return json({
        cursor: {
          ...(next ? { next } : {}),
          ...(previous ? { previous } : {}),
        },
        data,
      });
    }
    const sessionMatch = url.pathname.match(/^\/api\/session\/([^/]+)$/);
    if (sessionMatch && method === "GET") {
      const session = sessions.find((candidate) => candidate.id === sessionMatch[1]);
      return session
        ? json({ data: session })
        : json({ _tag: "SessionNotFoundError", message: "Not found" }, 404);
    }
    const renameMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/rename$/);
    if (renameMatch && method === "POST") {
      const index = sessions.findIndex((candidate) => candidate.id === renameMatch[1]);
      if (index < 0) return json({ _tag: "SessionNotFoundError", message: "Not found" }, 404);
      const current = sessions[index];
      if (current && isRecord(jsonBody) && typeof jsonBody.title === "string") {
        sessions[index] = {
          ...current,
          time: { ...current.time, updated: Date.now() },
          title: jsonBody.title,
        };
      }
      return new Response(null, { status: 204 });
    }
    if (sessionMatch && method === "DELETE") {
      const rootID = sessionMatch[1];
      const removed = new Set([rootID]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const session of sessions) {
          if (session.parentID && removed.has(session.parentID) && !removed.has(session.id)) {
            removed.add(session.id);
            changed = true;
          }
        }
      }
      sessions = sessions.filter((session) => !removed.has(session.id));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/event") {
      eventGenerations += 1;
      const frame =
        options.eventFrame ??
        `data: {"id":"evt_${eventGenerations}","type":"server.connected","data":{}}\n\n`;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          let cancelled = false;
          controller.enqueue(new TextEncoder().encode(frame));
          const cancel = () => {
            if (cancelled) return;
            cancelled = true;
            cancelledStreams += 1;
            controller.error(new Error("The fake event request was cancelled"));
          };
          if (init?.signal?.aborted) cancel();
          else init?.signal?.addEventListener("abort", cancel, { once: true });
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }

    return json({ _tag: "NotFoundError", message: "Not found" }, 404);
  };

  return {
    fetch,
    get cancelledStreams() {
      return cancelledStreams;
    },
    get eventGenerations() {
      return eventGenerations;
    },
    requests,
    get sessions() {
      return [...sessions];
    },
  };
}

function resolvedLocation(options: FakeOpenCodeApiOptions, url: URL) {
  const fallback = options.location ?? {
    directory: "/workspace",
    project: { canonical: "/workspace", directory: "/workspace", id: "project-test" },
  };
  const directory = url.searchParams.get("location[directory]") ?? fallback.directory;
  const workspaceID = url.searchParams.get("location[workspace]") ?? fallback.workspaceID;
  return { ...fallback, directory, ...(workspaceID ? { workspaceID } : {}) };
}

async function readJsonBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string" || !body) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function isModelRef(value: unknown): value is { id: string; providerID: string; variant?: string } {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.providerID === "string" &&
    (value.variant === undefined || typeof value.variant === "string")
  );
}

function messageCreated(value: unknown) {
  if (!isRecord(value) || !isRecord(value.time) || typeof value.time.created !== "number") return 0;
  return value.time.created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function json(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return new Response(text, {
    headers: {
      "content-length": String(new TextEncoder().encode(text).byteLength),
      "content-type": "application/json",
    },
    status,
  });
}
