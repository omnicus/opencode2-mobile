import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type BrokerConfig,
  brokerPaths,
  initializeBrokerFiles,
  readBrokerConfig,
  readMasterKey,
  readPluginToken,
} from "./config.js";

const pluginToken = "plugin-token-0123456789abcdefghijklmnopqrstuvwxyz";
const config: BrokerConfig = {
  allowDevelopmentHttp: false,
  brokerID: "broker-0123456789",
  listenHost: "127.0.0.1",
  openCodePairingPorts: [4_096],
  pluginPort: 37_101,
  publicOrigin: "https://broker.test",
  publicPort: 37_100,
  v: 1,
};

let root: string;
let paths: ReturnType<typeof brokerPaths>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "broker-config-"));
  paths = brokerPaths({
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_STATE_HOME: join(root, "state"),
  });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("brokerPaths", () => {
  it("places config and state under the XDG directories", () => {
    expect(paths).toEqual({
      config: join(root, "config", "opencode-mobile-notifications", "config.json"),
      configDirectory: join(root, "config", "opencode-mobile-notifications"),
      database: join(root, "state", "opencode-mobile-notifications", "broker.sqlite3"),
      masterKey: join(root, "state", "opencode-mobile-notifications", "master.key"),
      pluginToken: join(root, "state", "opencode-mobile-notifications", "plugin.token"),
      stateDirectory: join(root, "state", "opencode-mobile-notifications"),
    });
  });

  it("falls back to the home directory", () => {
    const fallback = brokerPaths({});

    expect(fallback.configDirectory).toBe(
      join(homedir(), ".config", "opencode-mobile-notifications"),
    );
    expect(fallback.stateDirectory).toBe(
      join(homedir(), ".local", "state", "opencode-mobile-notifications"),
    );
  });
});

describe("initializeBrokerFiles", () => {
  it("writes private config, key, and token files", () => {
    const masterKey = new Uint8Array(32).fill(7);

    initializeBrokerFiles(config, masterKey, pluginToken, paths);

    expect(statSync(paths.configDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(paths.stateDirectory).mode & 0o777).toBe(0o700);
    for (const path of [paths.config, paths.masterKey, paths.pluginToken]) {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(paths.config, "utf8")).toBe(`${JSON.stringify(config, null, 2)}\n`);
    expect(readBrokerConfig(paths)).toEqual(config);
    expect(readMasterKey(paths)).toEqual(masterKey);
    expect(readPluginToken(paths)).toBe(pluginToken);
  });

  it.each([
    ["config", "config"],
    ["masterKey", "state"],
    ["pluginToken", "state"],
  ] as const)("refuses to overwrite an existing %s file", (file, directory) => {
    mkdirSync(directory === "config" ? paths.configDirectory : paths.stateDirectory, {
      recursive: true,
    });
    writeFileSync(paths[file], "existing");

    expect(() => initializeBrokerFiles(config, new Uint8Array(32), pluginToken, paths)).toThrow(
      "BROKER_ALREADY_INITIALIZED",
    );
    expect(readFileSync(paths[file], "utf8")).toBe("existing");
  });
});

describe("readBrokerConfig", () => {
  it("requires an initialized config file", () => {
    expect(() => readBrokerConfig(paths)).toThrow("BROKER_NOT_INITIALIZED");
  });

  it("rejects malformed JSON as uninitialized", () => {
    writeConfigText("{");

    expect(() => readBrokerConfig(paths)).toThrow("BROKER_NOT_INITIALIZED");
  });

  it("defaults the OpenCode pairing ports", () => {
    writeConfig({ ...config, openCodePairingPorts: undefined });

    expect(readBrokerConfig(paths).openCodePairingPorts).toEqual([4_096]);
  });

  it("accepts HTTP only when development HTTP is allowed", () => {
    writeConfig({ ...config, allowDevelopmentHttp: true, publicOrigin: "http://broker.test:8080" });

    expect(readBrokerConfig(paths)).toMatchObject({
      allowDevelopmentHttp: true,
      publicOrigin: "http://broker.test:8080",
    });
  });

  it("normalizes the public origin", () => {
    writeConfig({ ...config, publicOrigin: "https://Broker.Test:443" });

    expect(readBrokerConfig(paths).publicOrigin).toBe("https://broker.test");
  });

  it("treats a non-true allowDevelopmentHttp as false", () => {
    writeConfig({ ...config, allowDevelopmentHttp: "yes" });

    expect(readBrokerConfig(paths).allowDevelopmentHttp).toBe(false);
  });

  it.each([
    ["an array", []],
    ["null", null],
    ["a string", "config"],
    ["a missing version", { ...config, v: undefined }],
    ["a future version", { ...config, v: 2 }],
    ["HTTP without allowDevelopmentHttp", { ...config, publicOrigin: "http://broker.test" }],
    ["a non-string origin", { ...config, publicOrigin: 1 }],
    ["a non-HTTP origin", { ...config, publicOrigin: "ftp://broker.test" }],
    ["an origin username", { ...config, publicOrigin: "https://user@broker.test" }],
    ["an origin password", { ...config, publicOrigin: "https://:secret@broker.test" }],
    ["an origin path", { ...config, publicOrigin: "https://broker.test/path" }],
    ["an origin query", { ...config, publicOrigin: "https://broker.test/?query" }],
    ["an origin hash", { ...config, publicOrigin: "https://broker.test/#hash" }],
    ["a short broker ID", { ...config, brokerID: "short" }],
    ["a non-string broker ID", { ...config, brokerID: 1_234_567_890 }],
    ["an invalid listen host", { ...config, listenHost: "127.0.0.1/24" }],
    ["a non-string listen host", { ...config, listenHost: 127 }],
    ["a zero plugin port", { ...config, pluginPort: 0 }],
    ["a large public port", { ...config, publicPort: 65_536 }],
    ["a fractional public port", { ...config, publicPort: 1.5 }],
    ["a string public port", { ...config, publicPort: "37100" }],
    ["non-array pairing ports", { ...config, openCodePairingPorts: 4_096 }],
    ["empty pairing ports", { ...config, openCodePairingPorts: [] }],
    [
      "too many pairing ports",
      { ...config, openCodePairingPorts: Array.from({ length: 17 }, (_, index) => index + 1) },
    ],
    ["duplicate pairing ports", { ...config, openCodePairingPorts: [4_096, 4_096] }],
    ["an invalid pairing port", { ...config, openCodePairingPorts: [4_096, 0] }],
  ])("rejects %s", (_label, value) => {
    writeConfig(value);

    expect(() => readBrokerConfig(paths)).toThrow("INVALID_BROKER_CONFIG");
  });

  it("accepts sixteen distinct pairing ports", () => {
    const ports = Array.from({ length: 16 }, (_, index) => 4_096 + index);
    writeConfig({ ...config, openCodePairingPorts: ports });

    expect(readBrokerConfig(paths).openCodePairingPorts).toEqual(ports);
  });

  it("rejects an unparseable origin", () => {
    writeConfig({ ...config, publicOrigin: "not a url" });

    expect(() => readBrokerConfig(paths)).toThrow(TypeError);
  });
});

describe("readMasterKey", () => {
  it("requires the key file", () => {
    expect(() => readMasterKey(paths)).toThrow("BROKER_NOT_INITIALIZED");
  });

  it("rejects a key that is not 32 bytes", () => {
    writeStateFile(paths.masterKey, Buffer.alloc(31).toString("base64url"));

    expect(() => readMasterKey(paths)).toThrow("INVALID_BROKER_MASTER_KEY");
  });

  it("decodes a trimmed base64url key", () => {
    const key = Buffer.alloc(32, 9);
    writeStateFile(paths.masterKey, `${key.toString("base64url")}\n`);

    expect(readMasterKey(paths)).toEqual(new Uint8Array(key));
  });
});

describe("readPluginToken", () => {
  it("requires the token file", () => {
    expect(() => readPluginToken(paths)).toThrow("BROKER_NOT_INITIALIZED");
  });

  it.each(["short-token", `${pluginToken}!`, "a".repeat(101)])("rejects %s", (token) => {
    writeStateFile(paths.pluginToken, token);

    expect(() => readPluginToken(paths)).toThrow("INVALID_PLUGIN_TOKEN");
  });

  it("returns the trimmed token", () => {
    writeStateFile(paths.pluginToken, `${pluginToken}\n`);

    expect(readPluginToken(paths)).toBe(pluginToken);
  });
});

function writeConfig(value: unknown) {
  writeConfigText(JSON.stringify(value));
}

function writeConfigText(value: string) {
  mkdirSync(paths.configDirectory, { recursive: true });
  writeFileSync(paths.config, value);
}

function writeStateFile(path: string, value: string) {
  mkdirSync(paths.stateDirectory, { recursive: true });
  writeFileSync(path, value);
}
