# Glob File Selector

`@git-vet/files-glob` is an independently packageable version-1 selector with stable plugin id `files/glob`. It uses Node.js 22.18+ and the declared JavaScript dependency `picomatch`; it has no private driver imports, Git requirement, subprocesses, downloads, or runtime networking.

The package is private and unpublished. It is a dependency of the driver so glob shorthand works after ordinary dependency restoration. Neither installing it nor mentioning it in an inactive profile activates it.

```js
export default {
  files: "**/*.js",
  checks: [{ plugin: "./tools/check.mjs" }],
};
```

The glob is only shorthand for selecting this ordinary plugin with `options: { pattern: "**/*.js" }`:

```js
export default {
  files: {
    plugin: "@git-vet/files-glob",
    options: { pattern: "**/*.js" },
  },
  checks: [{ plugin: "./tools/check.mjs" }],
};
```

## Sources and Filters

As the first `files` stage, the plugin discovers matching paths under the project root using Node's filesystem glob implementation. It captures regular-file bytes during selection and returns copied `Uint8Array` snapshots, including binary files. Matched directories, symlinks, and special files are explicitly excluded from content selection. It does not traverse directory symlinks, follow selected file symlinks for content, or rewrite files. Read/discovery failures are execution errors.

With an earlier provider, it performs **no filesystem discovery or content reads**. It narrows the existing candidates by their provider-relative paths using `picomatch`, preserving candidate objects, snapshot readers, metadata, capability values, full inventory, and prior context. It reports its own selected/filtered decisions; the driver accumulates earlier provenance.

```js
export default {
  files: ["@git-vet/files-git", "**/*.js", "!vendor/**"],
  checks: [{ plugin: "./tools/check.mjs" }],
};
```

Array stages execute in order and narrow, not union, previous results. Multiple positive globs mean intersection; combine alternatives in one pattern, such as `"**/*.{js,ts}"`. Negated globs require an earlier source; a leading negative glob is an error. Empty matches remain an explicit empty selection.

Patterns use case-sensitive POSIX `/` paths, with braces, wildcards, and explicit dotfile patterns. Ordinary wildcards do not match hidden path components; use an explicit dot component to select them. Absolute patterns, drive-prefixed patterns, and `..` path components are rejected. There are no implicit Git-ignore, extension, `node_modules`, or vendor exclusions. Only `pattern` is an accepted option.

## Capabilities

A filesystem source provides `content.snapshot: true`, `content.text: { isText(bytes) }` (no NUL in the first 8000 bytes), and `fs.inventory`. Inventory contains the matched records plus their parent directory records, not an exhaustive listing of unmatched files under the root. Subsequent narrowing preserves that source inventory unchanged.

Records have stable `glob:<path>` identities, root-relative POSIX paths, and `metadata.kind`. Captured files additionally have `metadata.text`, a SHA-256 `snapshot` with kind `filesystem`, and a reader. Reportable context identifies root, pattern, and snapshot kind. It does not expose a fabricated `git.index`; index-specific checks are explicitly incompatible with a filesystem-only source.
