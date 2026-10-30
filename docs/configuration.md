# Configuration (Foundation)

The CLI and library support replacement-only configuration; no shipped Git/check defaults are available yet. `loadConfig` accepts an explicit `defaults: { config, directory }` document for embedding and tests. Without a discovered file or this document, it raises `DEFAULT_CONFIG_UNAVAILABLE` rather than manufacturing an empty successful default run. The CLI requires a configuration file; the optional Git provider alone does not activate default behavior.

## Discovery and Roots

`await loadConfig({ cwd?, root?, configFile?, profile?, defaults? })` searches for `git-vet.config.mjs` or `git-vet.config.json`. Starting at `cwd` (default: the process working directory), it uses the nearest ancestor containing one of these files and stops at the filesystem root. Finding both names in the same directory is an error.

An explicit `configFile` is resolved relative to `cwd` and bypasses discovery. Missing, unreadable, malformed, unsupported-extension, and incorrectly exported files are errors; they never fall back to defaults. ESM configuration must default-export an object. Imported ESM configuration follows Node's normal process-wide module caching.

The discovered file's directory is the project `root`. An explicit `root`, resolved relative to `cwd`, overrides that and restricts automatic discovery to that directory. Explicit `configFile` still resolves relative to `cwd`. Plugin modules always resolve relative to the configuration file's directory, independent of the project root. With supplied defaults, their `directory` supplies module resolution while `root` defaults to `cwd`. No Git command or Git-root discovery participates.

The returned object contains `source: { kind: "file", path }` or `{ kind: "defaults" }`, `root`, `moduleRoot`, `profile` (name or `null`), and the complete effective `files` and `checks` arrays.

## Complete Replacement

```js
// git-vet.config.mjs
export default {
  files: "@git-vet/files-git",
  checks: [{ plugin: "@git-vet/check-index-lf" }],
};
```

A user file completely replaces the supplied defaults, including profiles and all omitted files, checks, and options. `{}` means no selected plugins. A partial custom configuration does not inherit anything. Restore the selected packages before execution; plugins are never installed automatically.

## Files

`files` replaces the former `selectors` field; the old name is an error, not an alias. It accepts a single scoped plugin name, a glob string, a `{ plugin, options? }` object, or an ordered array of these:

```js
export default {
  files: ["@git-vet/files-git", "**/*.{js,ts}", "!vendor/**"],
  checks: [{ plugin: "./tools/check.mjs" }],
};
```

`files: "@git-vet/files-git"` selects the separately installed Git provider. Scoped package names (and scoped package subpaths) without glob syntax support string shorthand. For plugin-specific options, bare/unscoped package names, local modules, and module URLs, see [Advanced configuration](#advanced-configuration).

`files: "**/*.js"` is a shortcut for the ordinary [`@git-vet/files-glob`](../plugins/files/glob/README.md) selector with `options: { pattern: "**/*.js" }`. A first glob discovers filesystem files without Git. A later glob only filters the preceding provider's candidates, preserving its snapshots, capabilities, and inventory. The glob plugin implements discovery and matching; generic core only expands shorthand and orchestrates public plugin calls. The shortcut resolves the driver's declared glob dependency, while explicit plugin references resolve beside the configuration like other modules.

Stages narrow in array order, not union: `["**/*.js", "**/*.ts"]` is an intersection, not a way to include both extensions; use `"**/*.{js,ts}"`. Negated globs such as `"!vendor/**"` require an earlier source. Omitted `files` or `files: []` means no source, with no inherited provider. A single entry is normalized to an array; scoped plugin strings become plugin objects and glob strings remain shortcut entries until active plugin loading.

Plugin objects name a `plugin` module and optional `options` object. Checks remain an array of plugin objects and can additionally override `severity` with `error` or `warning`. Git scope, glob behavior, and exclusion patterns belong to their plugins. Unknown configuration fields and malformed entries are errors rather than ignored options. Validating configuration shapes does not import referenced plugins or validate inactive plugins' own options.

## Profiles and Overrides

First choose the entire user or default document; then select `profile`, if requested, exclusively from that document. A profile completely replaces the base `files` and `checks`, not merges them. An empty profile stays empty. An unknown profile is an error, including when that name exists only in omitted defaults.

`resolveConfig(document, { profile? })` performs this shape/profile resolution without filesystem access. The CLI exposes the loader's explicit parameters as `--root`, `--config`, and `--profile`. There is intentionally no arbitrary plugin-merging override, and omitted defaults are never resurrected.

All configuration is trusted executable JavaScript. Keep untrusted repository code out of the invoking process; this library does not sandbox configuration or plugins.

## Advanced Configuration

Use explicit plugin objects for options or local modules. For example, `files: { plugin: "@git-vet/files-git", options: { mode: "staged" } }` selects staged Git content.

This expanded example combines local file selection, check options, a severity override, and replacement profiles:

```js
// git-vet.config.mjs
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
    metadata: { checks: [{ plugin: "./tools/project-check.mjs" }] },
    empty: {},
  },
};
```

These illustrative local modules and checking packages are not shipped or installed automatically.
