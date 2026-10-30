# Indexed LF Check

`@svet/check-index-lf` is an independently packageable version-1 checking plugin with stable id `git/index-lf` and rule `lf`. It requires Node.js 22.18+ and a provider exposing the public `git.index` and `content.text` capabilities. With the [Git selector](../../files/git/README.md), Git 2.31+ must be installed. The plugin has no dependencies, private driver imports, subprocesses, runtime downloads, or network access.

The package is private and unpublished. Restore dependencies separately with `npm ci` in this repository; elsewhere, install the package alongside the driver/provider before execution. Installed plugins are not automatically activated.

```js
export default {
  files: "@svet/files-git",
  checks: [{ plugin: "@svet/check-index-lf" }],
};
```

The selector owns selection scope and exclusion patterns; there is no extension allowlist or duplicate pattern configuration in this check. All check options are rejected. Omit the checking plugin from your configuration to disable it; user configurations replace defaults rather than inheriting checks.

## What Is Checked

For each selected path, read the **captured Git index blob**, never `candidate.read()` or the working tree. This also applies when the provider selected working-tree snapshots: a clean checkout does not hide CRLF in the index, and unstaged CRLF does not invalidate an LF-only index. Prefer `snapshot: "index"` when selection itself must classify indexed text rather than working-tree bytes.

The `git.index` capability provides captured `{ path, mode, oid, stage }` entries and `async read(path)` returning their immutable blob bytes. `content.text.isText(bytes)` classifies those indexed bytes; with the Git provider this means no NUL in the first 8000 bytes. Binary blobs are explicitly skipped even when their working-tree replacements are text. Untracked paths without index entries and non-regular entries are also explicit skips.

LF-only content, empty files, and files without line endings pass. CRLF, mixed LF/CRLF, and lone CR line endings produce one finding per file at the first offending line. Findings use the selected repository-relative path, plugin id `git/index-lf`, and rule `lf`, without including file contents. Final-newline policy, trailing whitespace, and general formatting are not checked.

Convert the file to LF using your editor or a deliberate normalization workflow, review the result, and stage only the intended changes yourself. Checkout settings such as `core.autocrlf` do not prove that the already-indexed blob is LF-only. The check never stages, rewrites, normalizes, or installs hooks.

## Advanced Configuration

Use the expanded selector form to classify indexed text during selection and exclude paths:

```js
export default {
  files: [
    {
      plugin: "@svet/files-git",
      options: { snapshot: "index", exclude: ["vendor/**"] },
    },
  ],
  checks: [{ plugin: "@svet/check-index-lf" }],
};
```

Use `mode: "staged"` instead of `snapshot: "index"` to select only staged additions/modifications/renames.

## Incompatibility and Failures

Missing required capabilities are reported by the driver as unavailable errors, not passes or fallback working-tree checks. Revision-only Git selection has no `git.index` capability and is incompatible with this index-specific check. Malformed capabilities, unmerged entries, invalid read results, and read failures are execution errors. Independent file checks can continue after an individual read failure.
