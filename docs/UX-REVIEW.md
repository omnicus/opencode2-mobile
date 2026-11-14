# Mobile UX consistency review

Reviewed September 28, 2026 against merged PR #33, `feat(mobile): improve
transcript hierarchy and approval cards`.

## Scope and evidence

This is a source-level review of every implemented mobile route, shared sheet,
and supporting startup state. It covers typography, colors, hierarchy, spacing,
controls, loading and recovery, and large-text layout constraints. The intended
user is someone managing OpenCode sessions from a phone, with quick access to
blocked work and a readable transcript.

PR #33 supplies the visual baseline: black page backgrounds, charcoal cards,
white primary actions, muted supporting text, green code, violet reasoning, and
amber permission headings. The changes keep the foundation dark theme specified
in `SPEC.md`.

No native device or emulator was available for this review. Source inspection,
component tests, calculated color contrast, and Hermes exports do not establish
actual VoiceOver, TalkBack, keyboard, or large-text rendering on devices.

## Findings and changes

| Area | Finding | Change |
| --- | --- | --- |
| Typography | Management screens used 9–11 point labels with 800–900 weights and wide tracking, unlike PR #33's readable semibold controls. | Added shared title, sheet title, heading, body, control, caption, label, and code styles in `apps/mobile/src/theme.ts`. Applied them across the screens below. |
| Code | Permission details used Menlo on iOS while transcript code and diffs requested generic monospace. | Shared platform code style for permission resources, transcript commands and output, fenced code, diffs, pairing codes, and connection diagnostics. Inline code inherits the surrounding text size. |
| Color meaning | Forms and admission cards used prominent amber borders and black backgrounds; ordinary Settings labels also used amber. | Neutral charcoal cards and borders, amber attention headings, muted informational labels. Preserved PR #33's code and reasoning accents. |
| Switches | Settings mixed native default colors with two custom treatments. Connections used another treatment. | Shared neutral track and thumb colors for transcript, reasoning, app lock, notifications, and HTTP settings. |
| Buttons | Primary and secondary controls differed in height, corner radius, padding, and label weight across management screens. | Shared 48 point minimum, 12 point radius, padded semibold controls. Forms now have a white Submit action and a secondary destructive action. |
| Touch targets | Connection Edit/Remove and transcript text actions had 40 point minimums. Queue/steer controls also used 40. | Raised compact actions to at least 44 points and queue/steer to 48. |
| Large text | New-session heading and Cancel competed in a row; boolean form choices could overflow; the custom iOS header had a fixed height. | New-session header stacks at the existing large-text threshold. Boolean choices wrap. Custom header can grow vertically. |
| Pairing feedback | Disabled scan/check controls retained their enabled appearance; the pairing input lacked an explicit accessible label. | Added disabled styling and accessibility state, a named input, and a stable busy-state pairing label that preserves HTTP approval wording. |
| Recovery | Followed projects showed only an error message on load failure and no explanation for an empty project list. | Added Retry and a descriptive empty state with Refresh. Component tests exercise both actions. |
| Keyboard appearance | Search, form, and composer inputs did not all request the same iOS keyboard appearance. | All implemented text inputs now request the dark keyboard. |
| Permission details | PR #33's explanatory copy did not identify its client authorship. | Restored an explicit OpenCode Mobile explanation label in Details. |

## Screen coverage

| Screen or shared UI | Review result |
| --- | --- |
| Sessions inbox, search, project filters, child rows | Kept the lightweight feed hierarchy, project identity, status text, and attention ordering. Standardized badges, section labels, and sheet row headings. |
| Session transcript | Kept 17 point reading text and existing live-follow behavior. Unified code fonts and reduced heavy activity, reasoning, user, and subagent labels. |
| Composer, agent/model pickers, completion list | Kept PR #33's collapsed composer alignment and native multiline sizing. Standardized picker/completion headings, increased queue/steer targets, and aligned keyboard appearance. |
| Execution, admission, and inbox panels | Neutral admission cards, shared action typography and sizing, wrapping inbox headings. State labels still distinguish delivery, execution, and attention. |
| Permission cards and Details | Kept PR #33's shared card in both session and Needs you. Adopted shared font/control tokens and added Details press feedback and explanation attribution. Full resources and saved patterns remain selectable in Details. |
| Forms, including external, numeric, boolean, and multiselect fields | Matched permission card colors and radius, clearer primary Submit action, readable field labels and errors, wrapping boolean choices. |
| Needs you | Uses the same permission and form components as session detail. Shared shell headings and buttons now follow the same hierarchy. |
| New session and location/worktree choice | Shared sheet title, readable project headings and section labels, stacked large-text header, consistent secondary button. |
| Followed projects | Shared title and project-card typography, consistent ordering controls, explicit empty and retry states. |
| Connections, profile editing, onboarding, and transport diagnostics | Reduced oversized title and heavy small labels. Human-entered text uses the system UI font; diagnostics remain monospace. Aligned primary/secondary controls and switches. |
| QR/manual pairing and pairing preview | Shared heading/control typography, neutral preview card, visible disabled states, accessible input and busy action. |
| Settings and support export | Shared card headings, quieter category labels, consistent switches and action buttons, 16 point settings-card padding. |
| Current changes/diff | Shared code font and readable status/headings. Kept added/removed colors, backgrounds, and textual diff prefixes. |
| Navigation menu and shared modal sheets | Shared menu headings, sheet titles, caption line heights, and Done control typography. Existing large-text modal stacking remains in place. |
| App updates and restart overlay | Update card uses the same charcoal border/radius treatment, shared heading/body styles, and control labels. |
| App lock and local render/storage states | Shared title, label, and action typography. Preserved explicit error and recovery messages. |

## Measured text contrast

Ratios use WCAG relative luminance from the opaque theme colors. These are text
color checks, not certification of the complete interface or disabled states.

| Text | Black page | Charcoal card | Raised panel |
| --- | --- | --- | --- |
| Main text | 18.10:1 | 15.88:1 | 13.38:1 |
| Muted text | 8.03:1 | 7.04:1 | 5.94:1 |
| Error | 7.67:1 | 6.73:1 | 5.67:1 |
| Attention | 13.35:1 | 11.71:1 | 9.86:1 |
| Success | 12.06:1 | 10.58:1 | 8.92:1 |
| Link | 9.96:1 | 8.74:1 | 7.37:1 |
| Code | 12.89:1 | 11.31:1 | 9.53:1 |
| Reasoning | 11.38:1 | 9.98:1 | 8.41:1 |

## Automated verification

- `fnm exec --using=26.7.0 pnpm check` passed lint, typecheck, tests, and build.
- All 343 mobile tests passed across 55 suites, including the two new
  followed-project recovery cases. The transcript inline-code assertion now
  expects Menlo on the test runner's iOS platform.
- Both iOS and Android Hermes bundles exported successfully.
- `fnm exec --using=26.7.0 pnpm native:doctor` passed all 18 checks.
- The test run still emits non-failing React `act` warnings for asynchronous
  icon loading and WorkingIndicator updates.

## Follow-up: unavailable historical locations

Needs you now offers **Review locations** alongside Retry. The details sheet
shows each failed directory and optional workspace, its project, which checks
failed, and whether the location came from a project root, a registered worktree,
session history, or discovery. Paths are selectable, remain in memory, and are
excluded from the support report.

The server can return a generic HTTP 500 for a removed directory. The app does
not treat that response alone as proof of deletion. It explains the possible
removed-worktree case and offers project management without deleting sessions
or silently marking failed locations reconciled. Successful checks still display
their requests. Retrying clears the failure details when those checks recover.

Regression tests exercise historical and project-root failures, partial success
between forms and permissions, recovery, and opening the details sheet with or
without known pending requests.

Historical directories beneath a live project root now have a presence check
before attention requests. A successful parent-directory listing that omits the
directory lets the app exclude it from attention coverage. Current project roots
and registered worktrees remain checked, as do locations with active sessions,
event or notification activity, a current selection, or cached pending requests.
Session history remains available. Refresh and reconciliation check presence
again, so restored directories return to coverage. Failed or malformed listings
do not count as proof of removal. Locations outside the project root remain
checked because this probe cannot establish their absence.

## Council design review, November 2026

Three reviewers from different model providers audited every screen, sheet, and
menu from source, then reviewed phone-sized web-preview screenshots in later
rounds. The owner also supplied screenshots of the official OpenCode iOS app as
a quality bar. Its visual patterns were adopted where they fit existing
features; its other features were left out.

| Reviewer | Round 1 | Round 2 | Round 3 | Round 4 | Round 5 | Round 6 | Round 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Opus | 6.5/10 | 7.5/10 | 8.3/10 | 8.6/10 | 8.3/10 | 8.8/10 | 9.0/10 |
| GPT Sol | 7.2/10 | 8.3/10 | 8.8/10 | 9.0/10 | 8.8/10 | 9.1/10 | 9.5/10 |
| Gemini | 7.6/10 | 8.9/10 | 9.5/10 | 9.6/10 | 9.6/10 | 9.9/10 | 9.9/10 |

All three were satisfied after round 4. Rounds 5 to 7 widened the review to the
composer, buttons, colors, and running subagents. Round 5 scores dropped where
the new scope exposed gaps. All three were satisfied again after round 7.

### Changes

- **Design tokens:** `palette.selected` is the one fill for a chosen tab,
  option, or row. Previously the selected fill matched the card and was
  invisible. Ripple, floating shadow, and icon-tile tokens live in `theme.ts`.
- **Pickers:** Agent, variant, model, and pull request filter sheets share one
  row style. The composer toolbar reads agent, model, then variant, with no
  chip borders. The Variant chip is hidden for models without variants. A
  visible Steer or Queue label sits beside send while a run is active.
- **Transcript:** Expandable rows share one chevron and press feedback. Failed
  tools are red and interrupted ones amber. Code comments are easier to read,
  and the code block header has no dead band. Several images form a grid.
  Transcript and session load failures offer Retry.
- **Inbox:** Archived rows keep the specified 50% fade, but their quiet text
  starts brighter so the result clears 4.5:1. Working rows show the working
  indicator at full strength; a 70% fade made them read as archived. Header icons match, attention dots sit on their icons, and search
  has an empty state.
- **Approvals:** Each pooled request names its project and session. Permission
  cards lead with the action. Reject shows its wider effect before the button,
  as section 10.4 of the spec requires. The Details sheet pins its actions.
  Form and permission actions share one order. Invalid fields get a danger
  border, and the Needs you empty state matches the other tabs.
- **Sheets and full-screen states:**
  - Modal headers share a height and divider.
  - Done closes a sheet; Cancel appears only where closing discards input.
  - The delete confirmation names the server, project, and path.
  - App lock, storage failure, and the render error screen share a scrolling
    layout.
- **Management screens:**
  - Settings rows have icon tiles and show their current value; a version
    footer ends the screen.
  - The session header names the project under the title.
  - A pairing review replaces the capture controls.
  - The connection editor scrolls into view when it opens.
  - Dev tools errors read as errors.

### Rounds 5 to 7: composer, buttons, color, and subagents

- **Composer:** When expanded, Send joins the bottom toolbar so the text gets
  the full width. The model and variant read as one phrase, and only the agent
  keeps a chevron.
- **Buttons:** Buttons are capsules. Secondary and danger buttons are filled,
  and pressed buttons change their fill instead of fading their label.
  "Always allow" is an outlined capsule, quieter than Reject and Allow once.
- **Palette:** The palette is a subtly cool slate dark with soft pastel
  accents, merged from three proposals. Working is one blue everywhere. Every
  text color clears 4.5:1 on each surface it is used on, and the native root
  background matches the app.
- **Subagent cards:** Each card has two lines: a state glyph and the title,
  then "@agent · Background · state · elapsed". The border stays neutral and
  turns amber only when the child needs you. A result appears only once one
  exists; a launch acknowledgement never becomes a result.
- **Subagent states:**
  - Preparing, Running, Needs approval, Needs answer, Completed, Interrupted,
    and Failed.
  - A pending permission or form anywhere in the followed projects marks its
    child as needing you.
  - A child that only drops out of the active list reads as Finished, never as
    Completed.
- **Monitor:** The chip counts every live child, foreground and background,
  and says how many need you. The sheet lists Needs you, Working, and Finished.
  Rows open the child. Working rows offer a confirmed Stop that refreshes
  server state and stays Stopping until the child leaves Working. When the
  session is disconnected or messages fail, the sheet keeps the last known
  rows and drops Stop.
- **Subagent sessions:** The header reads "Subagent · project", the title drops
  the agent suffix, and back says it returns to the parent session.

### Verification

- `pnpm check` passed after round 7: lint, typecheck, 1526 tests in 114
  suites, and iOS and Android Hermes exports.
- `pnpm native:doctor` passed all 18 checks.
- Screenshots came from a react-native-web build in a separate scratch clone.
  They are not native renders: fonts, switches, sheet presentation, and the
  iOS header branch differ from devices.

The device checks below still apply. Also check Android header title
alignment, the iOS 26 glass header with the project subtitle, and controls
that rely on hit slop: compact segmented controls and the copy icon. Confirm
on a real server that stopping a subagent ends its run and that the monitor
row leaves Stopping.

## Device follow-up

Before calling the visual review device-verified, check both iOS and Android:

- Small phone width and maximum supported accessibility text size, especially
  Settings switches, connection profile actions, pairing previews, and startup
  recovery screens.
- Form and permission actions with long content, visible keyboard, and multiple
  pending requests. Confirm scrolling reaches every action.
- VoiceOver and TalkBack focus order, selected controls, busy announcements,
  and focus return after closing Details or a picker.
- Keyboard appearance and safe-area spacing in search, pairing, forms, and the
  expanded composer. Android keyboard colors remain keyboard-app controlled.
- Native switch rendering, reduced-motion behavior, and the growing custom iOS
  header on supported OS versions.

Record actual device observations in `COMPATIBILITY.md`. The existing open
accessibility and device-validation tasks in `TODO.md` still apply.
