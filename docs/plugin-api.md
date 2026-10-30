# Plugin API (Experimental Version 1)

The public library exports `loadConfig`, `resolveConfig`, `run`, `Error`, `PLUGIN_API_VERSION`, and contract validators from `git-vet`. The exported `Error(code, message, options?)` extends `globalThis.Error`, adding a diagnostic `code` while preserving native cause support. Plugins are ordinary ESM modules default-exporting an object; they do not need to import the driver or any private modules. A package name and a plugin's stable `id` are independent, so moving a plugin does not change diagnostic identities.

This is a foundation, not a released CLI. The [programmatic runner](running.md) supports explicit configurations; shipped Git/text defaults, concrete checks, and the distribution entry point remain separate implementation steps. The package remains private.

## Metadata and Compatibility

Every plugin declares `apiVersion: 1`, a lowercase `id` such as `example/size`, and `kind: "selector"` or `"check"`. Identifiers consist of lowercase letter/digit segments separated by `.`, `/`, or `-`, starting with a letter. Unsupported API versions and invalid contracts are errors, never skips.

Breaking contract changes require a new plugin API version. Additive optional fields retain version 1. This experimental API may change before the first public release. Options belong to the plugin: optional `async validateOptions(options)` throws for invalid values; the driver must await it before execution. Configuration options are objects; nested values may be trusted executable JavaScript.

## Selectors

```js
export default {
  apiVersion: 1,
  id: "example/source",
  kind: "selector",
  async select({ root, options, input }) {
    // Discover candidates when input is null, or refine an earlier selection.
    return { candidates: [], capabilities: {} };
  },
};
```

`root` is the project/configuration root, not an implicitly discovered Git root. `input` is `null` for a source or a prior selection for a filter. Configured selectors form an ordered narrowing pipeline: filters reuse input candidate records and retain input capabilities, preserving snapshots and full inventories. They return only their new decisions; core accumulates prior provenance. This does not imply union or intersection of independently discovered sources.

A candidate has a nonempty stable `id` and `path`. Paths are provider-defined display paths, normally project-relative with `/` separators. They may contain spaces, Unicode, and newlines. Optional `metadata` is an object. Optional `snapshot: { kind, id }` identifies the content version; optional `async read()` returns a `Uint8Array` of that snapshot's bytes. Providers own snapshot correctness and must not substitute live working-tree bytes for a promised index/revision snapshot. Metadata-only or unavailable candidates do not invent content access.

A selection contains `candidates` with unique ids and a `capabilities` object, even when both are empty. Capability names use the identifier syntax above; values are provider-defined and must not be `undefined`. For example, `"fs.inventory"` can expose the full inventory while `candidates` contains only recent files, and `"git.index"` can expose a documented index-reading interface. Providers and checks must document each capability's value contract; the generic driver must not fabricate or interpret Git metadata.

Optional `decisions` contains `{ state, reason, path?, candidateId? }` records. States are `selected`, `filtered`, `excluded`, and `unavailable`. Reasons identify why a selector included or omitted a path; absence from the candidate list alone does not establish that it was scanned or excluded. Optional `context` is an explicitly reportable JSON-safe object for scope/baseline descriptions, not a dump of internal metadata or secrets.

## Checks

```js
export default {
  apiVersion: 1,
  id: "example/size",
  kind: "check",
  scope: "file",
  rules: ["maximum-bytes"],
  requires: ["content.snapshot"],
  async check({ root, options, selection, candidate }) {
    const bytes = await candidate.read();
    return bytes.length > options.maximum
      ? {
          findings: [
            {
              ruleId: "maximum-bytes",
              path: candidate.path,
              message: "File exceeds the configured size.",
            },
          ],
        }
      : { findings: [] };
  },
};
```

`scope: "file"` invokes a check for each candidate; `scope: "project"` consumes the selection once and may return project-level or cross-file findings. A project check has no `candidate`. Optional `requires` lists required capability names; absence must be reported as unavailable, not passed or satisfied through implicit Git queries.

Checks return either `{ findings: [...] }` or `{ skip: "reason" }`. A skip describes the whole invocation and must not be combined with findings. Exceptions are execution failures, distinct from both findings and intentional skips.

Findings name a declared `ruleId` and nonempty `message`. Optional `severity` is `error` or `warning`; a configured check severity overrides it. Optional `path` identifies a primary path, `paths` represents a cross-file group, and `location: { line, column? }` uses positive one-based positions and requires a primary path. Omit paths for project-level findings. Plugin authors must not include source contents, credentials, or environment dumps in messages or reportable context.

## Trust and Read-Only Behavior

Configuration and plugins are trusted JavaScript running as the invoking user, not a sandbox. Read-only behavior is a plugin contract, not an operating-system security boundary. Do not write, rename, stage, stash, build, install dependencies, install hooks, or use runtime network access while checking. The driver never installs missing plugins. Third-party prerequisites must be documented and errors explicit.
