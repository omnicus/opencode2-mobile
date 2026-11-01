import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeNotificationBytes,
  notificationBootstrapAdditionalData,
  openNotificationJson,
  parseNotificationPairingCode,
} from "@opencode2-mobile/notification-protocol";
import qrcode from "qrcode-terminal";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import {
  devices,
  initialize,
  pair,
  revoke,
  serve,
  setEnabled,
  status,
  test,
} from "./cli-commands.js";
import { ask, askSecret } from "./cli-input.js";
import { brokerPaths, readBrokerConfig, readMasterKey, readPluginToken } from "./config.js";
import { BrokerDatabase } from "./database.js";

vi.mock("qrcode-terminal", () => ({ default: { generate: vi.fn() } }));
vi.mock("./cli-input.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cli-input.js")>()),
  ask: vi.fn(),
  askSecret: vi.fn(),
}));

let root: string;
let stdout: MockInstance<typeof process.stdout.write>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "broker-cli-"));
  vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
  vi.stubEnv("XDG_STATE_HOME", join(root, "state"));
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.mocked(ask).mockReset();
  vi.mocked(askSecret).mockReset();
  vi.mocked(qrcode.generate).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { force: true, recursive: true });
});

describe("initialize", () => {
  it("writes a default HTTPS config and an empty database", () => {
    initialize(["--public-origin", "https://broker.test"]);

    const paths = brokerPaths();
    expect(readBrokerConfig(paths)).toEqual({
      allowDevelopmentHttp: false,
      brokerID: expect.stringMatching(/^[0-9a-f-]{36}$/),
      listenHost: "127.0.0.1",
      openCodePairingPorts: [4_096],
      pluginPort: 37_101,
      publicOrigin: "https://broker.test",
      publicPort: 37_100,
      v: 1,
    });
    expect(readMasterKey(paths)).toHaveLength(32);
    expect(readPluginToken(paths)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(existsSync(paths.database)).toBe(true);
    expect(output()).toBe(
      `Initialized ${paths.stateDirectory}\nPlugin token file: ${paths.pluginToken}\n`,
    );
  });

  it("applies listener options and the origin port", () => {
    initialize([
      "--public-origin",
      "http://broker.test:8080",
      "--allow-http",
      "--listen-host",
      "0.0.0.0",
      "--opencode-port",
      "4097",
      "--plugin-port",
      "9001",
    ]);

    expect(readBrokerConfig(brokerPaths())).toMatchObject({
      allowDevelopmentHttp: true,
      listenHost: "0.0.0.0",
      openCodePairingPorts: [4_097],
      pluginPort: 9_001,
      publicOrigin: "http://broker.test:8080",
      publicPort: 8_080,
    });
  });

  it("lets --public-port override the origin port", () => {
    initialize(["--public-origin", "https://broker.test:8443", "--public-port", "9443"]);

    expect(readBrokerConfig(brokerPaths()).publicPort).toBe(9_443);
  });

  it.each([
    [[], "PUBLIC_ORIGIN_REQUIRED"],
    [["--public-origin", "http://broker.test"], "HTTP_REQUIRES_ALLOW_HTTP"],
    [["--public-origin", "https://broker.test/path"], "INVALID_ORIGIN"],
    [["--public-origin", "https://broker.test", "--plugin-port", "0"], "INVALID_PORT"],
  ])("rejects %j with %s before writing files", (arguments_, message) => {
    expect(() => initialize(arguments_)).toThrow(message);
    expect(existsSync(brokerPaths().config)).toBe(false);
    expect(output()).toBe("");
  });

  it("refuses to initialize twice", () => {
    initialize(["--public-origin", "https://broker.test"]);
    const config = readBrokerConfig(brokerPaths());

    expect(() => initialize(["--public-origin", "https://other.test"])).toThrow(
      "BROKER_ALREADY_INITIALIZED",
    );
    expect(readBrokerConfig(brokerPaths())).toEqual(config);
  });
});

describe("pair", () => {
  beforeEach(() => {
    initialize(["--public-origin", "https://broker.test"]);
    stdout.mockClear();
  });

  it("prints a QR code and manual code for unauthenticated OpenCode", async () => {
    await pair(["--name", "Laptop", "--opencode-origin", "https://opencode.test"]);

    const encoded = vi.mocked(qrcode.generate).mock.calls[0]?.[0] as string;
    expect(qrcode.generate).toHaveBeenCalledWith(encoded, { small: true });
    expect(output()).toBe(
      `Scan this code in OpenCode2 Mobile. It expires in two minutes.\n\n\nManual pairing code:\n${encoded}\n`,
    );
    expect(parseNotificationPairingCode(encoded)).toMatchObject({
      allowDevelopmentHttp: false,
      authMode: "none",
      brokerOrigin: "https://broker.test",
      name: "Laptop",
      openCodeOrigin: "https://opencode.test",
    });
    expect(openBootstrap(encoded)).toEqual({
      allowDevelopmentHttp: false,
      auth: { mode: "none" },
      baseUrl: "https://opencode.test",
      name: "Laptop",
      v: 1,
    });
    expect(ask).not.toHaveBeenCalled();
    expect(askSecret).not.toHaveBeenCalled();
    expect(databaseIsOpen()).toBe(false);
  });

  it("asks for basic credentials without printing the password", async () => {
    vi.mocked(ask).mockResolvedValue("ada");
    vi.mocked(askSecret).mockResolvedValue("basic-password");

    await pair([
      "--name",
      "Laptop",
      "--opencode-origin",
      "http://opencode.test:4096",
      "--auth",
      "basic",
      "--allow-http",
    ]);

    expect(ask).toHaveBeenCalledWith("OpenCode username: ");
    expect(askSecret).toHaveBeenCalledWith("OpenCode password: ");
    const encoded = vi.mocked(qrcode.generate).mock.calls[0]?.[0] as string;
    expect(parseNotificationPairingCode(encoded)).toMatchObject({
      allowDevelopmentHttp: true,
      authMode: "basic",
      openCodeOrigin: "http://opencode.test:4096",
    });
    expect(openBootstrap(encoded)).toMatchObject({
      allowDevelopmentHttp: true,
      auth: { mode: "basic", password: "basic-password", username: "ada" },
      baseUrl: "http://opencode.test:4096",
    });
    expect(output()).not.toContain("basic-password");
    expect(encoded).not.toContain("basic-password");
  });

  it("asks for a bearer token without printing it", async () => {
    vi.mocked(askSecret).mockResolvedValue("bearer-token");

    await pair([
      "--name",
      "Laptop",
      "--opencode-origin",
      "https://opencode.test",
      "--auth",
      "bearer",
    ]);

    expect(ask).not.toHaveBeenCalled();
    expect(askSecret).toHaveBeenCalledWith("OpenCode bearer token: ");
    const encoded = vi.mocked(qrcode.generate).mock.calls[0]?.[0] as string;
    expect(openBootstrap(encoded)).toMatchObject({
      auth: { mode: "bearer", token: "bearer-token" },
    });
    expect(output()).not.toContain("bearer-token");
  });

  it.each([
    [["--opencode-origin", "https://opencode.test"], "NAME_REQUIRED"],
    [["--name", "Laptop"], "OPENCODE_ORIGIN_REQUIRED"],
    [["--name", "Laptop", "--opencode-origin", "https://opencode.test/path"], "INVALID_ORIGIN"],
    [["--name", "Laptop", "--opencode-origin", "http://opencode.test"], "HTTP_REQUIRES_ALLOW_HTTP"],
    [
      ["--name", "Laptop", "--opencode-origin", "https://opencode.test", "--auth", "token"],
      "INVALID_AUTH_MODE",
    ],
  ])("rejects %j with %s", async (arguments_, message) => {
    await expect(pair(arguments_)).rejects.toThrow(message);
    expect(qrcode.generate).not.toHaveBeenCalled();
    expect(output()).toBe("");
    expect(databaseIsOpen()).toBe(false);
  });

  it("does not open the database when the secret prompt fails", async () => {
    vi.mocked(askSecret).mockRejectedValue(new Error("SECRET_REQUIRES_TTY"));

    await expect(
      pair(["--name", "Laptop", "--opencode-origin", "https://opencode.test", "--auth", "bearer"]),
    ).rejects.toThrow("SECRET_REQUIRES_TTY");
    expect(qrcode.generate).not.toHaveBeenCalled();
    expect(databaseIsOpen()).toBe(false);
  });

  it("requires an initialized broker", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "missing"));

    await expect(
      pair(["--name", "Laptop", "--opencode-origin", "https://opencode.test"]),
    ).rejects.toThrow("BROKER_NOT_INITIALIZED");
  });
});

describe("serve", () => {
  it("rejects a missing plugin token without opening the database", async () => {
    vi.stubEnv("OPENCODE_MOBILE_PUSH_MODE", "fake");
    initialize(["--public-origin", "https://broker.test"]);
    stdout.mockClear();
    unlinkSync(brokerPaths().pluginToken);

    await expect(serve()).rejects.toThrow("BROKER_NOT_INITIALIZED");
    expect(output()).toBe("");
    expect(databaseIsOpen()).toBe(false);
  });
});

describe("device commands", () => {
  beforeEach(() => {
    initialize(["--public-origin", "https://broker.test"]);
    stdout.mockClear();
  });

  it("lists devices with their state", () => {
    addDevices(["abcdef12-first", "abcdef34-second"]);
    withDatabase((database) => database.revokeDevice("abcdef34-second"));

    devices();

    expect(output()).toBe(
      "abcdef12  Phone abcdef12-first  ios  active\nabcdef34  Phone abcdef34-second  ios  disabled\n",
    );
  });

  it("prints nothing without devices", () => {
    devices();

    expect(output()).toBe("");
  });

  it("pauses, reports, and enables delivery", () => {
    status();
    setEnabled(false);
    status();
    setEnabled(true);
    status();

    expect(output()).toBe(
      [
        "Mobile notifications: enabled",
        "Mobile notifications paused.",
        "Mobile notifications: paused",
        "Mobile notifications enabled.",
        "Mobile notifications: enabled",
        "",
      ].join("\n"),
    );
  });

  it("revokes a device by unique prefix", () => {
    addDevices(["abcdef12-first", "fedcba98-second"]);

    revoke(["abcdef"]);

    expect(withDatabase((database) => database.health().devices)).toBe(1);
    expect(
      withDatabase((database) =>
        database.listDevices().map((row) => [row.binding_id, row.disabled_reason]),
      ),
    ).toEqual([
      ["abcdef12-first", "revoked"],
      ["fedcba98-second", null],
    ]);
  });

  it("queues a test for an exact binding ID", () => {
    addDevices(["abcdef12", "fedcba98-second"]);
    const queued = withDatabase((database) => database.health().queued);

    test(["abcdef12"]);

    expect(withDatabase((database) => database.health().queued)).toBe(queued + 1);
  });

  it.each([
    ["revoke", revoke],
    ["test", test],
  ])("%s requires a binding ID", (_name, command) => {
    expect(() => command([])).toThrow("BINDING_ID_REQUIRED");
  });

  it.each([
    ["revoke", revoke],
    ["test", test],
  ])("%s rejects missing and ambiguous bindings", (_name, command) => {
    addDevices(["abcdef12-first", "abcdef34-second"]);

    expect(() => command(["missing"])).toThrow("DEVICE_NOT_FOUND_OR_AMBIGUOUS");
    expect(() => command(["abcdef"])).toThrow("DEVICE_NOT_FOUND_OR_AMBIGUOUS");
    expect(withDatabase((database) => database.health().devices)).toBe(2);
  });
});

function output() {
  return stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
}

function databaseIsOpen() {
  return existsSync(`${brokerPaths().database}-wal`);
}

function withDatabase<T>(run: (database: BrokerDatabase) => T) {
  const paths = brokerPaths();
  const database = new BrokerDatabase(paths.database, readMasterKey(paths));
  try {
    return run(database);
  } finally {
    database.close();
  }
}

function addDevices(bindingIDs: string[]) {
  withDatabase((database) => {
    for (const [index, bindingID] of bindingIDs.entries()) {
      const now = Date.now() + index;
      const code = database.createPairing(
        {
          allowDevelopmentHttp: false,
          authMode: "none",
          brokerOrigin: "https://broker.test",
          name: "Laptop",
          openCodeOrigin: "https://opencode.test",
        },
        {
          allowDevelopmentHttp: false,
          auth: { mode: "none" },
          baseUrl: "https://opencode.test",
          name: "Laptop",
          v: 1,
        },
        now,
      );
      database.completePairing(
        code.challengeID,
        {
          bindingID,
          deviceKey: Buffer.from(randomBytes(32)).toString("base64url"),
          deviceName: `Phone ${bindingID}`,
          expoPushToken: `ExponentPushToken[${bindingID}]`,
          platform: "ios",
          v: 1,
        },
        "broker-1",
        now,
      );
    }
  });
}

function openBootstrap(encoded: string) {
  const code = parseNotificationPairingCode(encoded);
  const result = withDatabase((database) =>
    database.completePairing(
      code.challengeID,
      {
        bindingID: "binding-bootstrap",
        deviceKey: Buffer.from(randomBytes(32)).toString("base64url"),
        deviceName: "Bootstrap phone",
        expoPushToken: "ExponentPushToken[bootstrap]",
        platform: "ios",
        v: 1,
      },
      "broker-1",
    ),
  );
  return openNotificationJson(
    decodeNotificationBytes(code.pairingSecret, 32),
    decodeNotificationBytes(result.bootstrapNonce, 24),
    result.bootstrapCiphertext,
    notificationBootstrapAdditionalData(code.challengeID),
  );
}
