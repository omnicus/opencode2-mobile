# Contributing

Use Node 26.7.0 and pnpm 11.21.0 as pinned by the repository. Node 26 does not
bundle Corepack. Install the pinned pnpm release if needed, then verify the
project:

```sh
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
pnpm check
pnpm native:doctor
```

Keep changes focused and include deterministic tests for contract, storage,
lifecycle, or routing behavior. Normal tests must not require a real server,
provider credentials, or network access.

Do not commit local deployment config, `.env` files, Firebase client files,
signing material, credentials, addresses, pairing codes, user content, generated
native projects, or broker state. Use
`apps/mobile/config/deployment.example.json` and sanitized fixtures.

Read `docs/SPEC.md` and the relevant section of `TODO.md` before making
architectural changes.
