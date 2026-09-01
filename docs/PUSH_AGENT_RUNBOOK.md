# Agent runbook: enable push on an OpenCode server

This runbook is for an internal user who already has the distributed OpenCode2
Mobile app installed on a physical phone. An agent running on the user's Linux
OpenCode server should follow it to install, configure, verify, or repair the
server-side notification components.

Invoke the agent with:

```text
Follow docs/PUSH_AGENT_RUNBOOK.md to enable push notifications for my OpenCode
server. Inspect the host before changing it, preserve existing state, and ask me
only for decisions or information you cannot discover safely.
```

Do the work on the server. Do not return only a list of commands for the user to
run. Stop for user input when this runbook identifies a user-owned decision.

## Scope

The server installation consists of:

```text
OpenCode V2 plugin
  -> authenticated HTTP on loopback
notification broker
  -> Expo Push Service
  -> the already-distributed mobile app
```

The server owner does not need an Expo account, EAS project, Firebase project,
APNs key, FCM key, `google-services.json`, or a new mobile build. The internal app
distributor owns those items. Do not ask the server owner to configure them.

The broker does not proxy normal OpenCode traffic. The phone continues to call
the user's OpenCode server directly. The broker sends text selected from a finite
category allowlist and an encrypted route that the installed app resolves after
unlock.

This repository currently does not publish the broker or plugin as standalone
packages. The server keeps a checkout and OpenCode loads the built plugin from
that checkout.

## Completion states

Finish in one of these states and name it in the final report:

- `complete`: host checks, phone pairing, broker test delivery, and one new
  permission, form, or successful session-completion notification pass.
- `awaiting-phone`: the host is ready, but the user still needs to pair or
  confirm notifications on the installed app.
- `blocked`: a specific user-owned network decision, incompatible OpenCode
  version, unsafe repair, or missing internal distribution requirement prevents
  further work.

Starting services is not completion. Verify every boundary available on the
host and identify the first boundary that remains unverified.

## Safety rules

- Never display or read the contents of `plugin.token`, `master.key`, the broker
  database, OpenCode credentials, pairing codes, or push tokens.
- Never put credentials in command arguments, configuration, URLs, logs, or the
  final report. The pairing CLI reads credentials from a TTY.
- Never rerun broker initialization when any broker config or state file exists.
- Never delete or replace `broker.sqlite3`, `master.key`, or `plugin.token` to
  repair ports or configuration. Existing phone registrations depend on them.
- Preserve unrelated OpenCode configuration and existing plugin entries.
- Keep plugin ingress on loopback. Never expose or proxy the plugin port.
- Ask before changing a public hostname, TLS or VPN routing, firewall policy,
  OpenCode authentication, or an existing service's port.
- Do not kill an unknown process that owns a desired port.
- Redact hostnames, addresses, usernames, paths, IDs, and server content from
  output that leaves the machine.

## Server requirements

- Linux with a user-level systemd session.
- OpenCode V2 running under the same account as the broker.
- OpenCode `0.0.0-beta-18387`, matching the plugin dependency and mobile API
  contract. The latest physical notification probe used beta 18286. If the
  installed server differs, report it and ask whether the internal deployment
  owner has approved that version before continuing.
- Node `26.7.0`, pnpm `11.21.0`, Git, and `fnm` or another way to run the pinned
  Node release.
- A phone-reachable broker origin. Prefer HTTPS. Private Tailscale or LAN HTTP is
  allowed only when the distributed app permits development HTTP and the user
  explicitly approves it.
- OpenCode and the broker in the same host and network namespace. The plugin
  intentionally refuses non-loopback broker ingress.

Default ports:

| Port | Scope | Purpose |
| --- | --- | --- |
| `4096` | Phone-reachable OpenCode listener | Mobile API and same-host pairing validation |
| `37100` | Phone-reachable broker listener | Health, pairing, and device commands |
| `37101` | `127.0.0.1` only | Authenticated plugin ingress |

The public broker can use another port or a reverse proxy. The plugin listener
must remain HTTP on loopback even when the public broker uses HTTPS.

## Agent workflow

### 1. Inspect before changing

Discover:

- The account and home directory that run OpenCode.
- The OpenCode version, service status, listener, authentication mode, and port.
- Whether an `opencode2-mobile` checkout already exists.
- Existing broker files, systemd unit, listeners, and applicable OpenCode
  configuration.
- Whether Tailscale, a reverse proxy, or an existing HTTPS hostname is available.

Useful non-secret checks:

```sh
id
opencode2 --version
opencode2 service status
ss -ltnp | grep -E ':(4096|37100|37101)\b'
systemctl --user status opencode-mobile-notifications.service
```

Broker files belong to the broker account:

```text
${XDG_CONFIG_HOME:-$HOME/.config}/opencode-mobile-notifications/config.json
${XDG_STATE_HOME:-$HOME/.local/state}/opencode-mobile-notifications/broker.sqlite3
${XDG_STATE_HOME:-$HOME/.local/state}/opencode-mobile-notifications/master.key
${XDG_STATE_HOME:-$HOME/.local/state}/opencode-mobile-notifications/plugin.token
```

Check for those paths by name and metadata only. Do not print secret file
contents.

OpenCode can merge global and project configuration. Inspect the applicable
`~/.config/opencode/opencode.json(c)`, then project `opencode.json(c)` and
`.opencode/opencode.json(c)` files from the OpenCode working directory to its
project root. Do not add a duplicate plugin entry at a different precedence.

Classify the host:

- `fresh`: no broker config, state, unit, or plugin entry exists.
- `existing`: broker state exists and the installation may already work.
- `repair`: state or configuration exists but a verification boundary fails.

A stopped service is not proof of a fresh installation.

### 2. Resolve the phone-reachable broker origin

Reuse an existing approved origin when possible. Ask the user to choose only if
the host does not already establish the intended route:

- Public or private HTTPS through Caddy, nginx, Tailscale Serve, or equivalent.
- Explicitly approved Tailscale or private-LAN HTTP.

The origin must be an origin root such as `https://push.example.test` or
`http://100.64.0.10:37100`. It cannot contain credentials, a path, query, or
fragment.

For the built-in OpenCode `PAIR SERVER + NOTIFICATIONS` flow, the broker must use
the same scheme and hostname as the OpenCode URL, broker port `37100`, and Basic
authentication. Use the broker CLI pairing flow for bearer auth, no auth, a
different hostname or scheme, or a custom broker public port.

Forward only the public broker listener. Never forward port `37101`.

### 3. Install the server source

If the correct checkout already exists, preserve and use it. Otherwise install
the internally approved revision. When the deployment owner has not supplied a
revision, use the repository containing this runbook and report the installed
commit:

```sh
git clone https://github.com/omnicus/opencode2-mobile.git \
  "$HOME/.local/share/opencode2-mobile"
cd "$HOME/.local/share/opencode2-mobile"
git rev-parse HEAD
fnm exec --using=26.7.0 pnpm install --frozen-lockfile
fnm exec --using=26.7.0 pnpm notifications:build
```

Do not switch or update an existing checkout with uncommitted changes. Confirm
these build outputs exist:

```text
packages/opencode-notification-plugin/dist/index.js
packages/opencode-notification-plugin/dist/tui.js
apps/notification-broker/dist/cli.js
```

### 4. Initialize a fresh broker

Skip this section unless the host was classified `fresh`. Inspect desired ports
before initialization.

For HTTPS terminated by a local reverse proxy:

```sh
fnm exec --using=26.7.0 pnpm notifications:broker -- init \
  --public-origin https://push.example.test \
  --listen-host 127.0.0.1 \
  --public-port 37100 \
  --plugin-port 37101 \
  --opencode-port 4096
```

For explicitly approved private HTTP, use the phone-reachable private address as
both `--public-origin` and `--listen-host`, and add `--allow-http`. Never use
Internet-facing HTTP.

Initialization prints the token file path. Record the path, not its contents.

### 5. Configure the OpenCode plugin

Prefer global OpenCode configuration so notifications work for every project on
this server. Use project configuration only when the user requests that scope.
Merge one entry into the existing `plugins` array:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/home/user/.local/share/opencode2-mobile/packages/opencode-notification-plugin/dist",
      "options": {
        "brokerOrigin": "http://127.0.0.1:37101",
        "tokenFile": "/home/user/.local/state/opencode-mobile-notifications/plugin.token"
      }
    }
  ]
}
```

Use absolute paths and the actual plugin port from broker config. Put the token
file path in OpenCode configuration, never its value.

Configure the TUI controls separately in `~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": [
    {
      "package": "/home/user/.local/share/opencode2-mobile/packages/opencode-notification-plugin/dist",
      "options": {
        "brokerOrigin": "http://127.0.0.1:37101",
        "tokenFile": "/home/user/.local/state/opencode-mobile-notifications/plugin.token"
      }
    }
  ]
}
```

The local source package directory has no root `index.js`. Configure the compiled
`dist` directory shown above; direct `.js` paths are rejected by current OpenCode
betas.

OpenCode and the broker must share a network namespace. If OpenCode is in a
container, co-locate the broker there. Do not weaken the plugin's loopback check
or publish plugin ingress from the container.

### 6. Install the broker service

Place the tracked service template at
`~/.config/systemd/user/opencode-mobile-notifications.service`. Set `ExecStart`
to the absolute Node executable and absolute built CLI path:

```sh
fnm exec --using=26.7.0 node -p 'process.execPath'
```

The resulting command has this shape:

```text
/absolute/path/to/node /home/user/.local/share/opencode2-mobile/apps/notification-broker/dist/cli.js serve
```

Then start the broker:

```sh
systemctl --user daemon-reload
systemctl --user enable --now opencode-mobile-notifications.service
systemctl --user status opencode-mobile-notifications.service
```

Ask an administrator to run `loginctl enable-linger USERNAME` only when the user
wants notifications while logged out.

Start the broker before restarting OpenCode:

```sh
opencode2 service restart
opencode2 service status
```

### 7. Verify the host

Check each boundary in order. Diagnose and repair the first failure before
testing later boundaries.

1. Confirm the broker public and loopback listeners and their process owner with
   `ss -ltnp`.
2. Request `GET /healthz` from the local public listener. Expect `{"ok":true}`.
3. Request `/healthz` through the phone-reachable broker origin. This checks DNS,
   TLS, proxy routing, and firewall access.
4. Run the broker `status` command. Confirm notifications are enabled.
5. In the OpenCode TUI, run `/notifications-status`. This proves the plugin
   loaded, read its token file, and reached authenticated loopback ingress.

Broker commands run from the checkout:

```sh
fnm exec --using=26.7.0 pnpm notifications:broker -- status
fnm exec --using=26.7.0 pnpm notifications:broker -- devices
```

If all five checks pass but no phone is paired, report `awaiting-phone` and
continue with the user-assisted step.

### 8. Pair the installed app

Pairing requires the user and phone. Do not display a pairing code until the user
is ready to scan it. Pairing codes expire after two minutes and are bearer
secrets. Never put one in chat, logs, screenshots, or the final report.

For the standard same-host Basic-auth setup, ask the user to open OpenCode's
built-in `/pair` dialog. In the installed app, the user opens Connections,
chooses `PAIR SERVER + NOTIFICATIONS`, and scans the QR.

For other setups, prepare the broker pairing command for a trusted interactive
terminal. The agent may run it only when its shell has a TTY and the user can
enter the credential directly without revealing it to the agent. Otherwise ask
the user to run this one command locally on the server:

```sh
fnm exec --using=26.7.0 pnpm notifications:broker -- pair \
  --name "Workstation" \
  --opencode-origin https://opencode.example.test \
  --auth bearer
```

Use `--auth none`, `--auth basic`, or `--auth bearer` to match OpenCode. Add
`--allow-http` only for an approved private HTTP OpenCode origin. The CLI prompts
for credentials without placing them in shell history.

After the user finishes pairing:

```sh
fnm exec --using=26.7.0 pnpm notifications:broker -- devices
fnm exec --using=26.7.0 pnpm notifications:broker -- test DEVICE_ID_PREFIX
```

Confirm one expected active device and ask the user to confirm the test push
while the app is backgrounded or the phone is locked. The app intentionally
suppresses visible notifications while it is in the foreground.

Finally, create a new disposable permission or form request, or complete a new
session execution successfully, and ask the user to confirm the sanitized
notification text. Requests and executions created before plugin startup do not
generate retroactive notifications.

## Repair and port diagnosis

Do not initialize again. Gather evidence first:

```sh
systemctl --user status opencode-mobile-notifications.service
journalctl --user -u opencode-mobile-notifications.service -n 100 --no-pager
ss -ltnp | grep -E ':(4096|37100|37101)\b'
opencode2 service status
```

Inspect broker `config.json` without reading adjacent secret files. Its values
must agree with actual listeners, reverse-proxy routing, plugin options, and the
pairing method:

```json
{
  "listenHost": "127.0.0.1",
  "openCodePairingPorts": [4096],
  "pluginPort": 37101,
  "publicOrigin": "https://push.example.test",
  "publicPort": 37100
}
```

To fix a port conflict or mismatch:

1. Identify the current port owner. Ask before moving an existing service.
2. Stop `opencode-mobile-notifications.service`.
3. Back up only `config.json` to a mode-`600` file in the private config
   directory.
4. Edit only `publicPort`, `pluginPort`, or `openCodePairingPorts` as required.
   Preserve `brokerID`, `publicOrigin`, `allowDevelopmentHttp`, and unrelated
   fields.
5. When `pluginPort` changes, update `options.brokerOrigin` in the effective
   OpenCode config. It must remain `http://127.0.0.1:PORT`.
6. When the OpenCode port changes, update `openCodePairingPorts` for the built-in
   pairing allowlist.
7. Restart the broker, inspect listeners and its journal, restart OpenCode, and
   repeat host verification from the first boundary.

A reverse proxy can expose `https://push.example.test` on port `443` while
forwarding to local port `37100`. In that case, changing the local public port
does not require changing `publicOrigin`. Ask before changing `publicOrigin`.
Existing phone pairings may need replacement when it changes.

### Common failures

| Symptom | Likely cause | Repair |
| --- | --- | --- |
| `BROKER_ALREADY_INITIALIZED` | State already exists | Stop. Inspect and repair the existing installation. |
| `BROKER_NOT_INITIALIZED` | Wrong account, `HOME`, XDG directories, or missing files | Compare service environment and file ownership. Restore missing state from backup rather than regenerating one file. |
| `INVALID_BROKER_CONFIG` | Invalid JSON, origin, host, or port | Stop the broker, back up config, and repair only invalid fields. HTTP also requires `allowDevelopmentHttp: true`. |
| `EADDRINUSE` | Another process owns a listener | Identify it with `ss`; ask which service should move; synchronize dependent config. |
| Service cannot find Node or modules | Relative or stale `ExecStart`, wrong Node, or unbuilt checkout | Rebuild with Node `26.7.0`, use absolute paths, reload systemd, and restart. |
| Local health works, phone-reachable health fails | DNS, TLS, firewall, proxy, or `listenHost` mismatch | Test from another device and repair the public route. Never proxy plugin ingress. |
| `/notifications-status` is missing | Plugin did not load, config precedence is wrong, or OpenCode was not restarted | Check the effective config, absolute package path, build output, and redacted OpenCode logs. |
| Plugin reports broker unavailable | Wrong plugin port, token path, account, permissions, or network namespace | Compare plugin options with broker config and co-locate both processes. |
| Built-in pairing fails while health passes | Scheme, hostname, port, or Basic auth does not meet its restrictions | Repair the OpenCode port allowlist or use broker CLI pairing. |
| Test push works, interaction push does not | Plugin event path failed or request predates plugin startup | Verify plugin status, restart OpenCode, and create a new request. |
| Device exists but receives no test | Delivery paused, fake mode, stale token, or internal app distribution credentials | Enable delivery and inspect service environment. If host checks pass, escalate APNs/FCM verification to the internal app distributor. |
| No foreground banner appears | Expected behavior | Retest with the app backgrounded or phone locked. |

## Final report

Report:

- `complete`, `awaiting-phone`, or `blocked`.
- The installed source commit and OpenCode version.
- Which configuration files changed.
- Active port numbers and whether each is loopback or phone-reachable.
- Pass or fail for local health, phone-reachable health, plugin status, pairing,
  broker test push, and a new interaction push.
- The first unverified boundary and the exact user-owned next step, if any.

Do not report origins, addresses, usernames, paths, device IDs, credentials,
pairing codes, push tokens, secret file contents, or unredacted logs.
