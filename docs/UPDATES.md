# Automatic compatibility updates

The mobile app can receive JavaScript compatibility fixes through EAS Update.
GitHub Actions checks stable OpenCode V2 releases, tests candidate upgrades, and
publishes compatible updates to the `preview` channel. Neither publication nor
the phone's update check needs a connection to your OpenCode server.

## Release workflow

`Follow OpenCode releases` runs hourly, subject to GitHub's scheduling delays.
You can also run it from the repository's Actions page on a phone.

1. Look up the npm `latest` release of `@opencode/client`. Accept stable `2.x.x`
   versions only, and require the matching `@opencode/cli` release to exist.
2. Create or resume `automation/opencode-<version>` and its pull request. Update
   the pinned client, adapter diagnostic version, and lockfile.
3. Run the repository checks and Expo Doctor. Run the opt-in contract suite
   against both the previously supported server and the candidate server.
4. Merge the exact tested candidate if checks pass and the base branch has not
   changed. Repository branch rules still apply.
5. Run `Publish mobile update` against the merged commit. This repeats validation
   on the merged tree, tests its matching server, compares native fingerprints,
   and publishes an EAS Update for both platforms.

The contract suite starts a disposable, authenticated server with isolated home,
configuration, data, and cache directories. It checks scoped snapshots, prompt
admission, a completed assistant transcript, pagination, event streaming and
cancellation, permissions, and forms. A loopback model fixture supplies responses
without a paid provider or user credentials. The suite never attaches to your
shared service. Normal `pnpm test` remains deterministic and network-free.

Successful publication moves the `mobile-preview-published` tag to the published
commit. If the client is already current but `main` has not been published, the
next release check retries publication. This also ships merged JavaScript fixes
between upstream releases. A run will not publish an older commit over current
`main`. GitHub serializes publications.

## One-time publishing setup

Merge these workflows into `main`; scheduled workflows run from the default
branch. In GitHub's Actions settings, allow workflows to create pull requests.
The upgrade workflow uses the built-in `GITHUB_TOKEN` to create branches, report
checks, and merge passing candidates.

Keep the ordinary CI checks `check` and `secrets` required in branch protection.
GitHub does not start push or pull-request workflows for `GITHUB_TOKEN` pushes,
so the upgrade workflow creates those same check runs on the exact candidate
commit with the GitHub Actions token. It reports each check's actual validation
result, including failures and cancellations. It also reports `Mobile
compatibility` after testing the previous and candidate servers. Automatic merge
still requires those contract tests to pass and the base branch to be unchanged.

Create a GitHub environment named `mobile-updates` with:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `EXPO_TOKEN` | An Expo access token with access to this app's EAS project |
| Variable | `OPENCODE2_MOBILE_EXPO_PROJECT_ID` | The EAS project used by the installed app |
| Variable | `OPENCODE2_MOBILE_APP_SLUG` | The EAS project's slug, required when different from `opencode2-mobile` |
| Variable | `MOBILE_RUNTIME_VERSION` | The installed runtime, currently `0.1.4` |
| Variable | `MOBILE_IOS_NATIVE_HASH` | iOS fingerprint from the installed build's native-compatible source |
| Variable | `MOBILE_ANDROID_NATIVE_HASH` | Android fingerprint from that source |

Configure the deployment's identifiers and other build configuration in the EAS
`preview` environment as described in [Deployment configuration](CONFIGURATION.md).
The workflow loads that environment for fingerprinting and publication. It
disables ignored local deployment files. EAS resolves the project before loading
its environment, so the GitHub project ID and slug must already match the EAS
project.

If Android uses Firebase, set the `GOOGLE_SERVICES_JSON` file variable to
**Sensitive** visibility in `preview`. Secret file variables are available only
to EAS Build. The pinned EAS CLI's `env:exec` does not download files, so the
workflow first runs `env:pull`, copies the downloaded Firebase client file to
`apps/mobile/google-services.json`, and passes that stable relative path to both
fingerprinting and publication. It stops if the file is declared but unavailable.
Downloaded files and environment values remain ignored by Git.

Generate the baseline from a clean checkout matching the signed builds' native
code and configuration. Install the pinned dependencies first. From
`apps/mobile`, export your EAS project ID and slug, then download the preview
configuration:

```sh
export OPENCODE2_MOBILE_EXPO_PROJECT_ID=your-project-uuid
export OPENCODE2_MOBILE_APP_SLUG=your-project-slug
export OPENCODE2_MOBILE_DISABLE_LOCAL_DEPLOYMENT=1
pnpm dlx eas-cli@22.4.0 env:pull preview --path .env.preview --non-interactive
node ../../scripts/prepare-mobile-deployment.mjs .env.preview
```

For a deployment with Firebase, export the prepared file path:

```sh
export GOOGLE_SERVICES_JSON=./google-services.json
```

Then calculate the native baseline:

```sh
pnpm dlx eas-cli@22.4.0 env:exec preview \
  'cd ../.. && pnpm mobile:runtime' --non-interactive
```

Copy the three printed values into the GitHub environment variables. The command
prints hashes and the runtime only. It does not export the fingerprint's source
contents. Use the pinned Node and pnpm versions and the same Linux environment
as CI for reproducible baselines. The script includes pnpm-linked native package
sources that Expo SDK 54's default nested-dependency exclusion would omit.

The baseline records compatibility with the installed native build. Do not
replace it just to clear a failed publication check. A native dependency, config
plugin, permission, or Expo SDK change requires a new app version and signed
builds. Record new baselines after establishing that native build's configuration.

Once configured, run **Publish mobile update** from GitHub Actions with `main`
to deliver the in-app updater to the existing compatible preview builds. The
existing EAS launch check can download this first update. Reopen the app to load
it, then use the new update controls for later releases.

## Cloud repair for breaking changes

A failed upgrade stays in its PR with a link to the failing run. Publication
stops. Dependency bumps cannot repair every changed endpoint or response shape.

To enable an automatic repair attempt:

- Set the repository variable `OPENCODE_REPAIR_MODEL` to an available OpenAI model
  reference such as `openai/<model-id>`.
- Create the GitHub environment `mobile-repair` and add `OPENAI_API_KEY` as a
  secret there.

`Repair OpenCode compatibility` then runs OpenCode in a disposable cloud runner
using that model. It can edit mobile, adapter, and fixture source and integration
tests. The repair command receives the model key, but no GitHub or Expo token.
Only the later commit step receives a GitHub token. Raw agent output stays in the
ephemeral runner and is not uploaded as an artifact.

There is at most one automatic repair attempt per target release, with a
20-minute agent timeout. A PR comment records the attempt before the model starts,
so a timeout or rejected patch does not start another paid attempt every hour.
The job commits an allowed attempt to the existing PR, even
when it could not complete a fix. The next scheduled release check independently
validates that branch. A failed repair remains available for further work; it
does not become an app update. Model usage is billed to the configured API key.

## Phone behavior

- Check after native startup and on foreground, at most once every 15 minutes
  for automatic JavaScript checks. Expo's existing native cold-start check also
  remains enabled.
- Download a compatible update without interrupting the current session.
- Show **Restart to apply update** when the download is ready.
- Save mounted session drafts and await pending draft writes before reloading.
  A save failure keeps the current app open. Drafts remain encrypted in SQLite.
- Offer **Check for app updates** in Settings, Connections, incompatible or
  unavailable workspace cards, and the root render-error fallback.
- Handle EAS rollback-to-embedded directives through the same download and
  explicit restart flow.

Manual checks bypass the foreground throttle. Offline and update-service errors
are retryable and do not disconnect OpenCode. Expo Go and ordinary development
builds show that signed-build updates are unavailable. Native-runtime matching
is independent of the OpenCode server version.

## Run the contract suite locally

Install a disposable CLI outside the repository, then point the suite at it:

```sh
npm install --prefix /tmp/opencode/mobile-contract-cli \
  --no-audit --no-fund @opencode/cli@2.0.4
OPENCODE_TEST_BINARY=/tmp/opencode/mobile-contract-cli/node_modules/.bin/opencode \
  OPENCODE_TEST_VERSION=2.0.4 TMPDIR=/tmp/opencode \
  pnpm --filter @opencode2-mobile/opencode-adapter test:integration
```

Set the version to the server release under test. The suite typechecks its
integration code before starting a server. It currently runs on Linux CI; its
process-group cleanup assumes a POSIX host.

## Verification still needed on devices

Cloud contract tests use Node networking. They cannot certify Hermes streaming,
native update installation, or lifecycle behavior on iOS and Android. Verify the
first updater release on signed devices, including an offline check, an update
while OpenCode is incompatible, saving a newly edited draft before restart, and
reopening into the downloaded update. Record redacted results in
[Compatibility results](COMPATIBILITY.md).
