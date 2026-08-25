# opencode2-mobile specification

## 1. Purpose

Build a native iOS and Android client for OpenCode V2. The app connects to an
OpenCode HTTP server, gives users full control of coding sessions from a phone
or tablet, and uses native platform capabilities where they improve the work.

The app is an independent OpenCode V2 client. It uses the generated
`@opencode-ai/client` package and the V2 HTTP API. It does not reuse OpenCode V1
contracts or create a second provider abstraction.

## 2. Current API assumptions

- OpenCode V2 and `@opencode-ai/client` are beta.
- The published HTTP contract currently reports experimental version `0.0.1`.
- OpenCode can expose the API directly, commonly on port `4096`.
- The generated Promise client accepts a base URL, default headers, a custom
  `fetch`, request abort signals, and exposes events as an async iterable.
- `@opencode-ai/client/service` is Node-only and must not be imported by the
  mobile application.
- The event stream is volatile. Events can be lost during disconnection,
  background suspension, server restart, or overflow.
- The installed client is `0.0.0-beta-18050`. Recheck the `@beta` tag before
  each integration milestone, but do not reject a server only because its
  application version differs.
- A server reachable at `127.0.0.1` on a development computer is not reachable
  at that address from a physical phone.

## 3. Product principles

- Model OpenCode directly. Keep API-specific code isolated, but do not translate
  it into generic threads, turns, or provider-neutral contracts.
- Treat OpenCode as the durable source of truth. Local persistence is a cache
  and holds device-owned data such as connection profiles, drafts, and UI
  preferences.
- Let users follow a device-owned subset of the projects known to each
  connection. Following a project filters the mobile workspace; it does not
  create, modify, or delete the server project.
- Prefer native controls and interaction patterns over a web page in a native
  wrapper.
- Preserve useful state through poor connectivity and reconcile whenever the
  app returns to the foreground.
- Make dangerous capabilities explicit. Access to the API is equivalent to the
  ability to read files and execute commands as the OpenCode user.
- Ship a dependable session workflow before adding administration screens.

## 4. Scope

### 4.1 Foundation preview

The first usable build includes:

- Saved server connections and secure credential storage.
- Server health, compatibility, and connection diagnostics.
- Followed-project selection and location choice for new work.
- Combined cross-project session list, search, create, open, rename, and delete.
- Paginated session transcripts and live updates.
- Text prompts, agent/model selection, queue/steer behavior, and interrupt.
- Markdown, reasoning, tool calls, tool results, errors, and retries.
- Permission and form interactions supported by the V2 contract, including
  string options used for question-like controls.
- Self-hosted, encrypted push notifications for permission and form attention.
- Foreground/background lifecycle recovery.
- Phone-first iOS and Android layouts that remain usable on tablets.

### 4.2 Version 1.0

Version 1.0 adds the remaining high-value coding controls:

- Filesystem search, browsing, previews, mentions, and attachments.
- Session fork, move, import/export, compaction, and revert workflows.
- VCS status and diff views.
- Worktree management.
- Native terminal access through the PTY API and WebSocket connection.
- Persistent shell management and output.
- Commands, skills, agent/model management, and session instructions.
- First-class adaptive tablet layouts and split-view navigation.
- Provider/integration onboarding supported by the API.
- MCP server and resource management.
- Saved permission management, references, web search, and configuration
  inspection where safe.
- Native share input, deep links, quick actions, haptics, and local notifications.

### 4.3 Not required for version 1.0

- Running the OpenCode service on the phone.
- Supporting OpenCode V1.
- Editing arbitrary OpenCode configuration as unvalidated text.
- Debug and V1 migration endpoints.
- A hosted multi-user OpenCode service.
- A proprietary provider-neutral orchestration layer.
- Public remote push distribution without a managed publisher relay.
- A public store release before OpenCode publishes a supported remote
  authentication flow or the project defines an independently reviewed
  alternative.
- Copying the T3 Code mobile application wholesale. Small MIT-licensed native
  modules may be evaluated and ported with attribution and dependency review.

## 5. Architecture

```text
Native iOS or Android application
  | HTTPS or approved private-network development HTTP
  | @opencode-ai/client REST requests and event stream
  | PTY WebSocket when a terminal is open
  v
OpenCode V2 HTTP server
  | owns sessions, execution, files, VCS, tools, and configuration
  v
Development machine or remote host
```

There is no required Node or Hono process between the app and OpenCode. A VPN,
TLS reverse proxy, tunnel, or future relay may provide remote reachability, but
it must preserve the OpenCode API contract and must not become the source of
truth.

The optional notification broker is not an OpenCode proxy. The app still sends
all OpenCode API requests directly to the saved server. A V2 plugin projects only
opaque interaction identifiers and the exact location required to route global
forms. The broker owns one-time pairing, device registrations, an encrypted
durable outbox, Expo tickets and receipts, token replacement, and revocation. It
does not use an OpenCode credential during normal notification processing. Its
local pairing CLI accepts the credential and stores it in an encrypted,
short-lived bootstrap challenge for delivery to the intended phone. When the app
starts from OpenCode's built-in `/pair` QR, the broker receives the credential
once, verifies authenticated health and session access against the same-host
OpenCode origin, cancels the response bodies, and creates the same short-lived
challenge. The pairing code is a bearer secret until the challenge expires or is
consumed.

### 5.1 Mobile application layers

```text
screens and native components
  -> feature hooks and view models
  -> query cache, event reduction, and local device state
  -> OpenCode adapter
  -> @opencode-ai/client and platform networking
```

Only the OpenCode adapter imports `@opencode-ai/client`. UI code consumes its
generated types through narrow feature-facing exports. The adapter may provide
React Native transport fixes, redacted errors, and compatibility checks, but it
must not duplicate generated response types.

### 5.2 Workspace

```text
apps/mobile                 Expo/React Native application
packages/opencode-adapter   generated-client boundary and sync helpers
packages/test-fixtures      sanitized deterministic API and event fixtures
packages/notification-protocol  encrypted notification wire contract
packages/opencode-notification-plugin  V2 event projection and retry queue
apps/notification-broker    self-hosted pairing and Expo push process
```

The old web frontend and Hono host proxy have been removed. The mobile app talks
directly to OpenCode.

## 6. Technology decisions

- Platform: Expo with React Native and the New Architecture enabled.
- Pinned foundation stack: Expo SDK 54.0.37, React Native 0.81.5, and React
  19.1.0. The minimum targets are iOS 15.1 and Android API 24. SDK 54 is an
  intentional foundation-preview constraint so physical iPhones can use the
  Expo Go build distributed through Apple's App Store.
- Builds: Expo Go supports early physical-device REST testing. Expo development
  builds and EAS-compatible native projects remain configured and become
  mandatory when custom native modules land or release testing begins.
- Distribution: the foundation is a pre-1.0 source release. Public store
  distribution is not a foundation target.
- Identity: tracked defaults use the display name `OpenCode2 Mobile` and generic native
  identifiers. Signed deployments provide unique Expo, iOS, Android, and
  Firebase identifiers through ignored local configuration or EAS environment
  variables.
- Language: strict TypeScript.
- Workspace: pnpm. Node is a build tool, not part of the mobile runtime.
- Navigation: React Navigation native stack with platform-appropriate modal and
  split-view behavior.
- Server state: TanStack Query, plus a small event reduction and reconciliation
  layer.
- Local data: Expo SQLite for bounded non-content cache metadata and
  preferences. Drafts are encrypted before persistence with key material held
  in SecureStore. Transcripts, tool output, terminal data, and file contents are
  not persisted in the foundation preview. OpenCode remains authoritative.
- Secrets: Expo SecureStore. Never store credentials in SQLite, AsyncStorage,
  logs, crash reports, deep links, or analytics.
- Push: `expo-notifications` in signed preview or development builds. Visible
  text is generic. Routing data is encrypted per device and treated as a
  volatile hint.
- Transport limits: JSON responses and individual SSE events are capped at 16
  MiB. Reject JSON with an oversized declared `Content-Length` before reading
  the body. React Native's global fetch buffers responses, so if the server omits
  the length, the wrapper can only reject after text decoding and before JSON
  parsing. Prefer pagination so normal responses stay well below this ceiling.
- Lists: an inverted built-in React Native `FlatList` with bounded pagination,
  stable prepend, and explicit live-follow behavior. Older-device benchmarks
  remain open.
- Motion: React Native Reanimated where native-driven motion is useful.
- Markdown and code: native text selection, sanitized links, bounded rendering,
  and lazy syntax highlighting. Benchmark candidate renderers on both platforms
  before committing.
- Testing: Vitest for pure TypeScript, React Native Testing Library for
  components, Maestro or Detox for device flows, and an opt-in real-server suite.
- Formatting and linting: Biome for supported files, with platform-native checks
  added when custom Swift or Kotlin exists.

Keep Expo, React Native, navigation, rendering, and device-test versions pinned
together. Recheck their compatibility and the iOS 15.1 and Android API 24
minimums before stack upgrades.

## 7. Connections and authentication

A connection profile contains:

- A schema version for explicit local migrations.
- A locally generated ID and user-visible name.
- A normalized `http` or `https` base URL.
- A development authentication mode supported by the target OpenCode
  deployment.
- A non-secret credential reference into SecureStore.
- Last successful health result, server version, and last-used timestamp.
- Optional development-only allowance for cleartext HTTP over a user-approved
  Tailscale or private-network connection.

Connection behavior:

1. Normalize the URL and reject embedded credentials.
2. Acquire the selected development credential and create the generated client
   with its headers and platform `fetch`.
3. Check `/api/health` with a short timeout.
4. Fetch server information and validate API compatibility.
5. Save the profile only after explicit user confirmation.
6. Start event subscription and authoritative reconciliation.

The connection test does not write credentials. Saving writes a versioned
credential value to SecureStore and stores only its random reference in SQLite.
Because these stores cannot share a transaction, SQLite tracks pending secret
writes and deletions. Launch cleanup removes orphaned values and retries
interrupted deletions. Removing a profile clears its credential and all
connection-owned local rows.

Connection base URLs must be origin-root URLs because generated operations use
absolute `/api/...` paths. Reject path prefixes, queries, and fragments. Do not
follow a redirect that changes origin or downgrades HTTPS while forwarding
credentials. During the beta, compatibility is established by behavioral probes
for required foundation operations and runtime validation of authoritative
snapshots and event envelopes. Record both versions for diagnostics. A version
mismatch alone is informational; missing endpoints or incompatible response
shapes block the connection.
The URLs returned by `/api/server` are diagnostic and may not be reachable from
the phone.

Development address guidance belongs in the UI:

- iOS Simulator can normally use the host Mac's `localhost`.
- Android Emulator commonly uses `10.0.2.2` for the host machine.
- Physical devices use a LAN hostname/IP, VPN hostname, tunnel, or remote URL.

Signed builds may accept manually entered Basic or Bearer credentials for a
user-controlled development deployment and store them in SecureStore. They must
not embed credentials in the application bundle. The app also supports a
reviewed one-time QR or manual pairing flow. The encrypted bootstrap can carry
the same manually supplied credential, which the phone writes to SecureStore.
OpenCode V2 has no client credential issuance or revocation API, so deleting a
phone registration revokes push access but cannot revoke a shared OpenCode
credential. Public onboarding remains blocked until OpenCode adds per-device
credentials or deployment authentication can issue and revoke them
independently.

## 8. Security

- Treat a connection as remote code execution authority on the target host.
- Deployment configuration may enable cleartext HTTP for signed builds.
  The app also requires an explicit per-connection opt-in and shows a persistent
  warning. Operators must limit this mode to user-approved LAN or encrypted
  overlay connections; the app does not classify hosts as private. Keep it
  disabled for Internet-facing and production deployments.
- Redact authorization headers, tokens, prompts, file contents, terminal data,
  tool output, and query parameters that may contain paths from logs and crash
  reports.
- Use platform trust validation. Certificate pinning is optional and must not
  prevent normal certificate rotation by default.
- Offer an opt-in device-authentication app lock. When enabled, require strong
  biometrics with platform passcode fallback at launch and after the app leaves
  the foreground. Store only the enabled preference in SQLite.
- Hide sensitive content in the app switcher when the user enables privacy mode.
- Validate external deep links, shared files, callback URLs, and scanned QR data.
- Confirm destructive actions and show the affected host, project, and path.
- Bound response, event, Markdown, diff, file-preview, and terminal buffers.
- Exclude local databases, encrypted drafts, caches, and temporary attachments
  from OS backups. Profile deletion removes its encrypted drafts, cache
  metadata, temporary files, and SecureStore entries.
- Never execute arbitrary JavaScript or unsanitized HTML from messages or tools.

## 9. State and synchronization

REST responses are authoritative. Events reduce latency but are not a durable
log.

```text
authoritative query snapshots
  + idempotent event reductions
  + narrow invalidation for uncertain events
  + full reconciliation after reconnect or foreground
```

Rules:

- Scope cache keys by connection ID, normalized location reference, and
  operation parameters. Require explicit locations for location-scoped adapter
  operations instead of silently using the server default.
- Key server entities by their generated stable IDs.
- Store active subscriptions per connection, with only the selected connection
  live in the foundation.
- Abort stale requests when switching connection, project, or session.
- Unknown event types do not terminate the stream. Record a redacted diagnostic
  and invalidate the narrowest safe query.
- Event decoding or sequence uncertainty triggers refetch rather than guessed
  state.
- Coalesce high-frequency message and tool updates to the display refresh rate.
- On reconnect, open a new stream generation and buffer events while refetching
  authoritative snapshots. Install snapshots only for the current generation,
  apply buffered events idempotently, then narrowly refetch uncertain roots.
- Reconciliation includes health, visible project and session lists, active
  sessions, visible session metadata and messages, inbox work, permissions, and
  forms for the locations represented by followed projects and the current
  session.
- On foreground, probe health and reconcile before declaring the view current.
- On background, cancel or suspend streams cleanly. Never promise continuous
  execution or notifications while the OS suspends the app.
- Optimistic changes are limited to reversible UI state. Prompt admission uses
  the durable response returned by OpenCode.
- Generate a stable prompt admission ID before transmission. If the response is
  lost, retain an unknown-delivery state and reconcile inbox and message state
  by ID before offering a retry. Do not assume that resubmission is idempotent
  until the tested contract proves it.

### 9.1 Followed projects and the session inbox

OpenCode remains authoritative for project and session data. The mobile app
stores only the set and order of project IDs that the user follows on each
connection. Current project names, canonical directories, sandboxes, and other
server fields come from the generated V2 project contract rather than a local
copy. If a followed project disappears from the server project list, show it as
unavailable and let the user unfollow it.

The current V2 API lists known projects but does not provide a project-create or
project-pin operation. "Follow project" therefore means adding a known server
project to this device's workspace. It must not imply that the app cloned a
repository, registered a directory, or changed the remote host. Do not rely on
location resolution having an undocumented project-registration side effect.

The primary phone destination is one session inbox across followed projects,
not a project-first hierarchy. Project filters narrow this inbox without
changing navigation ownership. Creating a session still requires one explicit
project location or worktree.

The default inbox has three non-overlapping sections:

1. `Needs you`: sessions with pending permissions or forms.
2. `Working`: sessions present in the connection-wide active-session snapshot.
3. `Recent`: remaining followed-project sessions, initially in server recency
   order.

Attention takes presentation priority over execution, so a running session with
a pending interaction appears only in `Needs you`. Keep attention, execution,
lifecycle, transport freshness, and local prompt-admission recovery as separate
internal facts even when the row presents one primary label. Do not reinterpret
OpenCode's `{ type: "running" }` active-session result as a broader inbox
lifecycle.

Each row identifies its project, session title, primary state or relative time,
and location context when needed to disambiguate worktrees. Keep existing rows
stable while activity streams instead of reordering them on every update.
Server-backed search and cursor pagination operate per followed project, and the
client merges the results by stable session ID. A global first page followed by
local filtering is insufficient because unrelated projects could consume the
page.

Root sessions are the normal peer rows. Child sessions stay under their parent
when that relationship is known. A child-owned interaction bubbles the parent
into `Needs you`, while the action opens the owning child. Do not count the same
child both as an independent working row and as parent background work.

The current contract does not provide connection-wide permission or form
snapshots. Their authoritative list operations are location-scoped. For followed
projects, derive reconciliation locations from project canonical directories,
sandboxes, project-filtered session results, active-session details, and event
locations. On startup, reconnect, and foreground, reconcile known followed
locations before presenting their attention state as current.

Attention coverage must remain explicit when some followed locations have not
reconciled. Do not label a count as server-wide, and do not include global queue,
background-work, or unread counts without an authoritative V2 summary. Before
implementing the aggregate, verify against the pinned beta whether a permission
or form list at a project root covers subdirectories and whether sessions
waiting on a permission or form remain in `/api/session/active`.

This information architecture borrows useful mobile behavior from T3 Code: a
flat cross-project list, project identity on each row, stable running rows,
native phone stack navigation, settings presented over the workspace, and a
persistent session sidebar on larger layouts. T3's orchestration shell,
environment catalog, project-create flow, logical repository grouping, queued
outbox, settle/snooze lifecycle, and attention flags are not OpenCode V2
contracts and must not be copied into the adapter.

## 10. Core user flows

### 10.1 First connection

1. User enters or pastes a server URL, or scans a supported OpenCode and
   notification pairing payload.
2. App explains local-network addressing when the URL is localhost.
3. User chooses the supported authentication method.
4. App checks health and compatibility.
5. App stores the secret in SecureStore and opens followed-project selection.
6. User chooses known projects to include in the mobile session inbox. The
   server's current project may be selected initially.

### 10.2 Start work

1. User starts a new session from the combined inbox and selects a followed
   project and directory or worktree.
2. User selects an optional agent and model.
3. App creates the session and opens the composer.
4. The new session appears from the authoritative create response.

### 10.3 Resume and prompt

1. App loads session metadata and the newest message page.
2. Older messages load on demand without moving visible content.
3. User sends text using the selected agent and model.
4. App shows the durable admitted inbox item as a temporary delivery overlay.
5. Events update assistant and tool activity.
6. If work is active, the app exposes queue or steer instead of choosing
   silently.
7. User may interrupt execution.

The admitted inbox item is not a projected transcript message. The app replaces
the overlay by stable ID when the corresponding message appears and keeps
admitted, queued or steered, promoted, executing, cancelled, completed, and
unknown-delivery states distinct.

### 10.4 Resolve blocked work

- Pending interactions for reconciled locations in followed projects are
  visible in the `Needs you` inbox section and inside their owning session.
- The header exposes a followed-project attention count and indicates when
  location coverage is still reconciling or incomplete.
- Permission requests show the action, resources, optional saved patterns, and
  a clearly labeled client-authored explanation for known built-in actions.
- Before `always`, show that saved patterns may be broader than the displayed
  resource. Before `reject`, show that the reply may reject other pending
  requests in the same session.
- Forms support the current string, number, integer, boolean, multiselect, and
  external URL controls, including conditional visibility and validation.
- Multiple pending requests have deterministic ordering without stacked modals.
- Requests completed by another client disappear after reconciliation.

### 10.5 Recover

1. App retains the current transcript and marks it stale or disconnected.
2. It reconnects with bounded exponential backoff and jitter while foregrounded.
3. It starts authoritative reconciliation after reconnecting.
4. It resumes event reduction without duplicating messages or tool parts.

## 11. Screens and native interaction

- Onboarding and connection profiles.
- Followed-project management using projects known to the selected OpenCode
  connection.
- Project, location, directory, and worktree selection for new sessions.
- Searchable, paginated cross-project session inbox with `Needs you`, `Working`,
  and `Recent` sections.
- Session transcript with stable live-follow and unread controls.
- Composer with multiline native editing and model/agent controls.
- Permission and form sheets.
- Diagnostics with redacted, exportable connection information.

On phones, Sessions and Session are native stack destinations. Session uses the
platform back button and gesture to return to the inbox. A cold-start or deep
link without back history installs an explicit Sessions fallback. Settings,
connections, and followed-project management open from a header menu as overlays
that do not replace the active workspace. Do not retain a bottom tab bar for
Sessions, Pending, and Settings. A hamburger icon is reserved for a real drawer;
otherwise use the platform-appropriate menu or settings control. Keep a visible
attention-count action available from session detail.

On larger layouts, the same model becomes a persistent session sidebar and a
session detail pane. Project filters and attention sections remain properties of
the sidebar rather than separate top-level destinations.

Version 1.0 screens add:

- Composer attachments, mentions, commands, skills, and tablet keyboard
  shortcuts.
- Files browser and source/image/Markdown previews.
- VCS status, changed files, and diff review.
- Terminal and persistent shell screens.
- Integrations, MCP, saved permissions, and connection settings.

Foundation native behavior includes safe areas, Dynamic Type/font scaling,
screen-reader labels, reduced-motion handling, a dark theme, and usable tablet
fallback layouts. Version 1.0 adds a light theme, first-class tablet split view,
hardware keyboard commands, share input, deep links, haptics, and app quick
actions.

## 12. Transcript and content rendering

- Render every documented message and part variant exhaustively where generated
  unions permit it.
- Provide a safe generic fallback for future variants.
- Collapse reasoning by default and preserve the user's choice per connection.
- Show generated tool state as streaming, running, completed, or error. Display
  interruption at the session execution or outcome level rather than inventing
  a tool-level state.
- Add tool-specific renderers only when they improve comprehension.
- Make text and code selectable and copyable.
- Treat links, images, file paths, ANSI output, diffs, and tool payloads as
  untrusted content.
- Truncate or progressively reveal very large content without discarding the
  ability to inspect it.
- Keep visible rows stable while prepending history or streaming updates.

## 13. Native lifecycle and notifications

- Reconnect and reconcile on network restoration and foreground transitions.
- Persist unsent drafts as encrypted content. Attachment persistence is added
  with the version 1.0 attachment workflow.
- Do not rely on timers, sockets, or event streams continuing in the background.
- Optional remote permission and form attention uses the self-hosted OpenCode V2
  plugin and broker described in section 5. The broker contacts Expo Push
  Service without retaining OpenCode credentials, and the app treats every
  notification as a hint before an authoritative REST fetch.
- Widgets and Live Activities remain optional version 1.0 work.

## 14. Reliability and performance

- Cold launch to cached shell should remain responsive without a network.
- Session and message pagination must use API cursors.
- Switching sessions cancels obsolete work and does not leak updates across
  connection IDs.
- A server restart is a normal recoverable condition.
- Large transcripts, diffs, tool output, and terminal buffers have explicit
  memory limits.
- Streaming updates must not rerender the entire transcript.
- Crash reports and diagnostics remain useful after redaction.
- The app reports unsupported server/client combinations with an actionable
  upgrade message.

Performance budgets and minimum supported devices will be set after the native
vertical slice is measured on one older iPhone and one lower-midrange Android
device.

## 15. Testing strategy

- Unit-test URL normalization, redaction, event reduction, reconciliation,
  lifecycle transitions, pagination, and delivery state.
- Contract-test the adapter against sanitized fixtures checked against the
  generated types and pinned OpenAPI schema. TypeScript types alone do not
  validate runtime wire data.
- Component-test all message, part, tool, permission, and form union
  members.
- Device-test connection, create session, prompt, stream, interrupt, reconnect,
  background/foreground, and destructive confirmations on iOS and Android.
- Test screen readers, Dynamic Type/font scaling, reduced motion, hardware
  keyboard use, and tablet layouts.
- Use a deterministic fake OpenCode server in CI with no provider credentials.
- Keep real-server tests opt-in and run them against the exact supported beta
  version before release.
- Test disconnects around prompt admission, tool start, blocked interaction,
  tool completion, assistant completion, and server restart.

## 16. Release acceptance

The repository is a pre-1.0 source release, not a supported public binary or app
store release. Unchecked work remains visible in `TODO.md` and must not be
reported as passed without evidence.

The foundation scope is complete when:

- Development builds install and launch on current iOS and Android devices.
- A developer can configure a reachable user-controlled OpenCode V2 server with
  an explicitly approved development credential. After the encrypted broker
  bootstrap expires, the phone keeps that credential only in SecureStore.
- Session lifecycle and a complete text agent turn work on both platforms.
- Every current message/part and pending-interaction variant has a safe renderer.
- Background/foreground and network loss recover without duplicate or missing
  durable state after reconciliation.
- Large transcripts remain usable and stable while streaming.
- Core flows pass deterministic device tests and an opt-in real-server suite.
- Security review finds no credentials or sensitive content in unencrypted
  storage, logs, deep links, screenshots generated by the app, or crash metadata.

Version 1.0 additionally requires the filesystem, VCS/diff, worktree, terminal,
shell, integration, MCP, and native system features listed in section 4.2.

## 17. Open decisions

- Public display name, final iOS bundle identifier, final Android application
  ID, icons, public store listing, signing, and store ownership.
- Official OpenCode remote authentication and pairing mechanism required before
  public distribution.
- Terminal implementation and whether to adapt an existing MIT-licensed native
  module.
- Final Markdown, code, and diff implementations after device benchmarks.
- Analytics and crash-reporting policy. Default is no product analytics and
  local redacted diagnostics only.

## 18. API coverage

Foundation work uses health/server, location/project, session/message/inbox,
agent/model, event, permission, and form operations.

Version 1.0 expands to session context/instructions/fork/move/import/export/
compact/revert, PTY, shell, VCS, worktree, provider/integration, MCP, credential,
reference, web search, saved permission, command, skill, filesystem, and
config-read operations.

Experimental debug, migration, session-log, and undocumented operations are not
release dependencies unless promoted into the supported generated contract.

## 19. Sources

- <https://opencode.ai/v2/docs/>
- <https://opencode.ai/v2/docs/api>
- <https://opencode.ai/v2/docs/build/client>
- <https://opencode.ai/v2/openapi.json>

This specification was checked against the published V2 docs and OpenAPI
document on August 24, 2026. Recheck the beta contract and installed generated
client before every integration milestone.
