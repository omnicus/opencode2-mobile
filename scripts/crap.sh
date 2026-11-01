#!/usr/bin/env bash
# Score every function with crapper (https://github.com/unclebob/crapper).
# Extra arguments go to crapper, for example a path filter or --threshold 30.
set -euo pipefail

crapper_commit=6fd92c4c9bcc56efb64a2f8743d5a2993bcfd42d

if ! command -v uvx >/dev/null; then
  echo "crapper runs through uvx. Install uv: https://docs.astral.sh/uv/" >&2
  exit 1
fi

# crapper scores every function at 0% when its coverage command fails, so
# generate the reports here and stop on a failing test instead.
measure=1
for arg in "$@"; do
  case "$arg" in
    --no-coverage | --use-existing-coverage | --coverage-command) measure=0 ;;
  esac
done
coverage=()
if [ "$measure" = 1 ]; then
  pnpm coverage
  coverage=(--use-existing-coverage)
fi

# Vitest and Jest write source paths relative to their package, so three
# packages report src/index.ts. Each report sits under coverage/<package>/;
# prefix its relative paths with that directory so crapper can match them.
if [ -d coverage ]; then
  find coverage -name lcov.info | while IFS= read -r report; do
    dir=${report#coverage/}
    dir=${dir%lcov.info}
    awk -v dir="$dir" '
      /^SF:/ && substr($0, 4, 1) != "/" && index($0, "SF:" dir) != 1 {
        $0 = "SF:" dir substr($0, 4)
      }
      { print }
    ' "$report" >"$report.tmp"
    mv "$report.tmp" "$report"
  done
fi

exec uvx --from "git+https://github.com/unclebob/crapper@$crapper_commit" crapper \
  ${coverage[@]+"${coverage[@]}"} "$@" \
  apps/mobile/src \
  apps/mobile/plugins \
  apps/notification-broker/src \
  packages/notification-protocol/src \
  packages/opencode-adapter/src \
  packages/opencode-notification-plugin/src \
  scripts
