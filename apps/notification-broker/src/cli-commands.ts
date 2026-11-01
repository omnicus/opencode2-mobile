import { randomBytes, randomUUID } from "node:crypto";
import {
  encodeNotificationPairingCode,
  type NotificationConnectionBootstrap,
} from "@opencode2-mobile/notification-protocol";
import qrcode from "qrcode-terminal";

import {
  ask,
  askSecret,
  hasFlag,
  numberOption,
  option,
  parseOriginRoot,
  requiredOption,
} from "./cli-input.js";
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

export function initialize(arguments_: string[]) {
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

export async function serve() {
  const paths = brokerPaths();
  const config = readBrokerConfig(paths);
  const masterKey = readMasterKey(paths);
  const pluginToken = readPluginToken(paths);
  const database = new BrokerDatabase(paths.database, masterKey);
  const worker = new ExpoPushWorker(database);
  worker.start();
  const servers = startBrokerServers(config, database, worker, pluginToken);
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

export async function pair(arguments_: string[]) {
  const paths = brokerPaths();
  const config = readBrokerConfig(paths);
  const masterKey = readMasterKey(paths);
  const name = requiredOption(arguments_, "--name");
  const baseUrl = requiredOption(arguments_, "--opencode-origin");
  const openCodeOrigin = parseOriginRoot(baseUrl);
  const authMode = option(arguments_, "--auth") ?? "none";
  const allowDevelopmentHttp = hasFlag(arguments_, "--allow-http");
  if (openCodeOrigin.protocol === "http:" && !allowDevelopmentHttp) {
    throw new Error("HTTP_REQUIRES_ALLOW_HTTP");
  }
  const auth = await askAuth(authMode);
  withDatabase(
    (database) => {
      const code = database.createPairing(
        {
          allowDevelopmentHttp,
          authMode: auth.mode,
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
    },
    paths,
    masterKey,
  );
}

async function askAuth(authMode: string): Promise<NotificationConnectionBootstrap["auth"]> {
  if (authMode === "basic") {
    const username = await ask("OpenCode username: ");
    const password = await askSecret("OpenCode password: ");
    return { mode: "basic", password, username };
  }
  if (authMode === "bearer") {
    return { mode: "bearer", token: await askSecret("OpenCode bearer token: ") };
  }
  if (authMode === "none") return { mode: "none" };
  throw new Error("INVALID_AUTH_MODE");
}

export function devices() {
  withDatabase((database) => {
    for (const row of database.listDevices()) {
      process.stdout.write(
        `${String(row.binding_id).slice(0, 8)}  ${String(row.name)}  ${String(row.platform)}  ${row.disabled_at_ms === null ? "active" : "disabled"}\n`,
      );
    }
  });
}

export function status() {
  withDatabase((database) => {
    process.stdout.write(
      `Mobile notifications: ${database.deliveryState().enabled ? "enabled" : "paused"}\n`,
    );
  });
}

export function setEnabled(enabled: boolean) {
  withDatabase((database) => {
    database.setDeliveryEnabled(enabled);
    process.stdout.write(`Mobile notifications ${enabled ? "enabled" : "paused"}.\n`);
  });
}

export function revoke(arguments_: string[]) {
  const bindingID = arguments_[0];
  if (!bindingID) throw new Error("BINDING_ID_REQUIRED");
  withDatabase((database) => database.revokeDevice(resolveBinding(database, bindingID)));
}

export function test(arguments_: string[]) {
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

function withDatabase(
  run: (database: BrokerDatabase) => void,
  paths = brokerPaths(),
  masterKey = readMasterKey(paths),
) {
  const database = new BrokerDatabase(paths.database, masterKey);
  try {
    run(database);
  } finally {
    database.close();
  }
}
