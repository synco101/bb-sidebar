# Alexander's fork of bb-sidebar

Branch `alexander/models` = upstream `origin/main` (yusuf8834/bb-sidebar) plus:

- `src/ProjectModelsDialog.tsx` (+ test): models for the dev pipeline per project. Gear on each
  project group header (on hover), gear next to the project scope picker (All projects = defaults),
  and "Models…" in the project right-click menu. Data lives in the separate `model-routing` plugin
  (`~/Documents/Apps/bb-plugin-model-routing`), called through `sdk.plugins.callRpc`.
- Small touch points in `src/ThreadInbox.tsx` and `src/ProjectContextMenu.tsx`.

Installed into BB from this checkout (`path:` source), so it no longer auto-updates.
To take upstream's new versions: `scripts/update-from-upstream.sh` (`--dry-run` to only rebase and test).
Back to upstream: `bb plugin install git:https://github.com/yusuf8834/bb-sidebar.git@semver:^0.2.0 --yes`.
