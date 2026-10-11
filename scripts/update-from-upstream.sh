#!/usr/bin/env bash
# Alexander's fork: bring in the upstream author's new versions.
# Fetches yusuf8834/bb-sidebar, rebases branch alexander/main on it, runs the
# full check, then installs a frozen release of the new commit through Git-Local's
# release-plugin.sh (~/.bb/plugin-releases/bb-sidebar/<sha>; never this live
# checkout). Stops on any conflict or red check and leaves the installed plugin untouched.
#   --dry-run  rebase and check only; do not reinstall.
set -euo pipefail
cd "$(dirname "$0")/.."
branch=alexander/main
[ "$(git branch --show-current)" = "$branch" ] || { echo "switch to $branch first" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean" >&2; exit 1; }
before=$(git rev-parse HEAD)
git fetch origin
if ! git rebase origin/main; then
  git rebase --abort
  echo "conflict with upstream; nothing installed (still at $before)" >&2
  exit 1
fi
npm ci
if ! npm run check; then
  echo "check failed after rebase; nothing installed. Undo with: git reset --hard $before" >&2
  exit 1
fi
[ "${1:-}" = "--dry-run" ] && { echo "dry run ok: $(git log --oneline -1 origin/main)"; exit 0; }
release=${BB_RELEASE_SCRIPT:-$HOME/Documents/Git-Local/00-core/bb-plugins/release-plugin.sh}
"$release" --probe 'bb plugin list | grep -A4 "^bb-sidebar@" | grep -q "schedule auto-settle"' "$PWD" HEAD
git push --force-with-lease fork "$branch"
echo "installed: $(git log --oneline -1)"
