# Alexander's fork of bb-sidebar

Branch `alexander/main` = upstream `origin/main` (yusuf8834/bb-sidebar) plus:

- `src/ProjectModelsDialog.tsx` (+ test): models for the dev pipeline per project. Gear on each
  project group header (on hover), gear next to the project scope picker (All projects = defaults),
  and "Models…" in the project right-click menu. Data lives in the separate `model-routing` plugin
  (`~/Documents/Apps/bb-plugin-model-routing`), called through `sdk.plugins.callRpc`.
- Small touch points in `src/ThreadInbox.tsx` and `src/ProjectContextMenu.tsx`.
- Archive restored: upstream removed it in `bbe5175`; this branch reverts that commit's archive part
  but keeps upstream's settle-Undo lifecycle fix (`src/useLifecycle.ts` is upstream's; `src/server.ts`
  differs from upstream only by the `archiveThreads`/`unarchiveThread` RPCs and the
  `archivedShelfEnabled` setting).

## Fork features and the tests that guard them

`scripts/update-from-upstream.sh` runs `npm run check`; a red test stops the update.

| Feature | Guarding tests |
|---|---|
| Archive: Archived shelf (filter, dates, restore) | `src/ThreadInbox.test.tsx` ("keeps the archive shelf ..."), `src/server.test.ts` ("keeps the Archived shelf setting ...") |
| Archive: hover Archive button on Settled rows | `src/ThreadInbox.test.tsx` ("archives one Settled thread from its row") |
| Archive: Settings > Archiving (all settled, per project, confirmation list) | `src/ThreadInbox.test.tsx` ("archives every Settled thread after one confirmation") |
| Project colours and Archived shelf on by default | `src/server.test.ts` ("stores the grouped sidebar settings through RPC", "persists color display mode ...") |
| Per-project models gear | `src/ProjectModelsDialog.test.tsx` |

Installed into BB from this checkout (`path:` source), so it no longer auto-updates.
To take upstream's new versions: `scripts/update-from-upstream.sh` (`--dry-run` to only rebase and test).
Back to upstream: `bb plugin install git:https://github.com/yusuf8834/bb-sidebar.git@semver:^0.2.0 --yes`.
