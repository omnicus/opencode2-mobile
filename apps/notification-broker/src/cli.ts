#!/usr/bin/env node

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

const cliArguments = process.argv.slice(2);
if (cliArguments[0] === "--") cliArguments.shift();
const [command, ...arguments_] = cliArguments;

try {
  if (command === "init") initialize(arguments_);
  else if (command === "serve") await serve();
  else if (command === "pair") await pair(arguments_);
  else if (command === "devices") devices();
  else if (command === "status") status();
  else if (command === "enable") setEnabled(true);
  else if (command === "pause") setEnabled(false);
  else if (command === "revoke") revoke(arguments_);
  else if (command === "test") test(arguments_);
  else usage(1);
} catch (error) {
  const code = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
  process.stderr.write(`opencode-mobile-notifications: ${code}\n`);
  process.exitCode = 1;
}

function usage(exitCode: number): never {
  process.stderr.write(`Usage:
  opencode-mobile-notifications init --public-origin URL [--listen-host HOST] [--public-port PORT] [--plugin-port PORT] [--opencode-port PORT] [--allow-http]
  opencode-mobile-notifications serve
  opencode-mobile-notifications pair --name NAME --opencode-origin URL [--auth none|basic|bearer] [--allow-http]
  opencode-mobile-notifications devices
  opencode-mobile-notifications status
  opencode-mobile-notifications enable
  opencode-mobile-notifications pause
  opencode-mobile-notifications revoke BINDING_ID
  opencode-mobile-notifications test BINDING_ID
`);
  process.exit(exitCode);
}
