# Git Selection Plugin

`@svet/files-git` is an independently packageable version-1 selector with stable plugin id `git/tracked-text`. It uses Node.js 22.18+ and an installed Git 2.31+ executable. It has no private driver imports, runtime installation, native checker downloads, or network access.

The package is an npm workspace in this repository; `npm ci` restores its declared JavaScript dependencies, including `simple-git` for Git process execution, its public `@simple-git/argv-parser` environment parser, and `picomatch` for exclusions. `simple-git` wraps the installed Git executable; it does not replace Git or download it. Svet declares this provider as a runtime dependency and selects it through the ordinary shipped configuration, not special core behavior.

```js
export default {
  files: "@svet/files-git",
  checks: ["@svet/check-file-eol"],
};
```

Svet's declared dependencies include the provider and [file EOL check](../../checks/file-eol/README.md) for default runs. For custom configurations, restore the referenced plugin packages where they resolve beside your configuration. The driver never discovers or installs plugins on demand. This provider only selects files; it does not implicitly activate the example's check.

## Selection and Snapshots

| Scope | Selected paths | Content |
| --- | --- | --- |
| `tracked` (default) | All tracked text, including unchanged and newly staged paths. | Captured working-tree bytes by default. |
| `changed` | Union of index/worktree changes reported by local Git status, relative to `HEAD` (or an unborn baseline). This is not a historical new-finding comparison. | Captured working-tree bytes by default. |
| `staged` | Index additions, modifications/type changes, and renames; not unstaged-only edits. | Captured index blob ids, never the working tree. |
| `revision` | Additions, modifications/type changes, and renames between explicit `base` and `target` commits. | Target commit blobs, never the index or working tree. |

`snapshot: "index"` can override `tracked`/`changed` content. Their normal `snapshot: "worktree"` captures file bytes during selection, so later reads do not see subsequent file edits. Staged and revision scopes reject incompatible snapshot options. Index/revision snapshots use immutable blob ids; readers do not silently substitute another snapshot if a blob becomes unavailable.

Revision scope requires both `base` and `target`; there is no remote/default-branch assumption. By default compare those commits directly. Explicit `mergeBase: true` compares their locally available merge base to the target. Missing references or merge bases (including unavailable shallow history) are errors; nothing is fetched. Unborn repositories use a `null` local baseline and support staged additions.

The provider discovers the working-tree repository root from the supplied project root, including invocation in subdirectories and linked worktrees. It selects repository-wide paths, reported relative to that Git root with `/` separators. Root discovery belongs to this provider, not generic core.

### Precommit Selection

This source declares `precommit: true`. When the runner passes that request, the provider validates the configured options, rejects revision scopes or fixing, and uses staged/index selection without including untracked or ignored files. Existing exclusions remain in effect. The flag does not replace checks, profiles, or later filters. See the [precommit-hook guide](../../../docs/running.md#precommit-hooks).

Precommit selections additionally expose `targets: [{ id, path, status, oldPath? }]` for staged additions, modifications, deletions, and renames, using stable `git:target:<path>` ids. Surviving text files become content candidates; deletions, binary files, symlinks, and submodules remain metadata-only targets. Full index inventory and `git.changes` are retained, including unchanged and unstaged context. Ordinary scope selection does not add the target view.

## Explicit Fixes

Only working-tree snapshots can supply a writer when the runner requests fixes. The provider reuses the public `@svet/files-glob/fixes` helper through its declared dependency; checks still receive no write interface. Staged/index/revision sources never write to disk or the index. Supported fixes replace selected working files, preserve ordinary file permission bits, and leave staging to you. See [autofix safety and dry-run](../../../docs/running.md#autofix-and-dry-run).

## Advanced Configuration

Use an explicit plugin object when selecting a scope or other options:

```js
export default {
  files: [{ plugin: "@svet/files-git", options: { scope: "staged" } }],
  checks: ["@svet/check-git-index-eol"],
};
```

## Text, Exclusions, and Unavailable Paths

Text means no NUL byte in the first 8000 bytes, matching Git's basic binary heuristic; no extension inventory is used. Empty and extensionless files are eligible. This is a byte heuristic, not a guarantee of valid Unicode text and not an interpretation of Git text attributes.

Untracked files are excluded unless `includeUntracked: true`. Ignored untracked files additionally require `includeIgnored: true`. Both options require a working-tree snapshot. Tracked files remain eligible even when their names match ignore patterns.

`exclude: ["vendor/**", "**/*.generated.*"]` applies case-sensitive POSIX-style globs, including dotfiles, consistently on every platform. These are configuration exclusions, separate from Git ignore, change-scope narrowing, and binary filtering. Excluded/unchanged paths remain in full inventory without claiming their content was inspected.

Deleted or missing working-tree paths are reported unavailable without inventing content; staged/revision deletions appear in change metadata but not the current snapshot inventory. Symlinks and submodules remain in inventory but are not selected as regular-file content; working-tree symlink replacements are not followed. Unmerged index entries fail local selection explicitly rather than choosing an arbitrary conflict stage. Revision scope is independent of the current index.

Git path parsing uses NUL-separated output and preserves spaces, Unicode, tabs, newlines, and backslashes where the filesystem supports them. Paths not representable as UTF-8 fail explicitly instead of being decoded lossily. The provider retains its byte-oriented metadata parsers and uses `simple-git`'s public output/error hooks and binary blob reader so command output is not lossily decoded. Bare repositories are not supported.

## Public Capabilities

| Capability | Value |
| --- | --- |
| `content.snapshot` | `true`: selected candidates provide snapshot-aware `read()` returning copied `Uint8Array` bytes. |
| `content.text` | `{ isText(bytes) }`, using the heuristic above. |
| `fs.inventory` | Full tracked file records and derived directory records, including binaries, unchanged counterparts, symlinks, and submodules; also explicitly opted-in untracked paths. Narrowing does not remove this context. |
| `git.changes` | `{ baseline, target?, entries }` with local index/worktree status or revision changes. `path` is the current/destination path (the removed path for deletions), and renames include `oldPath`. |
| `git.index` | Local scopes only: `{ entries, async read(path) }`. Entries capture `path`, `mode`, `oid`, and `stage`; `read` uses the captured oid even after the index changes and rejects paths without a regular indexed blob. |

File records use stable `git:file:<path>` identities; directory records use `git:directory:<path>`. `metadata.git` contains status/mode/oid and applicable index/worktree/rename information. `metadata.text` appears only when content was classified. Not every inventory entry has content access or a snapshot: directories and uninspected filtered entries must not fabricate these.

Selection decisions label `selected`, `filtered`, `excluded`, and `unavailable` paths with reasons. Git may report an ignored directory without enumerating descendants; its decision explicitly says so. Reportable context identifies repository root, scope, snapshot, baseline, and optional target/merge-base policy. A finding in a changed file is not claimed to be newly introduced.

The opt-in [path case](../../checks/path-case/README.md) and [collision](../../checks/path-case-collision/README.md) checks consume the full `fs.inventory`, including binary files and unchanged or excluded counterparts. They are inventory-wide even with changed/staged candidate scopes or later glob filters; casing exclusions belong in the check's exceptions. Neither check reads content or invokes Git. Indexed inventories can represent conflicting paths without requiring the working filesystem to store both names.

Git errors carry provider-specific codes such as `GIT_NOT_FOUND`, `GIT_NOT_REPOSITORY`, `GIT_INVALID_REFERENCE`, `GIT_BASELINE_UNAVAILABLE`, `GIT_UNMERGED_INDEX`, and `GIT_CONTENT_UNAVAILABLE`. The runner retains these as `pluginCode` alongside its execution-error classification.

All commands are read-only. Optional index-refresh locks and fsmonitor hooks are disabled. Configured external clean/smudge/process filters are disabled for status classification, so raw working-tree bytes that differ from filtered index representations can be reported modified. Revision diffing disables external diff/textconv commands. Content reads do not invoke smudge filters, build artifacts, install hooks, stage, stash, normalize, or rewrite files. The caller's environment remains trusted and is explicitly passed through `simple-git`, including `GIT_INDEX_FILE` for alternate indexes and caller-supplied Git configuration. Guard categories used by that trusted environment are permitted using the library's environment parser. The fsmonitor/filter categories are also permitted because their guards reject disabling these commands; unrelated command guards remain active. Optional locks, terminal prompts, and paging are disabled, and these read-only commands never launch an editor. Command output is limited to 256 MiB per stream. Configuration/plugins remain trusted code rather than an operating-system sandbox.
