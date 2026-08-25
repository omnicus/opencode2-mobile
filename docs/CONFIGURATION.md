# Deployment configuration

opencode2-mobile keeps deployment identity and service files outside version control.
The tracked `app.config.ts` has generic defaults so Expo Go, tests, and exports
work in a clean clone. Signed builds and remote push notifications require a
deployment-specific configuration.

App identifiers and Firebase client configuration are embedded in a compiled
application and are not secrets. They remain untracked so forks can use their
own accounts and identifiers without editing source files.

## Local configuration

Copy the deployment example into the ignored local configuration directory:

```sh
mkdir -p apps/mobile/config/local
cp apps/mobile/config/deployment.example.json \
  apps/mobile/config/local/deployment.json
```

`app.config.ts` reads `config/local/deployment.json` directly. Git ignores the
entire `config/local` directory. Set unique values before creating signed
builds.

EAS CLI intentionally does not load `.env` files while resolving app config and
the linked EAS project. Keeping local project metadata in this ignored JSON file
allows `eas build`, `eas env:*`, and Expo CLI commands to resolve the same local
identity. Environment variables still take precedence when EAS provides them.

| Variable | Purpose | Required |
| --- | --- | --- |
| `OPENCODE2_MOBILE_APP_NAME` | Installed display name | No; defaults to `OpenCode2 Mobile` |
| `OPENCODE2_MOBILE_APP_SLUG` | Expo project slug | No; defaults to `opencode2-mobile` |
| `OPENCODE2_MOBILE_APP_SCHEME` | Deep-link URL scheme | No; defaults to `opencode2mobile` |
| `OPENCODE2_MOBILE_EXPO_OWNER` | Expo account that owns the EAS project | EAS only |
| `OPENCODE2_MOBILE_EXPO_PROJECT_ID` | EAS project UUID and Expo push project ID | EAS Update and push |
| `OPENCODE2_MOBILE_IOS_BUNDLE_IDENTIFIER` | Unique iOS application identifier | Signed iOS builds |
| `OPENCODE2_MOBILE_ANDROID_PACKAGE` | Unique Android application ID | Signed Android builds |
| `OPENCODE2_MOBILE_ALLOW_DEVELOPMENT_HTTP` | Enables native cleartext transport when `true` | No; defaults to `false` |
| `GOOGLE_SERVICES_JSON` | Local path to the Firebase Android client file | Android remote push |

Without deployment variables, the app uses `dev.opencode2.mobile` for both native
identifiers, disables EAS Update and cleartext transport, and omits Firebase
configuration. This mode is intended for Expo Go, tests, and initial
development.

The native identifiers also namespace SecureStore services. Do not change them
after distributing an app unless a credential and draft-key migration is part
of the same release.

## EAS project

Create an Expo account and EAS project owned by that account. Use the project
owner and UUID in `config/local/deployment.json`. Dynamic app config cannot
safely invent or share these values between unrelated deployments.

Create the EAS project in the Expo dashboard before filling the local project
UUID. This avoids asking EAS CLI to rewrite the dynamic app config. Each EAS
build profile then selects an explicit EAS environment:

- `development` and `development-simulator` use `development`.
- `preview` uses `preview`.
- `production` uses `production`.

Create the public build metadata as project-scoped plain-text variables in each
environment. For example:

```sh
cd apps/mobile
pnpm dlx eas-cli@22.4.0 env:set \
  --name OPENCODE2_MOBILE_EXPO_OWNER --value your-account \
  --environment development preview production --visibility plaintext
pnpm dlx eas-cli@22.4.0 env:set \
  --name OPENCODE2_MOBILE_EXPO_PROJECT_ID --value your-project-uuid \
  --environment development preview production --visibility plaintext
pnpm dlx eas-cli@22.4.0 env:set \
  --name OPENCODE2_MOBILE_IOS_BUNDLE_IDENTIFIER \
  --value com.example.opencode2mobile \
  --environment development preview production --visibility plaintext
pnpm dlx eas-cli@22.4.0 env:set \
  --name OPENCODE2_MOBILE_ANDROID_PACKAGE \
  --value com.example.opencode2mobile \
  --environment development preview production --visibility plaintext
```

Set `OPENCODE2_MOBILE_APP_NAME`, `OPENCODE2_MOBILE_APP_SLUG`, and
`OPENCODE2_MOBILE_APP_SCHEME` the same way when a deployment changes the tracked
defaults. These values are public because the compiled app exposes them.

Keep `OPENCODE2_MOBILE_ALLOW_DEVELOPMENT_HTTP=false` for Internet-facing and production
builds. Set it to `true` only when users must connect through explicitly approved
HTTP on a trusted LAN or an encrypted overlay such as Tailscale. The app still
requires per-connection approval, but native policy must also permit the
transport.

Use the same EAS environment for a build and its updates. The preview update
command is:

```sh
pnpm dlx eas-cli@22.4.0 update --channel preview --environment preview \
  --message "Describe the update"
```

Development-simulator updates use the simulator channel with the development
environment:

```sh
pnpm dlx eas-cli@22.4.0 update \
  --channel development-simulator --environment development \
  --message "Describe the update"
```

## Firebase and FCM V1

Create a Firebase project and register an Android application whose package
exactly matches `OPENCODE2_MOBILE_ANDROID_PACKAGE`. Download its `google-services.json` to
`apps/mobile/google-services.json`. Git ignores this file.

Restrict the Firebase client API key to the Android package, signing certificate,
and APIs the app needs. The file is public client metadata, but restrictions
limit misuse by unrelated applications.

Upload the file to every EAS environment that builds Android:

```sh
cd apps/mobile
pnpm dlx eas-cli@22.4.0 env:set \
  --name GOOGLE_SERVICES_JSON --value ./google-services.json \
  --type file --visibility secret \
  --environment development preview production
```

The resulting EAS variable contains a build-runner file path. `app.config.ts`
uses that path instead of requiring the local ignored file in cloud builds.

FCM V1 sending credentials are different from `google-services.json`. Create a
dedicated Firebase service account with the narrow required FCM role and upload
its private key through EAS Android push credentials. Never put that key in an
environment file or this repository.

Configure APNs signing through EAS iOS credentials. Never store APNs `.p8`
files, provisioning profiles, distribution certificates, or passwords in Git.

## Secrets

Do not place any of the following in Expo app config, `EXPO_PUBLIC_*` variables,
or tracked files:

- OpenCode usernames, passwords, or bearer tokens
- Firebase service-account keys
- APNs private keys or signing credentials
- Broker master keys, plugin tokens, databases, or pairing codes
- Expo access tokens

OpenCode credentials belong in the app's SecureStore-backed connection flow.
Broker secrets belong in the broker state directory created by its `init`
command. EAS and Firebase credentials belong in their respective credential
stores.

## Public release artifact

Build source archives from tracked files, not from the working directory. This
prevents ignored Firebase and deployment files from entering an archive:

```sh
pnpm check:public
git archive --format=tar.gz --output=opencode2-mobile-source.tar.gz HEAD
```

`check:public` fails if a known deployment, signing, or environment file enters
the Git index. CI also scans the full Git history with Gitleaks.

## Verify resolved config

Inspect only the public values that Expo will embed:

```sh
cd apps/mobile
pnpm exec expo config --type public
```

Run the same command with `OPENCODE2_MOBILE_DISABLE_LOCAL_DEPLOYMENT=1` to verify
that a clean clone still resolves with generic defaults.
