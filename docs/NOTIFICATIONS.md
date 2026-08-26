# Self-hosted push notifications

The self-hosted notification flow can pair one phone with an OpenCode V2
connection and send sanitized permission, form, and successful session-completion
alerts through Expo Push Service.

```text
OpenCode V2 plugin
  -> authenticated loopback broker endpoint
notification broker
  -> Expo Push Service
  -> APNs or FCM
OpenCode2 Mobile
  -> authoritative OpenCode REST fetch
```

The broker is not an OpenCode proxy and does not use the credential during
normal notification processing. Its local pairing CLI receives the credential
and stores it in an encrypted, short-lived bootstrap challenge so the phone can
save it to SecureStore. The built-in OpenCode `/pair` flow instead sends the
credential to the broker once for same-host validation before creating that
challenge. Consumed challenges remain encrypted for bounded idempotent pairing
retries and are then pruned. Expo, APNs, and FCM see text selected from a finite
category allowlist plus an encrypted routing envelope. They never receive raw
permission actions, resources, paths, prompts, form titles, session titles,
errors, or identifiers in the visible text. The phone unlocks first, decrypts
the route, selects the paired connection, and fetches the session from OpenCode
before navigating.

Permission categories use short phrases such as `Permission to run a command`,
`Permission to edit files`, or `Permission to search the web`. Unknown plugin
actions fall back to `Permission requested`. Forms use `OpenCode has a question
for you`. A `session.execution.succeeded` event uses `Session done`; idle, failed,
and interrupted events do not produce that notification.

## Requirements

- Node 26.7.0 and pnpm 11.21.0.
- A Linux host that runs OpenCode and the broker.
- A public HTTPS broker origin, or an explicitly approved LAN or Tailscale HTTP
  origin for private-network testing.
- A physical iOS or Android device with a signed preview or development build.
- APNs and FCM V1 credentials configured for the deployment's EAS project.

Each deployment supplies its own ignored `google-services.json` and uploads it
to EAS as a secret file environment variable. EAS push credentials store the
private FCM V1 sender key separately. See `docs/CONFIGURATION.md`.

Expo Go cannot test remote notifications. Use a signed native build with the
deployment's notification credentials and configuration.

## Build and initialize

From this repository:

```sh
fnm exec --using=26.7.0 pnpm install
fnm exec --using=26.7.0 pnpm notifications:build
fnm exec --using=26.7.0 pnpm notifications:broker -- init \
  --public-origin https://push.example.test \
  --listen-host 127.0.0.1 \
  --public-port 37100
```

Terminate TLS with Caddy, nginx, Tailscale Serve, or an equivalent reverse
proxy. Forward only the public listener. Never expose the loopback plugin port.

For private-network testing without TLS:

```sh
fnm exec --using=26.7.0 pnpm notifications:broker -- init \
  --public-origin http://100.64.0.10:37100 \
  --listen-host 100.64.0.10 \
  --public-port 37100 \
  --allow-http
```

## Configure the OpenCode plugin

Add the built local package to the OpenCode V2 plugin configuration. Replace the
repository and home paths with absolute paths for the Linux account running
OpenCode.

```json
{
  "plugins": [
    {
      "package": "/absolute/path/opencode2-mobile/packages/opencode-notification-plugin/dist/index.js",
      "options": {
        "brokerOrigin": "http://127.0.0.1:37101",
        "tokenFile": "/home/user/.local/state/opencode-mobile-notifications/plugin.token"
      }
    }
  ]
}
```

The package is pinned to `@opencode-ai/plugin@0.0.0-beta-18050`. It subscribes to
`permission.asked`, `permission.replied`, `form.created`, `form.replied`,
`form.cancelled`, and `session.execution.succeeded`. It converts permission
actions to a finite category before storing a sanitized retry queue in plugin
storage and posting it to the broker.

The V2 plugin context has no permission or form snapshot list operation. The
plugin cannot send retroactive notifications for requests created before plugin
installation, and a server crash before an event reaches plugin storage can lose
that notification. The app still reconciles authoritative state after every tap.

For controls in a locally installed OpenCode TUI, add the compiled TUI entry to
`~/.config/opencode/cli.json` with the same options:

```json
{
  "plugins": [
    {
      "package": "/absolute/path/opencode2-mobile/packages/opencode-notification-plugin/dist/tui.js",
      "options": {
        "brokerOrigin": "http://127.0.0.1:37101",
        "tokenFile": "/home/user/.local/state/opencode-mobile-notifications/plugin.token"
      }
    }
  ]
}
```

The local source package directory is not a valid server plugin entry in the
tested OpenCode beta. Configure the two compiled files explicitly, rebuild after
changes, restart the OpenCode service for server-plugin changes, and reopen the
TUI for TUI-plugin changes.

## Start and pair

Start the broker in one terminal:

```sh
fnm exec --using=26.7.0 pnpm notifications:broker -- serve
```

For a persistent user service, build the broker and copy the service template:

```sh
fnm exec --using=26.7.0 pnpm notifications:build
mkdir -p ~/.config/systemd/user
cp apps/notification-broker/opencode-mobile-notifications.service \
  ~/.config/systemd/user/
fnm exec --using=26.7.0 node -p 'process.execPath'
pwd
```

Edit the copied unit and replace both `/absolute/path` placeholders with the
printed Node executable and repository paths. Then load and start it:

```sh
systemctl --user daemon-reload
systemctl --user enable --now opencode-mobile-notifications.service
systemctl --user status opencode-mobile-notifications.service
```

If the broker must run while the account is logged out, an administrator must
also enable lingering with `loginctl enable-linger USERNAME`. Rebuild and restart
the service after broker code changes.

For the standard same-host installation, open OpenCode's built-in `/pair`
dialog and scan that QR from `PAIR SERVER + NOTIFICATIONS`. The automatic flow
uses the first non-loopback URL listed in the OpenCode code. It requires the
broker at the same scheme and hostname on port 37100. OpenCode port 4096 is
allowed by default; set `--opencode-port` during broker initialization for
another OpenCode port. A custom broker public port, a different broker hostname,
or a different scheme requires the broker CLI flow below. The app explicitly
asks for approval when those origins use HTTP.

The broker rate-limits requests, rejects redirects, cross-host targets, and
ports outside its allowlist, then verifies the QR's Basic credentials against
OpenCode. Validation failures return one generic error. A successful check
creates the existing encrypted two-minute notification challenge. The app
requires that challenge to name the same broker and OpenCode origins shown for
approval.

The OpenCode QR contains the real server password even though the dialog masks
the password text. Do not capture or share screenshots of it. Create the QR in a
trusted terminal and scan it immediately. The app clears a pasted code from the
input after parsing it.

`POST /v1/pair/opencode` is on the broker's public listener because the phone
must reach it. Anyone who can reach that route can submit candidate credentials
for the same-host, allowlisted OpenCode ports. Rate limiting and generic failures
reduce password probing but do not replace a strong OpenCode password. Limit
network access to the broker where practical. Behind a reverse proxy, requests
share the proxy socket address and therefore share the five-attempt-per-minute
source limit.

Use the broker CLI instead when OpenCode uses bearer authentication or a broker
hostname that differs from the OpenCode hostname.

Create a two-minute pairing code in another terminal:

```sh
fnm exec --using=26.7.0 pnpm notifications:broker -- pair \
  --name "Workstation" \
  --opencode-origin https://opencode.example.test \
  --auth bearer
```

Use `--auth none`, `--auth basic`, or `--auth bearer`. The CLI reads credentials
from the terminal without putting them in shell history. For approved HTTP
OpenCode origins, also pass `--allow-http`.

The QR and manual payload are two-minute bearer bootstrap secrets. Anyone who
captures one can race the intended phone and obtain the encrypted credential
bootstrap. Display it only in a trusted local terminal, scan it immediately, do
not send it through chat or logs, and verify the new device with `devices` after
pairing. Revoke any unexpected registration.

In OpenCode2 Mobile, open Connections, choose `PAIR SERVER + NOTIFICATIONS`, and scan the
QR code. The app requests notification permission, registers its Expo token,
decrypts and tests the exact OpenCode connection, then saves both the connection
and notification pairing.

Removing a paired connection also revokes its broker registration. If the broker
is unreachable, removal stops and keeps the local notification key so revocation
can be retried. A pairing interrupted after broker registration stores a separate
pending-revocation key in SecureStore and retries cleanup at app startup.

Useful broker commands:

```sh
fnm exec --using=26.7.0 pnpm notifications:broker -- devices
fnm exec --using=26.7.0 pnpm notifications:broker -- status
fnm exec --using=26.7.0 pnpm notifications:broker -- pause
fnm exec --using=26.7.0 pnpm notifications:broker -- enable
fnm exec --using=26.7.0 pnpm notifications:broker -- test DEVICE_ID_PREFIX
fnm exec --using=26.7.0 pnpm notifications:broker -- revoke DEVICE_ID_PREFIX
```

The broker owns one persisted delivery switch shared by OpenCode2 Mobile and the
OpenCode TUI plugin. The mobile Settings screen reads and changes it for the
selected paired connection. In the TUI, use `/notifications-status`,
`/notifications-pause`, or `/notifications-enable`, or run the matching command
from the command palette. Pausing discards pushes that have not yet been sent and
does not replay requests after notifications are enabled again. A push already
submitted to Expo, APNs, or FCM cannot be recalled.

OpenCode2 Mobile does not present a banner, notification-list entry, badge, or
sound when a push arrives while the app is in the foreground. Background and
locked-device presentation remains controlled by the operating system.

Set `OPENCODE_MOBILE_PUSH_MODE=fake` when starting the broker to exercise pairing,
event ingestion, encryption, and the durable outbox without calling Expo.

## Signed build

Generate native projects after changing notification configuration:

```sh
fnm exec --using=26.7.0 pnpm --filter @opencode2-mobile/mobile native:generate
```

Build the tested preview profile, or replace `preview` with `development` for a
development client:

```sh
cd apps/mobile
fnm exec --using=26.7.0 pnpm dlx eas-cli@22.4.0 build \
  --platform ios --profile preview
fnm exec --using=26.7.0 pnpm dlx eas-cli@22.4.0 build \
  --platform android --profile preview
```

Real delivery, cold-start routing, locked-device presentation, receipt handling,
and token rotation require physical-device verification on both platforms.
