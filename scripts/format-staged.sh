#!/bin/sh
# Pre-commit formatter: run Prettier over staged files, honoring .prettierignore.
#
# Replaces `pretty-quick --staged`, which force-formats every staged file and
# ignores .prettierignore — so it crashes on our binary MPEG-TS test fixtures
# that share the `.ts` extension with TypeScript. Prettier (invoked directly)
# respects .prettierignore, so those fixtures are skipped cleanly.
set -e

staged=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$staged" ] && exit 0

# --ignore-unknown: skip files Prettier has no parser for.
# .prettierignore (auto-loaded) excludes tests/fixtures, dist, etc.
printf '%s\n' "$staged" | xargs npx prettier --ignore-unknown --write

# Re-stage whatever Prettier reformatted.
printf '%s\n' "$staged" | xargs git add
