# Configuration

Without a user configuration, the CLI and `loadConfig()` use the ordinary, inspectable [shipped configuration](../defaults.mjs): select Git-tracked text with `@svet/files-git` and run `@svet/check-file-eol`. These plugins are declared runtime dependencies of Svet. No other checking plugins, profiles, or exclusions are enabled implicitly.

The default EOL check requires LF and reads captured working-tree contents, including unstaged edits, not Git index blobs. Git 2.31+ and a Git working tree are required by the default provider. A custom non-Git configuration replaces that provider and does not require Git.

## Discovery and Roots

`await loadConfig({ cwd?, root?, configFile?, profile?, defaults? })` searches for `svet.config.mjs` or `svet.config.json`. Starting at `cwd` (default: the process working directory), it uses the nearest ancestor containing one of these files and stops at the filesystem root. Finding both names in the same directory is an error.

An explicit `configFile` is resolved relative to `cwd` and bypasses discovery. Missing, unreadable, malformed, unsupported-extension, and incorrectly exported files are errors; they never fall back to defaults. ESM configuration must default-export an object. Imported ESM configuration follows Node's normal process-wide module caching.

The discovered file's directory is the project `root`. An explicit `root`, resolved relative to `cwd`, overrides that and restricts automatic discovery to that directory. Explicit `configFile` still resolves relative to `cwd`. Plugin modules always resolve relative to the configuration file's directory, independent of the project root. With shipped defaults, the installed Svet package supplies module resolution while `root` defaults to `cwd`. Embedders may replace those defaults with an explicit `defaults: { config, directory }` document; its `directory` supplies module resolution. No Git command or Git-root discovery participates in configuration loading.

The returned object contains `source: { kind: "file", path }` or `{ kind: "defaults" }`, `root`, `moduleRoot`, `profile` (name or `null`), and the complete effective `files` and `checks` arrays.

## Complete Replacement

```js
// svet.config.mjs
export default {
  files: "@svet/files-git",
  checks: ["@svet/check-file-eol"],
};
```

A user file completely replaces the supplied defaults, including profiles and all omitted files, checks, and options. `{}` means no selected plugins. A partial custom configuration does not inherit anything. Restore the selected packages before execution; plugins are never installed automatically.

For example, `svet.config.json` containing `{}` intentionally runs no plugins, even when Git is unavailable. A file containing only `checks` does not inherit the default Git provider; missing required capabilities are reported explicitly.

## Files

For line-ending checks on filesystem contents without Git, install `@svet/check-file-eol` beside your configuration and replace the default plan:

```js
export default {
  files: "**/*.txt",
  checks: ["@svet/check-file-eol"],
};
```

The file check reads the selected provider snapshot, not live disk after selection. Filesystem and Git working-tree sources capture actual file contents; staged/index and revision providers retain their indexed or committed snapshots. The opt-in `@svet/check-git-index-eol` instead reads captured Git index blobs even when selection uses working-tree content.

`files` replaces the former `selectors` field; the old name is an error, not an alias. It accepts a single scoped plugin name, a glob string, a `{ plugin, options? }` object, or an ordered array of these:

```js
export default {
  files: ["@svet/files-git", "**/*.{js,ts}", "!vendor/**"],
  checks: ["./tools/check.mjs"],
};
```

`files: "@svet/files-git"` selects the independently packaged Git provider. Scoped package names (and scoped package subpaths) without glob syntax support string shorthand. For plugin-specific options, bare/unscoped package names, local modules, and module URLs, see [Advanced configuration](#advanced-configuration).

`files: "**/*.js"` is a shortcut for the ordinary [`@svet/files-glob`](../plugins/files/glob/README.md) selector with `options: { pattern: "**/*.js" }`. A first glob discovers filesystem files without Git. A later glob only filters the preceding provider's candidates, preserving its snapshots, capabilities, and inventory. The glob plugin implements discovery and matching; generic core only expands shorthand and orchestrates public plugin calls. The shortcut resolves the driver's declared glob dependency, while explicit plugin references resolve beside the configuration like other modules.

Stages narrow in array order, not union: `["**/*.js", "**/*.ts"]` is an intersection, not a way to include both extensions; use `"**/*.{js,ts}"`. Negated globs such as `"!vendor/**"` require an earlier source. Omitted `files` or `files: []` means no source, with no inherited provider. A single entry is normalized to an array; scoped plugin strings become plugin objects and glob strings remain shortcut entries until active plugin loading.

Plugin objects name a `plugin` module and optional `options` object. Git scope, glob behavior, and exclusion patterns belong to their plugins.

## Checks

`checks` is an array of module-name strings, `{ plugin, options?, severity? }` objects, or a mixture of both. Prefer strings when no options or severity override is needed:

```js
export default {
  files: "**/*.txt",
  checks: [
    "@svet/check-file-eol",
    { plugin: "./tools/check.mjs", severity: "warning" },
  ],
};
```

Each string is equivalent to `{ plugin: string }`. Scoped and unscoped package names, local module paths, and file URLs all use the same module resolution; check strings are never interpreted as globs. Objects can override `severity` with `error` or `warning` and provide an `options` object. The array itself is required even for one check; omitted `checks` or `checks: []` activates none.

The same shorthand works in ESM and JSON configuration, replacement profiles, embedded defaults, and programmatic plans. Unknown fields, empty module names, and malformed entries are errors rather than ignored options. Validating configuration shapes does not import referenced plugins or validate inactive plugins' own options.

### Line Endings

Both [`@svet/check-file-eol`](../plugins/checks/file-eol/README.md) and [`@svet/check-git-index-eol`](../plugins/checks/git-index-eol/README.md) require LF by default. Set `options.eol` to `"lf"`, `"cr"`, or `"crlf"` (`"cr-lf"` is an alias for `"crlf"`):

```js
export default {
  files: "**/*.txt",
  checks: [{ plugin: "@svet/check-file-eol", options: { eol: "crlf" } }],
};
```

Each check requires every encountered ending to match that style. A CRLF pair is one ending, not a CR followed by an LF. Empty files and files without a final ending are allowed; trailing whitespace is not checked. Options are case-sensitive and invalid values are explicit plugin-option errors.

## Profiles and Overrides

First choose the entire user or default document; then select `profile`, if requested, exclusively from that document. A profile completely replaces the base `files` and `checks`, not merges them. An empty profile stays empty. An unknown profile is an error, including when that name exists only in omitted defaults.

`resolveConfig(document, { profile? })` performs this shape/profile resolution without filesystem access. The CLI exposes the loader's explicit parameters as `--root`, `--config`, and `--profile`. There is intentionally no arbitrary plugin-merging override, and omitted defaults are never resurrected.

All configuration is trusted executable JavaScript. Keep untrusted repository code out of the invoking process; this library does not sandbox configuration or plugins.

## Advanced Configuration

The shipped document is also exported as `svet/defaults`. To deliberately reuse it in a custom `svet.config.mjs`:

```js
export { default } from "svet/defaults";
```

Copy [defaults.mjs](../defaults.mjs) when you want to edit the plan. Custom plugin references still resolve beside your configuration; declare the selected plugin packages directly when needed rather than relying on package-manager hoisting.

Use explicit plugin objects for options, severity overrides, or local file-selection modules. For example, `files: { plugin: "@svet/files-git", options: { mode: "staged" } }` selects staged Git content. Local checking modules support string shorthand.

This expanded example combines local file selection, check options, a severity override, and replacement profiles:

```js
// svet.config.mjs
export default {
  files: [{ plugin: "./tools/source.mjs", options: { scope: "recent" } }],
  checks: [
    {
      plugin: "example-check-package",
      options: { maximum: 4096 },
      severity: "warning",
    },
  ],
  profiles: {
    metadata: { checks: ["./tools/project-check.mjs"] },
    empty: {},
  },
};
```

These illustrative local modules and checking packages are not shipped or installed automatically.
