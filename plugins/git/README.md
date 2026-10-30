# Git Selection Plugin

`git-vet-selector-git` is an independently packageable version-1 selector with stable plugin id `git/tracked-text`. It uses Node.js 22.18+ and an installed Git 2.31+ executable. It has no private driver imports, runtime installation, native checker downloads, or network access.

The package is currently private and unpublished. It is an npm workspace in this repository; `npm ci` restores its declared JavaScript dependency. It is not automatically selected by core or a shipped default configuration.

```js
export default {
  selectors: [{ plugin: "git-vet-selector-git", options: { mode: "staged" } }],
  checks: [
    // Explicitly select checking plugins here; this provider does not run checks.
  ],
};
```

In another installation, restore the provider package alongside GitVet through the package manager before execution. The driver never discovers or installs it automatically.

## Selection and Snapshots

| Mode | Selected paths | Content |
| --- | --- | --- |
| `tracked` (default) | All tracked text, including unchanged and newly staged paths. | Captured working-tree bytes by default. |
| `changed` | Union of index/worktree changes reported by local Git status, relative to `HEAD` (or an unborn baseline). This is not a historical new-finding comparison. | Captured working-tree bytes by default. |
| `staged` | Index additions, modifications/type changes, and renames; not unstaged-only edits. | Captured index blob ids, never the working tree. |
| `revision` | Additions, modifications/type changes, and renames between explicit `base` and `target` commits. | Target commit blobs, never the index or working tree. |

`snapshot: "index"` can override `tracked`/`changed` content. Their normal `snapshot: "worktree"` captures file bytes during selection, so later reads do not see subsequent file edits. Staged and revision modes reject incompatible snapshot options. Index/revision snapshots use immutable blob ids; readers do not silently substitute another snapshot if a blob becomes unavailable.

Revision mode requires both `base` and `target`; there is no remote/default-branch assumption. By default compare those commits directly. Explicit `mergeBase: true` compares their locally available merge base to the target. Missing references or merge bases (including unavailable shallow history) are errors; nothing is fetched. Unborn repositories use a `null` local baseline and support staged additions.

The provider discovers the working-tree repository root from the supplied project root, including invocation in subdirectories and linked worktrees. It selects repository-wide paths, reported relative to that Git root with `/` separators. Root discovery belongs to this provider, not generic core.

## Text, Exclusions, and Unavailable Paths

Text means no NUL byte in the first 8000 bytes, matching Git's basic binary heuristic; no extension inventory is used. Empty and extensionless files are eligible. This is a byte heuristic, not a guarantee of valid Unicode text and not an interpretation of Git text attributes.

Untracked files are excluded unless `includeUntracked: true`. Ignored untracked files additionally require `includeIgnored: true`. Both options require a working-tree snapshot. Tracked files remain eligible even when their names match ignore patterns.

`exclude: ["vendor/**", "**/*.generated.*"]` applies case-sensitive POSIX-style globs, including dotfiles, consistently on every platform. These are configuration exclusions, separate from Git ignore, change-scope narrowing, and binary filtering. Excluded/unchanged paths remain in full inventory without claiming their content was inspected.

Deleted or missing working-tree paths are reported unavailable without inventing content; staged/revision deletions appear in change metadata but not the current snapshot inventory. Symlinks and submodules remain in inventory but are not selected as regular-file content; working-tree symlink replacements are not followed. Unmerged index entries fail local selection explicitly rather than choosing an arbitrary conflict stage. Revision mode is independent of the current index.

Git path parsing uses NUL-separated output and preserves spaces, Unicode, tabs, newlines, and backslashes where the filesystem supports them. Paths not representable as UTF-8 fail explicitly instead of being decoded lossily. Bare repositories are not supported.

## Public Capabilities

| Capability | Value |
| --- | --- |
| `content.snapshot` | `true`: selected candidates provide snapshot-aware `read()` returning copied `Uint8Array` bytes. |
| `content.text` | `{ isText(bytes) }`, using the heuristic above. |
| `fs.inventory` | Full tracked file records and derived directory records, including binaries, unchanged counterparts, symlinks, and submodules; also explicitly opted-in untracked paths. Narrowing does not remove this context. |
| `git.changes` | `{ baseline, target?, entries }` with local index/worktree status or revision changes. `path` is the current/destination path (the removed path for deletions), and renames include `oldPath`. |
| `git.index` | Local modes only: `{ entries, async read(path) }`. Entries capture `path`, `mode`, `oid`, and `stage`; `read` uses the captured oid even after the index changes and rejects paths without a regular indexed blob. |

File records use stable `git:file:<path>` identities; directory records use `git:directory:<path>`. `metadata.git` contains status/mode/oid and applicable index/worktree/rename information. `metadata.text` appears only when content was classified. Not every inventory entry has content access or a snapshot: directories and uninspected filtered entries must not fabricate these.

Selection decisions label `selected`, `filtered`, `excluded`, and `unavailable` paths with reasons. Git may report an ignored directory without enumerating descendants; its decision explicitly says so. Reportable context identifies repository root, mode, snapshot, baseline, and optional target/merge-base policy. A finding in a changed file is not claimed to be newly introduced.

Git errors carry provider-specific codes such as `GIT_NOT_FOUND`, `GIT_NOT_REPOSITORY`, `GIT_INVALID_REFERENCE`, `GIT_BASELINE_UNAVAILABLE`, `GIT_UNMERGED_INDEX`, and `GIT_CONTENT_UNAVAILABLE`. The runner retains these as `pluginCode` alongside its execution-error classification.

All commands are read-only. Optional index-refresh locks and fsmonitor hooks are disabled. Configured external clean/smudge/process filters are disabled for status classification, so raw working-tree bytes that differ from filtered index representations can be reported modified. Revision diffing disables external diff/textconv commands. Content reads do not invoke smudge filters, build artifacts, install hooks, stage, stash, normalize, or rewrite files. Configuration/plugins remain trusted code rather than an operating-system sandbox.
