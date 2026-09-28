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
