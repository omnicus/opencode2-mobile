#!/usr/bin/env bash
set -euo pipefail

tool_dir=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mobile-gitleaks.XXXXXX")
trap 'rm -rf "$tool_dir"' EXIT
curl --fail --location --silent --show-error \
  --output "$tool_dir/gitleaks.tar.gz" \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  $tool_dir/gitleaks.tar.gz" | sha256sum --check
tar -xzf "$tool_dir/gitleaks.tar.gz" -C "$tool_dir" gitleaks
"$tool_dir/gitleaks" git . --redact --no-banner --config .gitleaks.toml
