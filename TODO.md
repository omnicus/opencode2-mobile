# Native Mobile Implementation TODO

This list is ordered to expose transport and lifecycle risks before investing in
the full interface. Recheck the OpenCode V2 docs, published OpenAPI document, and
installed generated client at the start of every integration milestone.

Unchecked items remain foundation, version 1.0, or public-release work unless a
later milestone states narrower completion criteria.

## 0. Product and repository decisions

- [x] Use `opencode2-mobile` as the repository name and
      `@opencode2-mobile/*` as the private workspace scope.
- [x] Target native iOS and Android with Expo and React Native.
- [x] Connect directly to a user-configured OpenCode V2 HTTP server.
- [x] Use OpenCode's generated client and types instead of handwritten API
      contracts or a provider-neutral model.
- [x] Treat OpenCode as the durable source of truth.
- [x] Use Expo Go for foundation smoke testing and require development builds
      when custom native modules or release testing begin.
- [x] Keep deployment-specific display names and branding outside tracked source.
- [x] Keep deployment-specific Expo, iOS, Android, and Firebase identifiers in
      ignored local configuration or EAS environments.
- [x] Use balanced modern iOS and Android minimum versions, with exact versions
      pinned after checking Expo stack compatibility.
- [x] Make the foundation phone-first and tablet-compatible; add first-class
      tablet split views in version 1.0.
- [x] Keep connection onboarding development-only until OpenCode publishes a
      supported remote authentication flow or an alternative is reviewed.
- [x] Keep public remote push distribution out of version 1.0 until a managed
      publisher relay is designed.
- [x] Treat the foundation as a pre-1.0 source release rather than a public store
      release.
- [x] Assign signing and store ownership without recording private
      account details in the repository.
- [x] Record the settled choices in `docs/SPEC.md`.

Exit criteria: provisional application identity is chosen; supported devices
and connection security have no blocking ambiguity for scaffolding.

## 1. Replace the web scaffold

- [x] Verify the current compatible Expo, React Native, and React versions.
- [x] Create `apps/mobile` with the New Architecture and strict TypeScript.
- [x] Add iOS and Android development-build profiles.
- [x] Add React Navigation with native stack.
- [x] Add modal presentation with the first modal workflow.
- [x] Add TanStack Query and app-level error boundaries.
- [x] Add SecureStore, SQLite, network status, safe-area, gesture, screens,
      Reanimated, and haptics dependencies.
- [x] Configure Biome, TypeScript, unit tests, component tests, and native checks.
- [x] Add environment/config validation without checking secrets into the app.
- [ ] Establish platform-aware color, typography, spacing, elevation, and motion
      tokens.
- [ ] Add light, dark, reduced-motion, and font-scaling foundations.
- [x] Update root scripts and CI for the mobile workspace.
- [x] Remove `apps/web` and `apps/host` after the Expo native bundle smoke test
      passes.
- [x] Rewrite README and repository guidance for native development.

Exit criteria: one command starts Metro, development builds launch on iOS and
Android, and CI checks an empty native application.

## 2. React Native client compatibility spike

- [x] Check the V2 client docs and replace the pinned `@next` build with tested
      beta 18050.
- [x] Record the exact tested OpenCode application versions and behavioral
      compatibility probes; report differing versions without rejecting a server
      that passes those probes.
- [ ] Re-evaluate the Expo SDK 54 constraint before transport certification and
      upgrade after the physical-device Expo Go workflow is no longer needed.
- [x] Confirm the Promise client bundles under Metro without Node polyfills or
      Node-only service imports.
- [x] Create a client against a configurable base URL and custom headers.
- [ ] Call `/api/health`, `/api/server`, and `/api/session` from iOS Simulator.
- [ ] Repeat the calls from Android Emulator.
- [x] Repeat the REST calls against a Tailscale server from one physical iOS
      device.
- [ ] Repeat the REST calls against a LAN or Tailscale server from one physical
      Android device.
- [x] Verify async-iterable event streaming on a physical iPhone using Hermes.
- [ ] Verify async-iterable event streaming on Android using Hermes.
- [x] Test oversized SSE events and JSON responses without exceeding the
      foundation memory budget.
- [x] Verify stream cancellation with `AbortSignal` on a physical iPhone.
- [ ] Verify stream cancellation with `AbortSignal` on Android.
- [x] Background and foreground the physical iPhone during a stream and document
      actual platform behavior.
- [ ] Repeat the background and foreground stream probe on Android using Hermes.
- [x] Verify the PTY connect-token and WebSocket flow with a small terminal probe
      on a physical iPhone using Hermes.
- [ ] Repeat the PTY connect-token and WebSocket probe on Android using Hermes.
- [x] Add adapter shims only for demonstrated React Native incompatibilities.
- [x] Add a fake-server contract test for requests, streaming frames, failures,
      cancellation, and reconnect.
- [x] Record redacted compatibility results in `docs/` as probes are completed.

Exit criteria: REST, event streaming, cancellation, and PTY transport have been
proved on Hermes on both platforms before feature UI work starts.

## 3. Connection profiles and security

- [x] Define a versioned local connection-profile schema.
- [x] Normalize origin-root base URLs and reject embedded credentials, path
      prefixes, queries, and fragments.
- [x] Reject redirects that change origin or downgrade HTTPS while forwarding
      credentials.
- [x] Store credentials in SecureStore and non-secret profile data in SQLite.
- [x] Implement add, edit, test, select, and remove connection flows.
- [x] Support manual development credentials in signed builds without
      embedding credentials in the application bundle.
- [x] Define and implement an encrypted, short-lived QR/manual pairing payload
      for signed deployments.
- [x] Explain simulator, emulator, physical-device, LAN, VPN, and remote URLs in
      onboarding.
- [x] Detect `localhost` misuse on physical devices.
- [x] Require explicit per-connection opt-in and a persistent warning for
      development cleartext HTTP over approved Tailscale or private networks.
- [x] Add health, unauthorized, TLS, timeout, unreachable, and incompatible-API
      diagnostics.
- [x] Redact headers, tokens, paths, prompts, and content from logs and errors.
- [x] Clear credentials and connection-owned local data on profile deletion.
- [x] Add an optional device-authentication app lock after the base profile flow
      works.
- [x] Test malformed URLs, expired credentials, certificate failures, server
      replacement, and profile migration.

Exit criteria: users can safely connect to, switch between, and remove reachable
OpenCode servers without leaking credentials.

## 4. State, events, and app lifecycle

- [x] Scope every query key and persisted cache entry by connection ID,
      explicit location reference, and operation parameters.
- [x] Require explicit locations for location-scoped adapter operations.
- [x] Implement event subscription state: connecting, connected, reconnecting,
      stale, offline, unauthorized, and incompatible.
- [x] Add bounded exponential reconnect backoff with jitter.
- [x] Implement idempotent reductions for known event types.
- [x] Invalidate the narrowest safe query for unknown or undecodable events.
- [x] Reconcile authoritative state after every reconnect.
- [x] On reconnect, buffer a new stream generation while fetching snapshots,
      apply buffered events idempotently, and refetch uncertain roots.
- [x] Reconcile after app foreground and network restoration.
- [x] Stop streams cleanly when backgrounded or switching connections.
- [x] Coalesce high-frequency updates before they reach React rendering.
- [x] Add bounded non-content SQLite cache metadata for useful disconnected
      shells and exclude it from OS backups.
- [x] Add redacted structured diagnostics and an in-app export view.
- [x] Test malformed events, overflow, event loss, server restart, network change,
      background suspension, and rapid connection switching.

Exit criteria: the app returns to authoritative server state after every tested
disconnect or lifecycle boundary without duplicated durable entities.

## 5. Native application shell

- [x] Build onboarding, connection switcher, workspace shell, and settings stack.
- [x] Add phone navigation and a usable tablet fallback layout.
- [x] Show connection, reconnecting, stale, offline, and blocked-work indicators.
- [x] Add selected-location pending-interaction navigation with an explicit
      unavailable state until location-scoped reconciliation exists.
- [x] Implement loading, empty, partial-cache, failure, and incompatible states.
- [x] Add native error boundaries with retry and redacted diagnostics.
- [x] Add screen-reader labels, logical focus order, reduced motion, and large
      text behavior from the start.
- [ ] Test safe areas, rotation policy, keyboard appearance, and system themes on
      both platforms.

Exit criteria: the shell behaves like a native app on phones and supported
tablets and always communicates connection freshness.

The completed shell is the foundation implementation. Milestone 9 replaces its
phone bottom navigation with a native Sessions-to-Session stack, followed-project
management, and settings overlays. The existing tablet rail remains a fallback
until the version 1.0 split view is built.

## 6. Projects, locations, and sessions

- [x] Resolve and normalize locations through the server before enabling their
      location-scoped queries.
- [x] Abort stale requests when switching project or session.
- [x] Load projects, current project, and location information.
- [x] Implement directory/location selection for new sessions.
- [x] Add worktree choice to the location model without building management UI
      yet.
- [x] Load newest-first sessions with cursor pagination.
- [x] Add server-backed search and local filtering where appropriate.
- [x] Display active, blocked, child, archived, and outcome state where
      available. Queue state remains available only inside an open session.
- [x] Create a session with optional title, agent, model, and location.
- [x] Open, rename, and delete sessions.
- [x] Warn that deleting a parent also deletes child sessions.
- [x] Preserve navigation and visible list position through refetches.
- [x] Add swipe actions and haptics without hiding accessible alternatives.
- [x] Test empty, large, paginated, disconnected, and concurrently changed lists.
- [x] Refine the phone workspace into a compact session feed with project and
      location filters plus a separate new-session sheet.
- [x] Bound initial and batched row rendering for large session lists.

Exit criteria: session lifecycle management works against a real server on both
platforms.

Implementation and a local beta 18050 server lifecycle probe are complete.
Physical iPhone and Android preview workflows now cover connection reload,
session listing, transcript paging, text turns, and recovery. Full create,
rename, and delete coverage has not been recorded separately on both devices.

## 7. Transcript foundation

- [x] Load session metadata and paginated messages.
- [ ] Select and benchmark the virtualized transcript list on older devices.
- [x] Preserve visible content while prepending older pages.
- [x] Implement stable live-follow and jump-to-latest behavior.
- [x] Render user messages, text, attachments, and metadata.
- [x] Render assistant text and collapsible reasoning.
- [x] Render tool streaming, running, completed, and error states, with
      interruption represented at session execution or outcome level.
- [x] Render shell, synthetic, system, skill, model/agent/location switch,
      compaction, retry, and structured-error variants.
- [x] Add safe fallback UI for unknown future message and part variants.
- [x] Make text and code selectable and copyable.
- [x] Sanitize links, images, ANSI data, Markdown, tool output, and file paths.
- [x] Bound and progressively reveal large messages and tool results.
- [x] Add fixtures and exhaustive tests for every generated union member.
- [ ] Measure streaming render frequency, memory use, and scroll stability.

Exit criteria: every current message and part is safe and usable, including in a
large transcript streaming at high frequency.

The transcript slice is complete against beta 18050 through frame-coalesced event
projection. It uses an inverted built-in `FlatList`, retains at most five pages,
and keeps transcript content memory-only. Text, reasoning, tool, retry, and step
events update existing query caches once per display frame. Execution completion,
malformed events, and missing projection prerequisites trigger a narrow REST
reconciliation. Older-device and Android benchmarking remain.

A T3-style live-follow latch follows row growth at the newest edge, pauses through
user drag and momentum, and exposes a floating return-to-latest control. The
control intentionally does not infer a numeric unread count from the current V2
contract. An explicit jump stays available until native scroll events confirm the
live edge, and unchanged transcript rows no longer rerender when a different row
streams. V2 task and subagent tools render as dedicated cards with background
state, protocol suppression, and child-session navigation. Physical validation
confirmed the live large-text relayout, scrollable navigation, and non-overlapping
latest control on an iPhone. A 30-second physical iPhone sample stayed responsive
with 41 resident messages: 192 projection events produced 14 cache writes across
78 frames, no reconciliation, and a 12.980 ms maximum projection duration. The
redacted support report records only numeric projection, row-commit, resident-set,
live-follow, and latest-jump counters. Older-iPhone, Android, and byte-level memory
measurements remain pending before final budgets are set.

## 8. Composer and execution

- [x] Build a multiline native composer with correct keyboard and focus behavior.
- [x] Persist encrypted drafts per connection and session using key material
      held in SecureStore, with backup exclusion and deletion tests.
- [x] Load and select agents and models.
- [x] Generate a stable admission ID before every prompt submission.
- [x] Render the admitted inbox item as a temporary overlay and replace it by ID
      when the projected transcript message appears.
- [x] Track admitted, queued or steered, promoted, executing, cancelled,
      completed, and unknown-delivery states separately.
- [x] Expose queue and steer choices while execution is active.
- [x] Display queued and active execution state.
- [x] Add interrupt, background, and wait behavior where useful.
- [x] Prevent accidental duplicate submission without hiding server conflicts.
- [x] Add haptic feedback for submission, destructive actions, selection, and
      transcript jumps.
- [x] Test duplicate taps, cancellation, conflict, queue, steer, interrupt,
      reconnect, and session switching during admission.

Deterministic tests and both Hermes exports pass. Physical iPhone and Android
text turns pass, including Android network-loss recovery. A signed iPhone preview
also launched through the fail-closed database backup-exclusion guard. React
Native `TextInput` does not expose modifier state, so reliable multiline
hardware-keyboard commands remain in the version 1.0 composer expansion rather
than changing Enter into an unsafe submit shortcut.

Exit criteria: users can complete reliable text agent turns on both platforms,
including recovery from an unknown prompt-admission outcome.

## 9. Followed projects, attention, permissions, and forms

- [x] Probe the pinned V2 beta permission behavior: requests are exact-location
      scoped and a session blocked only on permission is absent from
      `/api/session/active`.
- [x] Probe form location scope and blocked-session active behavior: forms are
      exact-location scoped and a session blocked on a form is absent from
      `/api/session/active`.
- [x] Persist an ordered set of followed project IDs per connection without
      copying server project records or paths into the preference table.
- [x] Add project-scoped session listing behind the OpenCode adapter and keep the
      existing explicit location-scoped operation separate.
- [x] Load and merge paginated root sessions across followed projects without a
      global page that can be exhausted by unrelated projects.
- [x] Build non-overlapping `Needs you`, `Working`, and `Recent` sections with
      project identity on every row and stable ordering while work runs.
- [x] Keep attention, execution, lifecycle, transport freshness, and prompt
      admission as separate state facts with deterministic display priority.
- [x] Keep child sessions under their parent, bubble child-owned interactions to
      the parent row, and avoid double-counting background work.
- [x] Replace the phone bottom navigation with native Sessions-to-Session back
      navigation, a deep-link fallback, an attention action, and settings,
      connection, and followed-project overlays.
- [x] Preserve an adaptive seam for a persistent session sidebar and detail pane
      without building the version 1.0 tablet split view yet.
- [x] Derive followed-project reconciliation locations from project roots,
      sandboxes, session metadata, active-session details, and event locations.
- [x] Expose reconciling or incomplete attention coverage instead of presenting
      a location-scoped count as server-wide.
- [x] Do not add global queued, background-working, unread, snoozed, or settled
      states without authoritative OpenCode V2 summaries.

- [x] Load pending interactions on startup, reconnect, and foreground.
- [x] Show blocked-work counts across reconciled followed-project locations and
      per session.
- [x] Render permission action, resources, optional saved patterns, and clearly
      labeled client-authored explanations for known built-in actions.
- [x] Warn that `always` may save broader patterns and `reject` may reject other
      pending permission requests in the same session.
- [x] Implement every permission reply option in the generated contract.
- [x] Load form requests and state.
- [x] Render string, number, integer, boolean, multiselect, and external URL
      controls, including conditional visibility and validation states.
- [x] Reply to and cancel forms.
- [x] Define deterministic ordering for simultaneous requests.
- [x] Reconcile interactions completed from another client.
- [x] Add accessible non-modal form cards for simultaneous requests and native
      modal routes for attention and workspace management.
- [x] Test disconnect and background/foreground reconciliation while tools are
      blocked.

Followed-project preferences persist only connection/project IDs and local order.
The merged inbox keeps one cursor per project, bubbles actionable children under
their root, and labels stale, reconciling, incomplete, and current attention
states without inventing queue or unread summaries. Permission and form state is
reconciled from exact locations discovered through projects, sessions, active
ancestry, and events. Signed-build and physical-device validation remains in the
foundation verification gate below.

Exit criteria: no supported interaction in a followed project can remain
invisibly blocked after its known locations reconcile, and the app clearly marks
incomplete attention coverage.

## 9.1 Foundation verification gate

- [x] Install signed builds on physical iOS and Android devices.
- [ ] Run authenticated REST, event streaming, cancellation, reconnect,
      background/foreground, prompt admission, permissions, and forms against
      the exact supported OpenCode beta.
- [ ] Verify credentials and draft encryption keys remain in SecureStore and
      local databases, caches, and temporary data are excluded from OS backups.
- [ ] Run deterministic device tests for the complete foundation workflow.
- [ ] Record measured transcript memory, rendering, and scroll-stability budgets.
- [ ] Complete a focused security and accessibility review.

Exit criteria: the phone-first foundation is safe and dependable enough for
pre-1.0 use before version 1.0 feature work begins.

## 9.2 Self-hosted push notifications

- [x] Define a versioned protocol for encrypted pairing, connection bootstrap,
      device commands, plugin events, and notification routing.
- [x] Build a loopback-only V2 plugin ingress with a durable sanitized plugin
      retry queue.
- [x] Build a Linux broker with one-time pairing, encrypted device records,
      durable outbox, Expo tickets, receipt checks, retries, and revocation.
- [x] Add QR and manual pairing that tests and saves the exact OpenCode
      connection through a short-lived encrypted broker bootstrap.
- [x] Keep OpenCode credentials and notification keys in separate SecureStore
      services and only opaque pairing metadata in SQLite.
- [x] Register and rotate Expo push tokens and attempt broker revocation when a
      connection is removed or replaced.
- [x] Recover cold and warm notification responses after app unlock, select the
      paired connection, fetch authoritative session metadata, and navigate with
      the exact resolved location.
- [x] Reconcile global forms from their encrypted exact location and ignore
      expired, malformed, unknown, or locally revoked routes.
- [x] Configure the APNs capability, provisioning profile, and push key for the
      EAS project.
- [x] Configure FCM V1 credentials for the EAS project.
- [ ] Verify delivery, cold start, locked-device presentation, duplicate taps,
      token rotation, revocation, tickets, and receipts on physical iOS and
      Android development builds.
- [x] Record redacted physical iOS results in `docs/COMPATIBILITY.md`.
- [ ] Replace direct per-host Expo publishing with a narrow managed relay before
      public distribution.

The beta 18050 plugin context does not expose permission or form snapshot list
operations. Events persisted by the plugin retry through broker restarts, but
requests created before plugin installation and events lost before plugin
storage cannot generate retroactive pushes. Notification taps always reconcile
against OpenCode.

## 10. Composer expansion, files, and source viewing

- [ ] Add native hardware-keyboard commands without changing multiline Enter
      behavior.
- [ ] Add command and skill completion.
- [ ] Add file, agent, and skill mentions.
- [ ] Add phone-file attachments using bounded inline data URLs and server-file
      attachments using server-accessible file URLs.
- [ ] Implement filesystem find, list, and read through generated operations.
- [ ] Build a native file tree with search and breadcrumb navigation.
- [ ] Add bounded text, source, Markdown, image, and unknown-binary previews.
- [ ] Add lazy syntax highlighting with cancellation.
- [ ] Add line selection, copy, share, and attach-to-composer actions.
- [ ] Resolve workspace file asset URLs without exposing credentials in logs or
      external applications.
- [ ] Cache only bounded, non-secret preview data and clear it per connection.
- [ ] Test large files, binary files, unusual encodings, hostile paths, symlinks,
      missing files, and connection changes.

Exit criteria: users can find, inspect, and attach project files without memory
spikes or path/credential leaks.

## 11. Session history, VCS, and worktrees

- [ ] Implement session fork and move.
- [ ] Implement session export/share and import with explicit confirmation.
- [ ] Add compaction controls and status.
- [ ] Add revert stage, clear, and commit workflows.
- [ ] Render session context and instruction entries.
- [ ] Build VCS status and changed-file lists.
- [ ] Build a virtualized unified/split diff viewer with syntax highlighting.
- [ ] Add worktree list, create, remove, and refresh.
- [ ] Confirm destructive VCS/worktree operations with host, project, and path.
- [ ] Test large diffs, binary changes, rename/delete, conflicts, stale state, and
      worktree removal failures.

Exit criteria: common review and workspace-management tasks are safe and usable
without returning to the desktop.

## 12. Terminal and persistent shells

- [ ] Evaluate terminal emulators and any MIT-licensed native module candidate.
- [ ] Document licenses and third-party notices before importing native code.
- [ ] Implement PTY list, create, get, resize/update, and remove.
- [ ] Request short-lived connect tokens and open the PTY WebSocket.
- [ ] Build a native terminal surface with selection, copy/paste, links, colors,
      resize, hardware keyboard, and accessibility fallback.
- [ ] Bound scrollback and replay buffered output after view recreation.
- [ ] Handle network loss, token expiry, backgrounding, and PTY exit.
- [ ] Implement persistent shell list, create, output, timeout, and remove.
- [ ] Add explicit warnings before shell creation or destructive commands.
- [ ] Test high-throughput output, Unicode, resize races, reconnect, and multiple
      terminal sessions.

Exit criteria: terminal and shell sessions remain responsive and recover cleanly
within the limits of the server APIs and mobile lifecycle.

## 13. Integrations and administration

- [ ] Build provider and integration status screens.
- [ ] Implement supported key, OAuth, and command connection flows.
- [ ] Keep callback state and temporary secrets in SecureStore.
- [ ] Implement MCP list, add, remove, connect, disconnect, and resource catalog.
- [ ] Implement saved-permission list and removal.
- [ ] Add reference browsing and web search where the current API supports it.
- [ ] Add read-only configuration and plugin inspection.
- [ ] Add credential update/removal only with explicit confirmation and contract
      support.
- [ ] Exclude experimental debug and V1 migration operations from release paths.
- [ ] Test OAuth cancellation/return, app restart mid-flow, expired attempts,
      malformed server data, and concurrent changes from another client.

Exit criteria: supported server integrations can be inspected and managed
without exposing credentials or depending on undocumented endpoints.

## 14. Native system features

- [ ] Add deep links for connection, project, session, file, and pending request.
- [ ] Add share-sheet input for text, images, and files.
- [ ] Add app quick actions for new session and recent sessions.
- [ ] Add local best-effort completion and blocked-work notifications. Remote
      successful completion is covered by self-hosted push.
- [x] Define and implement the self-hosted push architecture.
- [ ] Add privacy-mode app-switcher shielding.
- [x] Add optional biometric lock.
- [ ] Evaluate widgets and iOS Live Activities only after notification design.
- [ ] Test cold-start links, hostile external input, revoked file access,
      notification races, and locked-device presentation.

Exit criteria: native entry points are secure, lifecycle-aware, and provide a
clear benefit over opening the web application.

## 15. Hardening and release

- [ ] Set performance budgets from an older iPhone and lower-midrange Android
      device.
- [ ] Test large transcripts, tool output, files, diffs, and terminal buffers.
- [ ] Run disconnect testing at every agent-loop and interaction boundary.
- [ ] Verify secrets and sensitive content never enter normal storage, logs,
      crash reports, analytics, deep links, or app-generated screenshots.
- [ ] Complete VoiceOver and TalkBack reviews.
- [ ] Test large text, reduced motion, contrast, keyboard-only tablet use, and
      localization expansion.
- [ ] Add deterministic CI device flows for both platforms.
- [ ] Run the opt-in suite against the exact supported OpenCode beta release.
- [ ] Add dependency, license, privacy-manifest, and mobile security reviews.
- [ ] Configure signed development, preview, and production builds.
- [ ] Prepare icons, splash screens, screenshots, privacy policy, store metadata,
      and support documentation.
- [ ] Document connection setup, LAN/VPN access, authentication, troubleshooting,
      data retention, and limitations.
- [ ] Meet every foundation and 1.0 acceptance criterion in `docs/SPEC.md`.

Exit criteria: signed iOS and Android builds pass security, accessibility,
reliability, performance, and store-readiness checks.

## 16. Later candidates

- [ ] Multiple simultaneous live server connections.
- [ ] Managed publisher relay for public distribution.
- [ ] Widgets and richer Live Activities.
- [ ] Certificate pinning per connection profile.
- [ ] End-to-end encrypted connection-profile transfer between devices.
- [ ] Additional high-value tool-specific renderers.
- [ ] Safe configuration editing when the V2 contract supports validation.
