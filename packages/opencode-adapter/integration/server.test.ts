import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, test } from "vitest";

import { startCompatibilityProvider } from "../../test-fixtures/integration/openai-provider.mjs";
import {
  createBoundedOpenCodeFetch,
  createOpenCodeClient,
  createOpenCodeSession,
  createRedirectSafeOpenCodeFetch,
  getOpenCodeFormState,
  getOpenCodeLocation,
  listActiveOpenCodeSessions,
  listOpenCodeFormRequests,
  listOpenCodeMessages,
  listOpenCodePermissionRequests,
  listOpenCodeProjects,
  listOpenCodeSessions,
  promptOpenCodeSession,
  removeOpenCodeSession,
  replyOpenCodeForm,
  replyOpenCodePermissionRequest,
  waitForOpenCodeSession,
} from "../src/index";

let directory: string;
let workspace: string;
let child: ReturnType<typeof spawn> | undefined;
let provider: Awaited<ReturnType<typeof startCompatibilityProvider>> | undefined;
let client: ReturnType<typeof createOpenCodeClient>;
const sessionIDs: string[] = [];
let serverVersion: string;

beforeAll(async () => {
  const binary = process.env.OPENCODE_TEST_BINARY;
  if (!binary)
    throw new Error("Set OPENCODE_TEST_BINARY to an isolated @opencode/cli installation.");
  directory = await mkdtemp(
    join(process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? tmpdir(), "mobile-contract-"),
  );
  workspace = join(directory, "project");
  await mkdir(workspace);
  spawnSync("git", ["init", "--quiet", workspace]);
  provider = await startCompatibilityProvider();
  await writeFile(
    join(workspace, "opencode.json"),
    JSON.stringify({
      model: "fixture/fixture",
      permissions: [{ action: "mobile-contract", resource: "*", effect: "ask" }],
      providers: {
        fixture: {
          name: "Contract fixture",
          env: ["FIXTURE_API_KEY"],
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: provider.url },
          models: { fixture: { limit: { context: 32768, output: 1024 } } },
        },
      },
    }),
  );
  const port = await unusedPort();
  const password = randomBytes(24).toString("hex");
  // Whitelist the child's environment. Never discover the user's service or credentials.
  child = spawn(resolve(binary), ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: workspace,
    detached: true,
    stdio: "ignore",
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      TMPDIR: directory,
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_DATA_HOME: join(directory, "data"),
      XDG_STATE_HOME: join(directory, "state"),
      XDG_CACHE_HOME: join(directory, "cache"),
      OPENCODE_SERVER_PASSWORD: password,
      FIXTURE_API_KEY: "local-test-only",
    },
  });
  let spawnFailed = false;
  child.on("error", () => {
    spawnFailed = true;
  });
  client = createOpenCodeClient({
    baseUrl: `http://127.0.0.1:${port}`,
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    fetch: createBoundedOpenCodeFetch(createRedirectSafeOpenCodeFetch(fetch)),
  });
  await eventually(async () => {
    if (spawnFailed || child?.exitCode !== null) throw new Error("ISOLATED_SERVER_EXITED");
    try {
      const health = await client.health.get({ signal: AbortSignal.timeout(2_000) });
      serverVersion = health.version;
      return true;
    } catch {
      return false;
    }
  }, 60_000);
});

afterAll(async () => {
  if (client) {
    for (const sessionID of sessionIDs) {
      await removeOpenCodeSession(client, sessionID, { signal: AbortSignal.timeout(2_000) }).catch(
        () => undefined,
      );
    }
  }
  if (child?.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
    await Promise.race([new Promise((done) => child?.once("exit", done)), delay(2_000)]);
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* Already exited. */
    }
  }
  await provider?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("connects to the requested server release and reads scoped session snapshots", async () => {
  if (process.env.OPENCODE_TEST_VERSION)
    expect(serverVersion).toBe(process.env.OPENCODE_TEST_VERSION);
  expect((await client.health.get()).healthy).toBe(true);
  expect(Array.isArray((await client.server.get()).urls)).toBe(true);
  const location = await getOpenCodeLocation(client, { directory: workspace });
  expect(location.directory).toBe(workspace);
  const session = await createOpenCodeSession(
    client,
    { directory: workspace },
    { title: "Contract fixture" },
  );
  sessionIDs.push(session.id);
  expect(
    (await listOpenCodeSessions(client, { directory: workspace })).data.some(
      (item) => item.id === session.id,
    ),
  ).toBe(true);
  expect(Array.isArray(await listOpenCodeProjects(client))).toBe(true);
  await listActiveOpenCodeSessions(client);
});

test("admits a prompt, streams events, and reads a completed assistant transcript", async () => {
  const session = await createOpenCodeSession(client, { directory: workspace });
  sessionIDs.push(session.id);
  const controller = new AbortController();
  const seen = new Set<string>();
  const events = (async () => {
    for await (const event of client.event.subscribe({ signal: controller.signal }))
      seen.add(event.type);
  })();
  // Attach immediately so stream failures cannot become unhandled rejections.
  void events.catch(() => undefined);
  try {
    await eventually(async () => seen.has("server.connected"));
    const id = `msg_${randomBytes(12).toString("hex")}`;
    const admission = await promptOpenCodeSession(client, session.id, {
      id,
      text: "Compatibility probe",
      delivery: "queue",
    });
    expect(admission.id).toBe(id);
    await eventually(async () => {
      const messages = await listOpenCodeMessages(client, session.id);
      return messages.data.some(
        (message) =>
          message.type === "assistant" &&
          message.content.some(
            (part) => part.type === "text" && part.text.includes("Compatibility probe complete."),
          ),
      );
    });
    expect(provider?.requests()).toBeGreaterThan(0);
    await waitForOpenCodeSession(client, session.id, { signal: AbortSignal.timeout(10_000) });
    const completed = await listOpenCodeMessages(client, session.id);
    expect(
      completed.data.some((message) => message.type === "idle" && message.outcome === "succeeded"),
    ).toBe(true);
    const firstPage = await listOpenCodeMessages(client, session.id, { limit: 1, order: "asc" });
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.cursor.next).toBeTruthy();
    const secondPage = await listOpenCodeMessages(client, session.id, {
      cursor: firstPage.cursor.next as string,
      limit: 1,
    });
    expect(secondPage.data[0]?.id).not.toBe(firstPage.data[0]?.id);
    expect([...seen].some((type) => type.startsWith("session."))).toBe(true);
  } finally {
    controller.abort();
    await Promise.race([
      events.catch(() => undefined),
      delay(2_000).then(() => {
        throw new Error("STREAM_CANCELLATION_TIMEOUT");
      }),
    ]);
  }
});

test("lists and answers exact-location permissions and forms", async () => {
  const otherDirectory = join(workspace, "other");
  await mkdir(otherDirectory);
  const session = await createOpenCodeSession(client, { directory: workspace });
  sessionIDs.push(session.id);
  const request = await client.permission.create({
    sessionID: session.id,
    action: "mobile-contract",
    resources: ["fixture"],
  });
  expect(request.effect).toBe("ask");
  const pending = await listOpenCodePermissionRequests(client, { directory: workspace });
  expect(pending.data.some((item) => item.id === request.id)).toBe(true);
  expect(
    (await listOpenCodePermissionRequests(client, { directory: otherDirectory })).data,
  ).toHaveLength(0);
  await replyOpenCodePermissionRequest(client, session.id, request.id, "reject");
  expect(
    (await listOpenCodePermissionRequests(client, { directory: workspace })).data.some(
      (item) => item.id === request.id,
    ),
  ).toBe(false);
  const form = await client.form.create({
    sessionID: session.id,
    title: "Contract form",
    fields: [{ key: "answer", type: "string", required: true }],
  });
  expect(
    (await listOpenCodeFormRequests(client, { directory: workspace })).data.some(
      (item) => item.id === form.id,
    ),
  ).toBe(true);
  expect((await listOpenCodeFormRequests(client, { directory: otherDirectory })).data).toHaveLength(
    0,
  );
  await replyOpenCodeForm(client, session.id, form.id, { answer: "fixture" });
  expect((await getOpenCodeFormState(client, session.id, form.id)).status).toBe("answered");
});

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_TEST_PORT");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

async function eventually(check: () => Promise<boolean>, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error("CONTRACT_PROBE_TIMEOUT");
}
