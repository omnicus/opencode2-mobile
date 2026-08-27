# Compatibility results

This report records redacted physical-device and emulator probes. It contains no
server addresses, credentials, session titles, prompts, paths, or file content.

## Current verified baseline

As of 2026-08-25, signed test builds passed real-server text turns, transcript
paging, notification delivery, permission and form handling, and network
recovery on physical iOS and Android devices. The signed iOS build also passed
the fail-closed database backup-exclusion startup guard. Statements marked
pending in older dated entries describe the status at the time of that probe;
later entries supersede them.

## 2026-08-27: beta 18387 generated-client upgrade

### Stack

- OpenCode client, protocol, and schema: `0.0.0-beta-18387`
- OpenCode notification plugin: `0.0.0-beta-18387`
- Installed OpenCode CLI: `0.0.0-beta-18387`
- Shared service used for the catalog probe: `0.0.0-beta-18371`

### Results

| Probe | Result |
| --- | --- |
| Install matching client, protocol, schema, AI, and plugin packages | Pass |
| Compile the adapter, mobile app, and notification plugin against the generated types | Pass |
| List commands at the exact repository location | Pass |
| Receive built-in and configured command records with names and optional descriptions | Pass |
| Send command arguments as `text` and accept the generated client's `204` response | Pass in the deterministic fake API |
| Keep a lost command response behind an explicit duplicate-risk retry guard | Pass |
| Route beta 18387 step-streamed and message-content events to exact-session reconciliation | Pass |
| Decode the beta 18387 interrupt response | Pass in the deterministic fake API |
| Run all 292 mobile tests | Pass |
| Export iOS and Android Hermes bundles | Pass |
| Run Expo Doctor | Pass, 18/18 checks |

Beta 18387 removes command templates from `Command.Info`. The command endpoint
also replaces `arguments`, client message IDs, and inbox responses with `text`
and a `204` response. Prompt admission IDs remain stable and reconcilable.
Command delivery cannot be identified after a response is lost, so the app
refreshes server state, preserves the draft, and requires an explicit retry.
The catalog probe recorded no address, credential, identifier, path, prompt, or
server content.

## 2026-08-24: local beta 18050 interaction-scope probes

### Result

| Probe | Result |
| --- | --- |
| Create a temporary session permission whose policy effect is `ask` | Pass |
| Retrieve the request through the session-owned permission list | Pass |
| Retrieve the request through its exact location | Pass |
| Retrieve the request through another directory in the same project | Not returned |
| Find the blocked session in `/api/session/active` | Not returned |
| Reject the request and remove the temporary session | Pass |

The same controlled probe was repeated with a pending form:

| Probe | Result |
| --- | --- |
| Create a temporary session form | Pass |
| Retrieve the form and its pending state through the session endpoints | Pass |
| Retrieve the form through its exact location | Pass |
| Retrieve the form through another directory in the same project | Not returned |
| Find the form-blocked session in `/api/session/active` | Not returned |
| Cancel the form and remove the temporary session | Pass |

Permission and form reconciliation are exact-location scoped on the tested
server. A project root does not aggregate requests from another directory in
that project, and the connection-wide active-session snapshot cannot discover
every blocked session. A cross-project attention inbox must discover session
locations through project-scoped session metadata and show incomplete coverage
until those locations reconcile. The probes retained no request resources,
answers, paths, session IDs, permission IDs, or form IDs.

## 2026-08-23: physical iPhone REST probe

### Stack

- Mobile runtime: Expo Go with Expo SDK 54.0.37
- React Native: 0.81.5
- React: 19.1.0
- OpenCode client: `@opencode-ai/client@0.0.0-beta-17963`
- OpenCode server: `0.0.0-beta-17963`
- Network: Tailscale, using explicitly approved cleartext development HTTP
- Authentication: Basic credentials loaded by the connection form and stored in
  SecureStore after successful validation

### Results

| Probe | Result |
| --- | --- |
| Expo Go loads the application through Tailscale Metro | Pass |
| `GET /api/health` | Pass |
| `GET /api/server` | Pass |
| `GET /api/session?limit=1&order=desc` | Pass |
| Unauthorized server challenge before credentials | Pass |
| Generated Promise client bundles without Node service imports | Pass |

### Not yet tested

- Oversized SSE events and JSON responses
- iOS Simulator, Android Emulator, and physical Android behavior

## 2026-08-23: physical iPhone global fetch SSE probe

### Result

Fail. The authenticated request reached `/api/event`, received HTTP 200, and
remained open until the probe aborted it after 10 seconds. No event reached
JavaScript.

React Native 0.81 implements global `fetch` with `whatwg-fetch`, which does not
expose an infinite response body incrementally. The generated OpenCode client
supports a custom fetch function, so the mobile app now supplies `expo/fetch`.
Expo documents streamed response bodies as supported by this implementation.
The first replacement-transport run reached the server, received HTTP 200, and
closed within 111 ms after the probe initiated cancellation. Expo reports that
native cancellation as a platform network error rather than a DOM `AbortError`.
The probe now treats read termination as successful cancellation when its own
signal is already aborted. Regular REST calls continue using React Native's
global fetch; only event streaming uses `expo/fetch`.

### Replacement transport result

| Probe | Result |
| --- | --- |
| Receive initial `server.connected` event through generated async iterable | Pass |
| Stop the pending stream read with `AbortSignal` | Pass |
| Complete cancellation within three seconds | Pass |

This confirms generated-client event streaming and cancellation on a physical
iPhone running Expo Go and Hermes. Event payloads were neither displayed nor
persisted; the diagnostic retained only the event type.

## 2026-08-23: physical iPhone PTY probe

### Result

| Probe | Result |
| --- | --- |
| Resolve and use an explicit server location | Pass |
| Create a temporary PTY through the generated client | Pass |
| Mint a single-use PTY connect ticket | Pass |
| Open the ticketed WebSocket through Tailscale | Pass |
| Send and receive the probe marker | Pass |
| Close the socket and remove the temporary PTY | Pass |

This confirms the PTY REST and WebSocket flow on a physical iPhone running Expo
Go and Hermes. The probe retained no terminal output or ticket. It allowed at
most 64 KiB of output while waiting for the marker.

## 2026-08-23: physical iPhone lifecycle probe

### Result

| Probe | Result |
| --- | --- |
| Hold an event stream open before backgrounding | Pass |
| Observe the app entering the background | Pass |
| Cancel the old stream within three seconds | Pass |
| Check server health after returning to the foreground | Pass |
| Receive `server.connected` from a fresh event generation | Pass |

This confirms foreground recovery transport on a physical iPhone running Expo
Go and Hermes. The probe ignored transient `inactive` states and retained only
event types and pass or failure state. It did not claim or test full durable
session reconciliation.

## 2026-08-23: physical iPhone connection-profile flow

### Result

| Probe | Result |
| --- | --- |
| Create and test a connection draft before persistence | Pass |
| Save non-secret profile metadata in SQLite | Pass |
| Reload and reuse credentials from SecureStore | Pass |
| Edit and select saved profiles | Pass |
| Confirm and remove a profile | Pass |
| Keep the removed profile absent after reload | Pass |

This confirms the connection-profile flow in Expo Go on a physical iPhone. The
report retains no profile names, server addresses, credential references, or
credentials.

## 2026-08-23: physical iPhone app-lock flow

### Result

| Probe | Result |
| --- | --- |
| Enable device authentication after a system prompt | Pass |
| Lock after leaving the foreground | Pass |
| Authenticate and reveal saved connections | Pass |
| Retain the enabled preference after reload | Pass |

This confirms the optional app lock in Expo Go on a physical iPhone. The report
does not retain the authentication method or any platform authentication data.

## 2026-08-24: physical iPhone event-stability regression

### Result

| Probe | Result |
| --- | --- |
| Render diagnostic timestamps in device-local time with an explicit offset | Pass |
| Receive plugin, integration, MCP, catalog, agent, command, skill, and reference events | Pass |
| Remain connected throughout the server startup event burst | Pass |
| Avoid starting new stream generations for advisory registration events | Pass |
| Connect through behavioral probes after updating the server and generated client to beta 18050 | Pass |
| Switch rapidly between two saved profiles and back without stale state crossing profiles | Pass |
| Apply bounded reconnect backoff while the server is unavailable | Pass |
| Show bounded cached project and active-session counts during a cold server outage | Pass |
| Recover through a fresh event generation after the server returns | Pass |
| Aggregate repeated event types without displacing transport status history | Pass |

The bounded diagnostic contained event types and transport state only. It
contained no server address, credential, project path, prompt, session content,
or event payload.

## 2026-08-24: physical iPhone native-shell flow

### Result

| Probe | Result |
| --- | --- |
| Navigate the phone workspace, pending-work, settings, and connection-management shell | Pass |
| Recover the shell and freshness indicator after an OpenCode service restart | Pass |
| Preserve correct shell behavior through background and foreground transitions | Pass |
| Keep the connection form usable through portrait, landscape, and keyboard appearance | Pass |
| Unlock after native authentication temporarily moves the app through `inactive` | Pass |
| Large-text layout | Skipped |
| Reduced-motion navigation | Skipped |

The shell test used Expo Go on a physical iPhone. Android and tablet behavior
remain unverified. The pending-work destination intentionally reports unavailable
state until a server-resolved location enables authoritative interaction queries.

## 2026-08-24: milestone 6 contract and lifecycle probe

### Stack

- OpenCode client: `@opencode-ai/client@0.0.0-beta-18050`
- OpenCode server: `0.0.0-beta-18050`
- Runtime: local OpenCode CLI and background service on Linux

### Results

| Probe | Result |
| --- | --- |
| Resolve the default server location and current project | Pass |
| Load location-scoped agent and model choices | Pass |
| Confirm `cursor.next` returns older sessions for descending lists | Pass |
| Create a temporary session at the resolved location | Pass |
| Rename and reload the temporary session | Pass |
| Remove the temporary session and confirm it is absent from search | Pass |
| Deterministic empty, 120-session, paginated, searched, and concurrently changed lists | Pass |
| Abort obsolete location reads after selection changes | Pass |

The probe printed only booleans, counts, and response key names. It did not print
or retain a server address, project path, session ID, title, credential, prompt,
or content. This verifies the V2 contract and server lifecycle from the local
development environment. It does not satisfy physical iOS or Android milestone 6
verification.

## 2026-08-24: milestone 7 transcript contract slice

### Stack

- OpenCode client: `@opencode-ai/client@0.0.0-beta-18050`
- Published V2 OpenAPI: experimental version `0.0.1`
- Runtime: React Native Hermes export for iOS and Android

### Results

| Probe | Result |
| --- | --- |
| Confirm npm `@beta`, published OpenAPI, and installed generated client agree | Pass |
| Load newest-first message pages and follow `cursor.next` toward older messages | Pass |
| Omit `order` from cursor requests and preserve the original order | Pass |
| Validate every current message variant and all four assistant tool states | Pass |
| Reject malformed and unknown projected message shapes with a redacted error | Pass |
| Keep inline attachment data and file URIs out of rendered transcript rows | Pass |
| Strip ANSI controls and bound progressively revealed text and tool output | Pass |
| Coalesce text, reasoning, and tool event projection to one cache write per frame | Pass |
| Replace volatile fragments with terminal event values and refetch projection gaps | Pass |
| Restrict event projection by connection, location, session, and cache order | Pass |
| Build iOS and Android Hermes exports with the virtualized transcript | Pass |

These are deterministic fake-API and export checks. A real-server message cursor
probe, physical-device scroll anchoring, and streaming render measurements remain
pending. The query bridge now reduces beta 18050 text, reasoning, tool, retry, and
step events in arrival order with one write per matching transcript cache per
display frame. Terminal fragment events replace volatile accumulated values.
Execution completion, reconnect, foreground restoration, malformed payloads, and
missing projection prerequisites still refetch authoritative REST state for the
affected session.

The transcript now uses a deterministic live-follow latch. Rendered tests verify
that content growth pins the inverted list at offset zero while following, user
scrolling disables that pin through momentum, programmatic compensation does not
disable it, and the explicit latest control re-enables it. Physical iPhone tests
passed normal streaming, pause and re-entry, older-page anchoring, foreground
recovery, rotation, child-session loading, and service restart recovery. An
intermittent latest-button failure, slow `VirtualizedList` warnings, inconsistent
large-text scaling, and generic subagent presentation remain unresolved.

## 2026-08-24: transcript remediation and physical retest

| Probe | Deterministic result |
| --- | --- |
| Reflow shell, transcript controls, disclosures, and sheets after a live font-scale change | Pass |
| Keep `Latest` visible until native scrolling confirms the live edge | Pass |
| Skip unchanged transcript rows while a different row streams | Pass |
| Render V2 task and subagent tools as dedicated cards | Pass |
| Suppress current task wrappers and legacy task metadata from assistant text | Pass |
| Open a validated child session from a subagent card | Pass |
| Count currently running background subagents from projected V2 state | Pass |
| Reflow workspace and transcript lists after a live iOS text-size change | Pass |
| Keep accessibility-sized navigation labels on one scrollable line | Pass |
| Keep the accessibility-sized `Latest` control out of transcript content | Pass |

These checks use generated beta 18050 message types and the current published V2
OpenAPI contract. React Native 0.81's `VirtualizedList` warning is triggered by
two scroll-event gaps over 500 ms when content exceeds five viewports; it does
not measure component render duration. The app still removes the demonstrated
render churn by memoizing rows whose generated message objects are unchanged.
The physical iPhone retest changed to the second-largest accessibility text size
without restarting the app. Targeted list remounts cleared stale virtualized cell
measurements, the bottom navigation remained usable, and `Latest` occupied layout
space instead of covering the transcript. A follow-up constrained the horizontal
navigation scroller to its content height after a screenshot exposed vertical
expansion; the physical reload confirmed the navigation was compact again. The
result is acceptable for the foundation milestone. Finer large-text density work
remains a later follow-up.

The in-app redacted support report now includes numeric transcript measurements:
projection frames, events, cache writes, reconciliation count, maximum reduction
duration, committed row frames, loaded page/message peaks, follow corrections,
and explicit latest jumps. It does not read or retain message strings and marks
the exported block with `content_included=false`. Deterministic tests verify
frame aggregation and report formatting.

## 2026-08-24: physical iPhone transcript streaming baseline

| Measurement | Observed |
| --- | ---: |
| Projection events | 192 |
| Projection frames | 78 |
| Transcript cache writes | 14 |
| Projection reconciliations | 0 |
| Maximum events in one projection frame | 14 |
| Maximum projection duration | 12.980 ms |
| Committed transcript rows | 49 |
| Row-commit frames | 16 |
| Maximum row commits in one display frame | 12 |
| Maximum resident pages | 1 |
| Maximum resident messages | 41 |
| Live-follow corrections | 11 |
| Explicit latest jumps | 3 |

The probe kept a 41-message transcript visible while a controlled tool emitted
output for 30 seconds. The tester scrolled away from the live edge and returned
with `Latest`; the app remained responsive. Frame coalescing reduced 192 events
to 14 transcript cache writes, and no projection gap required reconciliation.
The maximum measured projection duration stayed below one 60 Hz frame interval.

This is an iPhone baseline, not a final device budget. The report records the
bounded resident page and message counts, not process memory in bytes. The spec
requires an older iPhone and a lower-midrange Android device before setting final
performance budgets and minimum supported devices.

## 2026-08-24: physical iPhone session-list stability

| Probe | Result |
| --- | --- |
| Keep the session list fixed during volatile usage and transcript updates | Pass |
| Reserve pull-to-refresh chrome for an explicit user refresh | Pass |
| Keep the project/location control stable during file-change events | Pass |
| Reorder the updated session once at completion without moving the list header | Pass |

The original implementation invalidated the session list for volatile usage,
showed the native pull indicator for background query work, and invalidated the
whole connection for file-change hints. On the physical iPhone this caused
repeated list movement and a blinking project/location control while a desktop
agent worked. The query bridge now ignores those volatile hints, execution
completion remains the authoritative session-list reconciliation point, and the
session list no longer applies visible-position compensation when rows reorder.

## 2026-08-24: milestone 8 composer contract slice

### Stack

- OpenCode client: `@opencode-ai/client@0.0.0-beta-18050`
- Published V2 OpenAPI: experimental version `0.0.1`
- Runtime: React Native Hermes export for iOS and Android

### Results

| Probe | Result |
| --- | --- |
| Forward generated prompt, inbox, agent, model, interrupt, background, and wait operations | Pass |
| Generate one caller-owned `msg_` ID before prompt transmission | Pass |
| Block same-frame duplicate taps | Pass |
| Keep a lost or conflicting response in unknown-delivery state | Pass |
| Reconcile unknown delivery through inbox and single-message REST reads | Pass |
| Keep resend blocked when one inbox/message snapshot does not contain an unknown ID | Pass |
| Require an explicit duplicate-risk acknowledgement before retrying an absent ID | Pass |
| Persist unresolved admission IDs before transmission and restore them after restart | Pass |
| Persist the encrypted submitted revision before admission metadata and HTTP | Pass |
| Preserve a newer draft when an earlier admission is confirmed | Pass |
| Keep all mutations from pausing into an automatic reconnect outbox | Pass |
| Keep the editor read-only until its encrypted draft revision loads | Pass |
| Keep pending admission state scoped when the visible session changes | Pass |
| Require an explicit queue or steer choice during active execution | Pass |
| Reconcile queued work after reconnect and replace overlays by projected message ID | Pass |
| Encrypt drafts with XChaCha20-Poly1305 and connection/session additional data | Pass |
| Keep draft keys in device-only SecureStore and remove drafts with connection profiles | Pass |
| Enumerate and clear the full paginated child tree when deleting a session | Pass |
| Generate an iOS startup guard that excludes the Expo SQLite directory from backups | Pass |
| Build iOS and Android Hermes exports | Pass |

These checks use generated beta 18050 types. The app serializes the encrypted
submitted draft, content-free unresolved admission row, and HTTP request in that
order. Draft revisions survive restart without exposing prompt text. Tests do not
record IDs, prompt text, server addresses, paths, or credentials. Android backups
remain disabled at the application level. The iOS plugin creates
`Documents/SQLite`, applies the backup-exclusion resource value before JavaScript
starts, and stops startup if that security operation fails.

One physical iPhone text turn streamed assistant text and shell state, but it
also exposed two UI failures: the focused composer placed Send below the
keyboard, and a permission request shown by the terminal was not visible in the
open mobile session. A second check confirmed that keeping Send in the editor
row made it reachable, but the built-in keyboard avoidance still expanded the
composer into the iOS suggestion bar. Expo SDK 54's bundled keyboard controller
then reproduced an upstream iOS/New Architecture bug where a sticky view can
retain the wrong position after a keyboard cycle. The composer keeps the
measured floating layout, but now derives its position independently from every
native keyboard frame so no animated keyboard height survives between openings.

Permission events update the location cache immediately before REST
reconciliation, and permission requests can be answered from the open session
or global Pending screen. These fixes still need another physical iPhone
retest, and Android text-turn testing remains pending.

## 2026-08-25: physical iPhone self-hosted push probe

### Stack

- Mobile runtime: signed EAS test build on a physical iPhone using Hermes
- Expo SDK: 54.0.37
- React Native: 0.81.5
- OpenCode plugin and client: beta 18050
- Network: explicitly approved private-network development HTTP
- Delivery: self-hosted Linux broker, Expo Push Service, and APNs

### Results

| Probe | Result |
| --- | --- |
| Enable the Apple Push Notifications capability and regenerate the Ad Hoc profile | Pass |
| Pair through a two-minute encrypted QR bootstrap | Pass |
| Store one active iPhone registration in the broker | Pass |
| Receive the automatic post-pairing test notification | Pass |
| Receive a plugin-projected permission notification while locked | Pass |
| Unlock and route a warm notification tap to the owning session | Pass |
| Receive a permission notification while the app is terminated | Pass |
| Cold-start from the notification tap and route to the owning session | Pass |

The first signed build exposed a Hermes compatibility bug before network I/O:
React Native's `abort-controller` implementation does not provide the static
`AbortSignal.timeout()` method. Notification device requests now use an
`AbortController` with a bounded timer, backed by a regression test that removes
the static method. The successful probe recorded no address, credential, push
token, pairing secret, session identifier, request identifier, prompt, or server
content.

Receipt completion, duplicate-envelope handling, revocation, re-pairing, and
form cold-start routing subsequently passed on the same physical iPhone. A
genuinely changed provider token was not forced; the normal registration refresh
path passed with the existing token.

Expo Go does not run the custom iOS backup plugin. The signed preview launched
with the fail-closed startup guard, confirming that the native exclusion call
completed; independent backup extraction remains pending.
Hardware-keyboard shortcuts are also pending because React Native's
cross-platform `TextInput` key event omits modifier state.

## 2026-08-25: Android FCM V1 configuration

The Android test build receives its ignored Firebase client configuration from
an EAS file environment variable. EAS stores the FCM sending credential
separately. No private service-account key is stored in the repository. Physical
Android token registration and delivery were verified with the signed
FCM-enabled build below.

## 2026-08-25: physical Android notification probe

### Stack

- Mobile runtime: signed EAS test build on a physical Android device using Hermes
- Expo SDK: 54.0.37
- React Native: 0.81.5
- OpenCode plugin and client: beta 18050
- Network: explicitly approved private-network development HTTP
- Delivery: self-hosted Linux broker, Expo Push Service, and FCM V1

### Results

| Probe | Result |
| --- | --- |
| Pair through the encrypted two-minute QR bootstrap | Pass |
| Register one active Android device and receive the automatic FCM notification | Pass |
| Force-close, reopen, reload the paired connection, and list sessions | Pass |
| Complete and reopen one streaming text turn with the composer above the keyboard | Pass |
| Present and answer a one-time external-directory permission | Pass |
| Receive a form notification while locked with the app terminated | Pass |
| Cold-start from the notification and route to the pending form | Pass |
| Recover after airplane-mode network loss and complete one non-duplicated turn | Pass |
| Load at least three older pages in a large transcript and return with `Latest` | Pass |
| Resolve all outstanding Android Expo tickets through successful receipts | Pass |
| Restart the broker process, retain registration, and deliver another test push | Pass |

The probe recorded no address, credential, token, pairing code, identifier,
prompt, path, or server content. A full host reboot, forced provider-token
rotation, Android revocation/re-pairing, and device-log review remain open. The
device-log review could not run because Android platform tools were unavailable
on the test host.

## 2026-08-26: physical iPhone notification controls probe

### Stack

- Mobile runtime: signed EAS preview build with an iOS EAS Update using Hermes
- Expo SDK: 54.0.37
- React Native: 0.81.5
- OpenCode server: beta 18286
- OpenCode plugin and mobile client contract: beta 18050
- Delivery: self-hosted Linux broker, Expo Push Service, and APNs

### Results

| Probe | Result |
| --- | --- |
| Deliver banner, sound, and notification-list entry while app is backgrounded | Pass |
| Wake the locked screen, present the notification, and play sound | Pass |
| Suppress banner, sound, badge, and notification-list entry while app is foregrounded | Pass |
| Pause from mobile and observe the broker state | Pass |
| Suppress delivery while paused and avoid replay after enabling | Pass |
| Enable delivery and receive a new post-resume notification | Pass |
| Load TUI status, pause, and enable commands from the command palette and slash completion | Pass |
| Reflect TUI changes after reopening mobile Settings | Pass |
| Preserve paused state and suppression across a broker restart | Pass |
| Route and settle a real permission in mobile and the TUI | Pass |
| Cold-start from a permission notification and route to the owning session | Pass |
| Route a global form at an exact non-followed location and submit it | Pass after fix |

The first global-form probe opened Pending but showed zero requests. The
notification location had been combined with ordinary event locations and then
filtered out because its project was not followed. Notification-owned locations
now remain explicit, while ordinary event locations retain the followed-project
filter. A focused provider regression test failed before the change and passed
after it. The corrected preview update then passed on the same physical iPhone.

The tested OpenCode beta did not resolve the local package directory as a server
plugin, and registering a keymap layer directly during TUI plugin setup failed
before the keymap provider mounted. The tested configuration loads the compiled
server and TUI files separately. The TUI commands register from a provider-backed
slot component.

The probe recorded no address, credential, token, pairing code, identifier,
prompt, path, form response, or server content.

## 2026-08-26: physical iPhone command-event stability

### Stack

- Mobile runtime: signed EAS preview build with an iOS EAS Update using Hermes
- Expo SDK: 54.0.37
- React Native: 0.81.5
- OpenCode server: beta 18286
- Mobile client contract: beta 18050

### Results

| Probe | Result |
| --- | --- |
| Capture payload-free event types during shell-backed TUI work | Pass |
| Keep the server event stream open throughout each command burst | Pass |
| Avoid connection-wide invalidation for `shell.created`, `shell.exited`, and `shell.deleted` | Pass |
| Avoid connection-wide invalidation for `vcs.branch.updated` | Pass |
| Keep `installation.update-available` on the current healthy stream generation | Pass |
| Keep the Live indicator stable during read-only Git work | Pass |
| Keep the session list stable during file creation, patching, reading, hashing, deletion, and Git work | Pass |
| Remove the temporary probe file without changing repository files | Pass |

The beta 18286 event trace showed a shell lifecycle burst for every shell-backed
TUI tool call. The beta 18050 mobile classifier did not know these event types,
so it fell back to connection-wide invalidation and repeatedly refetched the
session list. The mobile bridge now treats the shell lifecycle and branch-change
events as advisory for the current foundation UI. An available-update advisory
also no longer replaces a healthy stream; `installation.updated`, real stream
failure, durable sequence uncertainty, foreground recovery, and network recovery
retain their reconciliation behavior.

The signed iPhone applied the preview update and showed no Live or session-list
flicker during the controlled command checks. The trace and report retained no
command text, address, credential, path, prompt, identifier, event payload, file
content, or server content.

## 2026-08-27: physical Android 17 composer probe

### Stack

- Mobile runtime: signed EAS preview build using Hermes
- Device: Pixel 8 Pro running Android 17
- Expo SDK: 54.0.37
- React Native: 0.81.5
- Keyboard controller: 1.18.5

### Results

| Probe | Result |
| --- | --- |
| Install and launch preview version 0.1.4, build 6 | Pass |
| Focus the session composer and show the software keyboard | Pass |
| Keep the composer visible directly above the keyboard | Pass |

The prior build relied on activity resize and hid the composer behind the
keyboard on this device. The corrected build keeps the transcript container
fixed and moves only the composer dock from native keyboard inset animation
frames. The probe recorded no address, credential, identifier, path, prompt, or
server content.
