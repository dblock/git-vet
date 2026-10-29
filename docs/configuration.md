# Configuration (Foundation)

The library supports replacement-only configuration; no CLI or shipped Git/check defaults are available yet. `loadConfig` accepts an explicit `defaults: { config, directory }` document for embedding and tests. Without a discovered file or this document, it raises `DEFAULT_CONFIG_UNAVAILABLE` rather than manufacturing an empty successful default run. Shipped inspectable defaults will be wired in with the Git provider and basic checks.

## Discovery and Roots

`await loadConfig({ cwd?, root?, configFile?, profile?, defaults? })` searches for `git-vet.config.mjs` or `git-vet.config.json`. Starting at `cwd` (default: the process working directory), it uses the nearest ancestor containing one of these files and stops at the filesystem root. Finding both names in the same directory is an error.

An explicit `configFile` is resolved relative to `cwd` and bypasses discovery. Missing, unreadable, malformed, unsupported-extension, and incorrectly exported files are errors; they never fall back to defaults. ESM configuration must default-export an object. Imported ESM configuration follows Node's normal process-wide module caching.

The discovered file's directory is the project `root`. An explicit `root`, resolved relative to `cwd`, overrides that and restricts automatic discovery to that directory. Explicit `configFile` still resolves relative to `cwd`. Plugin modules always resolve relative to the configuration file's directory, independent of the project root. With supplied defaults, their `directory` supplies module resolution while `root` defaults to `cwd`. No Git command or Git-root discovery participates.

The returned object contains `source: { kind: "file", path }` or `{ kind: "defaults" }`, `root`, `moduleRoot`, `profile` (name or `null`), and the complete effective `selectors` and `checks` arrays.

## Complete Replacement

```js
// git-vet.config.mjs
export default {
  selectors: [{ plugin: "./tools/source.mjs", options: { scope: "recent" } }],
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

A user file completely replaces the supplied defaults, including profiles and all omitted selectors, checks, and options. `{}` means no selected plugins. A partial custom configuration does not inherit anything. The illustrative plugin names above are not shipped or installed automatically.

Each entry names a `plugin` module and optional `options` object. Checks can additionally override `severity` with `error` or `warning`. Core does not interpret Git scope, globs, or exclusion patterns; these are explicitly documented plugin options. Unknown configuration fields and malformed entries are errors rather than ignored options. Validating configuration shapes does not import referenced plugins or validate inactive plugins' own options.

## Profiles and Overrides

First choose the entire user or default document; then select `profile`, if requested, exclusively from that document. A profile completely replaces the base `selectors` and `checks`, not merges them. An empty profile stays empty. An unknown profile is an error, including when that name exists only in omitted defaults.

`resolveConfig(document, { profile? })` performs this shape/profile resolution without filesystem access. The loader's explicit root/file/profile parameters are the current override boundary. There is intentionally no arbitrary plugin-merging override: a future CLI must modify only the effective plan and must not resurrect omitted defaults.

All configuration is trusted executable JavaScript. Keep untrusted repository code out of the invoking process; this library does not sandbox configuration or plugins.
