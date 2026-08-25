import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type BrokerConfig = {
  allowDevelopmentHttp: boolean;
  brokerID: string;
  listenHost: string;
  openCodePairingPorts: number[];
  pluginPort: number;
  publicOrigin: string;
  publicPort: number;
  v: 1;
};

export function brokerPaths(environment: NodeJS.ProcessEnv = process.env) {
  const configHome = environment.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const stateHome = environment.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const configDirectory = join(configHome, "opencode-mobile-notifications");
  const stateDirectory = join(stateHome, "opencode-mobile-notifications");
  return {
    config: join(configDirectory, "config.json"),
    configDirectory,
    database: join(stateDirectory, "broker.sqlite3"),
    masterKey: join(stateDirectory, "master.key"),
    pluginToken: join(stateDirectory, "plugin.token"),
    stateDirectory,
  };
}

export function initializeBrokerFiles(
  config: BrokerConfig,
  masterKey: Uint8Array,
  pluginToken: string,
  paths = brokerPaths(),
) {
  if (existsSync(paths.config) || existsSync(paths.masterKey) || existsSync(paths.pluginToken)) {
    throw new Error("BROKER_ALREADY_INITIALIZED");
  }
  mkdirPrivate(paths.configDirectory);
  mkdirPrivate(paths.stateDirectory);
  writePrivate(paths.config, `${JSON.stringify(config, null, 2)}\n`);
  writePrivate(paths.masterKey, Buffer.from(masterKey).toString("base64url"));
  writePrivate(paths.pluginToken, pluginToken);
}

export function readBrokerConfig(paths = brokerPaths()): BrokerConfig {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(paths.config, "utf8"));
  } catch {
    throw new Error("BROKER_NOT_INITIALIZED");
  }
  if (!isRecord(input) || input.v !== 1) throw new Error("INVALID_BROKER_CONFIG");
  const publicOrigin = parseOrigin(input.publicOrigin);
  const allowDevelopmentHttp = input.allowDevelopmentHttp === true;
  if (publicOrigin.startsWith("http:") && !allowDevelopmentHttp) {
    throw new Error("INVALID_BROKER_CONFIG");
  }
  return {
    allowDevelopmentHttp,
    brokerID: parseIdentifier(input.brokerID),
    listenHost: parseHost(input.listenHost),
    openCodePairingPorts: parsePorts(input.openCodePairingPorts),
    pluginPort: parsePort(input.pluginPort),
    publicOrigin,
    publicPort: parsePort(input.publicPort),
    v: 1,
  };
}

function parsePorts(value: unknown) {
  if (value === undefined) return [4_096];
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw new Error("INVALID_BROKER_CONFIG");
  }
  const ports = value.map(parsePort);
  if (new Set(ports).size !== ports.length) throw new Error("INVALID_BROKER_CONFIG");
  return ports;
}

export function readMasterKey(paths = brokerPaths()) {
  let key: Buffer;
  try {
    key = Buffer.from(readFileSync(paths.masterKey, "utf8").trim(), "base64url");
  } catch {
    throw new Error("BROKER_NOT_INITIALIZED");
  }
  if (key.byteLength !== 32) throw new Error("INVALID_BROKER_MASTER_KEY");
  return new Uint8Array(key);
}

export function readPluginToken(paths = brokerPaths()) {
  let value: string;
  try {
    value = readFileSync(paths.pluginToken, "utf8").trim();
  } catch {
    throw new Error("BROKER_NOT_INITIALIZED");
  }
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(value)) throw new Error("INVALID_PLUGIN_TOKEN");
  return value;
}

function mkdirPrivate(path: string) {
  mkdirSync(path, { mode: 0o700, recursive: true });
  chmodSync(path, 0o700);
}

function writePrivate(path: string, value: string) {
  mkdirPrivate(dirname(path));
  writeFileSync(path, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
}

function parseOrigin(value: unknown) {
  if (typeof value !== "string") throw new Error("INVALID_BROKER_CONFIG");
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("INVALID_BROKER_CONFIG");
  }
  return url.origin;
}

function parseIdentifier(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{10,128}$/.test(value)) {
    throw new Error("INVALID_BROKER_CONFIG");
  }
  return value;
}

function parseHost(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9.:-]{1,255}$/.test(value)) {
    throw new Error("INVALID_BROKER_CONFIG");
  }
  return value;
}

function parsePort(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error("INVALID_BROKER_CONFIG");
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
