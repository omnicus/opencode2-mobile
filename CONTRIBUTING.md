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

## CRAP scores

`pnpm crap` scores every function with
[crapper](https://github.com/unclebob/crapper):
`CRAP = CC² × (1 − coverage)³ + CC`. It runs `pnpm coverage` first, which
fails the run if any test fails, then prints the worst functions first and
writes `.metrics/crap.edn`. Below 5 is low risk and above 30 needs tests or a
split. It needs [uv](https://docs.astral.sh/uv/) and Python 3.11 or later.

```sh
pnpm crap                         # coverage, then scores
pnpm crap --use-existing-coverage # reuse the reports in coverage/
pnpm crap --no-coverage           # complexity only
pnpm crap --changed               # files git reports as added or modified
pnpm crap screens                 # paths containing "screens"
pnpm crap --threshold 30          # exit 2 when the worst score is higher
```
