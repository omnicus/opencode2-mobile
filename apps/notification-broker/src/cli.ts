#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  encodeNotificationPairingCode,
  type NotificationConnectionBootstrap,
} from "@opencode2-mobile/notification-protocol";
import qrcode from "qrcode-terminal";

import {
  type BrokerConfig,
  brokerPaths,
  initializeBrokerFiles,
  readBrokerConfig,
  readMasterKey,
  readPluginToken,
} from "./config.js";
import { BrokerDatabase } from "./database.js";
import { ExpoPushWorker } from "./expo-push.js";
import { startBrokerServers } from "./server.js";

const cliArguments = process.argv.slice(2);
if (cliArguments[0] === "--") cliArguments.shift();
const [command, ...arguments_] = cliArguments;

try {
  if (command === "init") initialize(arguments_);
  else if (command === "serve") await serve();
  else if (command === "pair") await pair(arguments_);
  else if (command === "devices") devices();
  else if (command === "revoke") revoke(arguments_);
  else if (command === "test") test(arguments_);
  else usage(1);
} catch (error) {
  const code = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
  process.stderr.write(`opencode-mobile-notifications: ${code}\n`);
  process.exitCode = 1;
}

function initialize(arguments_: string[]) {
  const publicOrigin = requiredOption(arguments_, "--public-origin");
  const origin = parseOriginRoot(publicOrigin);
  const allowDevelopmentHttp = hasFlag(arguments_, "--allow-http");
  if (origin.protocol === "http:" && !allowDevelopmentHttp)
    throw new Error("HTTP_REQUIRES_ALLOW_HTTP");
  if (origin.protocol !== "http:" && origin.protocol !== "https:")
    throw new Error("INVALID_PUBLIC_ORIGIN");
  const config: BrokerConfig = {
    allowDevelopmentHttp,
    brokerID: randomUUID(),
    listenHost: option(arguments_, "--listen-host") ?? "127.0.0.1",
    openCodePairingPorts: [numberOption(arguments_, "--opencode-port", 4_096)],
    pluginPort: numberOption(arguments_, "--plugin-port", 37_101),
    publicOrigin: origin.origin,
    publicPort: numberOption(arguments_, "--public-port", Number(origin.port) || 37_100),
    v: 1,
  };
  const paths = brokerPaths();
  initializeBrokerFiles(config, randomBytes(32), randomBytes(32).toString("base64url"), paths);
  const database = new BrokerDatabase(paths.database, readMasterKey(paths));
  database.close();
  process.stdout.write(`Initialized ${paths.stateDirectory}\n`);
  process.stdout.write(`Plugin token file: ${paths.pluginToken}\n`);
}

async function serve() {
  const paths = brokerPaths();
  const config = readBrokerConfig(paths);
  const database = new BrokerDatabase(paths.database, readMasterKey(paths));
  const worker = new ExpoPushWorker(database);
  worker.start();
  const servers = startBrokerServers(config, database, worker, readPluginToken(paths));
  process.stdout.write(
    `Notification broker listening on ${config.listenHost}:${config.publicPort}; plugin ingress 127.0.0.1:${config.pluginPort}\n`,
  );
  if (process.env.OPENCODE_MOBILE_PUSH_MODE === "fake") {
    process.stdout.write("Push backend is fake; no notification will leave this process.\n");
  }
  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void servers.close().finally(() => {
        database.close();
        resolve();
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function pair(arguments_: string[]) {
  const paths = brokerPaths();
  const config = readBrokerConfig(paths);
  const database = new BrokerDatabase(paths.database, readMasterKey(paths));
  const name = requiredOption(arguments_, "--name");
  const baseUrl = requiredOption(arguments_, "--opencode-origin");
  const openCodeOrigin = parseOriginRoot(baseUrl);
  const authMode = option(arguments_, "--auth") ?? "none";
  const allowDevelopmentHttp = hasFlag(arguments_, "--allow-http");
  if (openCodeOrigin.protocol === "http:" && !allowDevelopmentHttp) {
    throw new Error("HTTP_REQUIRES_ALLOW_HTTP");
  }
  let auth: NotificationConnectionBootstrap["auth"];
  if (authMode === "basic") {
    const username = await ask("OpenCode username: ");
    const password = await askSecret("OpenCode password: ");
    auth = { mode: "basic", password, username };
  } else if (authMode === "bearer") {
    auth = { mode: "bearer", token: await askSecret("OpenCode bearer token: ") };
  } else if (authMode === "none") auth = { mode: "none" };
  else throw new Error("INVALID_AUTH_MODE");
  try {
    const code = database.createPairing(
      {
        allowDevelopmentHttp,
        authMode,
        brokerOrigin: config.publicOrigin,
        name,
        openCodeOrigin: openCodeOrigin.origin,
      },
      { allowDevelopmentHttp, auth, baseUrl: openCodeOrigin.origin, name, v: 1 },
    );
    const encoded = encodeNotificationPairingCode(code);
    process.stdout.write("Scan this code in OpenCode2 Mobile. It expires in two minutes.\n\n");
    qrcode.generate(encoded, { small: true });
    process.stdout.write(`\nManual pairing code:\n${encoded}\n`);
  } finally {
    database.close();
  }
}

function devices() {
  withDatabase((database) => {
    for (const row of database.listDevices()) {
      process.stdout.write(
        `${String(row.binding_id).slice(0, 8)}  ${String(row.name)}  ${String(row.platform)}  ${row.disabled_at_ms === null ? "active" : "disabled"}\n`,
      );
    }
  });
}

function revoke(arguments_: string[]) {
  const bindingID = arguments_[0];
  if (!bindingID) throw new Error("BINDING_ID_REQUIRED");
  withDatabase((database) => database.revokeDevice(resolveBinding(database, bindingID)));
}

function test(arguments_: string[]) {
  const bindingID = arguments_[0];
  if (!bindingID) throw new Error("BINDING_ID_REQUIRED");
  withDatabase((database) => database.enqueueTest(resolveBinding(database, bindingID)));
}

function resolveBinding(database: BrokerDatabase, input: string) {
  const matches = database
    .listDevices()
    .map((row) => String(row.binding_id))
    .filter((id) => id === input || id.startsWith(input));
  if (matches.length !== 1) throw new Error("DEVICE_NOT_FOUND_OR_AMBIGUOUS");
  return matches[0] as string;
}

function withDatabase(run: (database: BrokerDatabase) => void) {
  const paths = brokerPaths();
  const database = new BrokerDatabase(paths.database, readMasterKey(paths));
  try {
    run(database);
  } finally {
    database.close();
  }
}

async function ask(prompt: string) {
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    const value = (await reader.question(prompt)).trim();
    if (!value) throw new Error("VALUE_REQUIRED");
    return value;
  } finally {
    reader.close();
  }
}

async function askSecret(prompt: string) {
  if (!stdin.isTTY) throw new Error("SECRET_REQUIRES_TTY");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  const bytes: number[] = [];
  try {
    for await (const chunk of stdin) {
      for (const byte of Buffer.from(chunk)) {
        if (byte === 3) throw new Error("CANCELLED");
        if (byte === 13 || byte === 10) {
          stdout.write("\n");
          const value = Buffer.from(bytes).toString("utf8").trim();
          if (!value) throw new Error("VALUE_REQUIRED");
          return value;
        }
        if (byte === 127 || byte === 8) bytes.pop();
        else bytes.push(byte);
      }
    }
    throw new Error("SECRET_INPUT_ENDED");
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

function option(arguments_: string[], name: string) {
  const index = arguments_.indexOf(name);
  return index < 0 ? undefined : arguments_[index + 1];
}

function requiredOption(arguments_: string[], name: string) {
  const value = option(arguments_, name);
  if (!value) throw new Error(`${name.slice(2).toUpperCase().replaceAll("-", "_")}_REQUIRED`);
  return value;
}

function numberOption(arguments_: string[], name: string, fallback: number) {
  const value = option(arguments_, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error("INVALID_PORT");
  return parsed;
}

function hasFlag(arguments_: string[], name: string) {
  return arguments_.includes(name);
}

function parseOriginRoot(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("INVALID_ORIGIN");
  }
  return url;
}

function usage(exitCode: number): never {
  process.stderr.write(`Usage:
  opencode-mobile-notifications init --public-origin URL [--listen-host HOST] [--public-port PORT] [--plugin-port PORT] [--opencode-port PORT] [--allow-http]
  opencode-mobile-notifications serve
  opencode-mobile-notifications pair --name NAME --opencode-origin URL [--auth none|basic|bearer] [--allow-http]
  opencode-mobile-notifications devices
  opencode-mobile-notifications revoke BINDING_ID
  opencode-mobile-notifications test BINDING_ID
`);
  process.exit(exitCode);
}
