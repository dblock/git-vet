# Running Svet

The experimental CLI and library use [shipped defaults](../defaults.mjs) when no user configuration exists: Git-tracked text selection and the file EOL check on captured working-tree contents, requiring LF by default. User configurations completely replace that plan and can select Git-independent local or installed plugins. See the [README usage example](../README.md#usage) for installation.

The default checking package is [`@svet/check-file-eol`](../plugins/checks/file-eol/README.md), with diagnostic id `file/eol`. It can run without Git when used with filesystem globs. The opt-in [`@svet/check-git-index-eol`](../plugins/checks/git-index-eol/README.md) checks captured indexed bytes, with diagnostic id `git/index-eol`.

## CLI

After restoring dependencies in this checkout, run:

```sh
npm run check
node bin/svet.mjs --format json
node bin/svet.mjs --help
```

The package declares `svet` and `git-svet` executables pointing to the same entry point. When installed and their executable directory is on `PATH`, both `svet` and `git svet` run the same CLI. The integration suite verifies the packed distribution rather than invoking a test-only API wrapper.

| Option | Meaning |
| --- | --- |
| `--config <file>` | Explicit configuration file, relative to the working directory. |
| `--root <directory>` | Override the project root and bound automatic discovery. |
| `--profile <name>` | Select a complete replacement profile. |
| `--format <text\|json>` | Output format; defaults to `text`. |
| `--fix` | Apply supported working-tree fixes and recheck fresh snapshots. |
| `--dry-run` | Preview checking without running checks, or preview fixing without applying changes. |
| `-h`, `--help` | Show help without loading configuration. |
| `-v`, `--version` | Show the package version without loading configuration. |

No positional arguments or arbitrary plugin-option overrides are supported. No user configuration means shipped defaults, labeled `Configuration: (defaults)` in text and `configuration.source.kind: "defaults"` in JSON. An explicitly requested missing or malformed configuration remains an error; it never falls back. See [configuration](configuration.md) for discovery and replacement semantics.

Text output identifies the configuration, profile, selection stages, checks, findings, exclusions/skips, and coverage counts on stdout. Errors go to stderr. Dynamic text is stripped of terminal escapes and control characters are escaped. Empty runs state why no checks completed rather than claiming success.

`--format json` writes the complete schema-version-1 run report to stdout, with no CLI progress text or duplicate errors on stderr. Configuration failures use a smaller `{ schemaVersion: 1, status: "error", exitCode: 2, errors: [{ phase, code, message }] }` envelope because no run report exists. Argument-parsing failures occur before the format is established and are reported on stderr as text.

Exit codes are `0` for completed, intentionally empty, or checking-preview runs, `1` for findings (including warnings), and `2` for configuration, capability, execution, or fix errors. Errors take precedence without discarding findings.

The repository's [configuration](../svet.config.mjs) enables the indexed EOL check with its LF default and excludes `fixtures/integration/**` and `test/integration.test.mjs`. CI runs it with `npm run check`. Fixture bytes intentionally include invalid content; `.gitattributes` preserves them and the formatters ignore the fixture projects.

## Programmatic API

```js
import { loadConfig, run } from "svet";

const config = await loadConfig();
const report = await run(config);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.exitCode;
```

`run(config, { fix: true, dryRun: true })` prepares and validates fixes without applying them. `run(config, { dryRun: true })` only previews checking. Both options are optional booleans; unknown runner options are errors.

See [configuration](configuration.md) and [plugin contracts](plugin-api.md). Configuration errors reject before execution. Selected plugin load/option/contract/selection/check errors become structured run errors, retaining independent results. Missing modules are errors, never installed on demand.

## Autofix and Dry-Run

`svet --fix` runs checks, merges proposed byte edits per candidate, applies each file once through the selected source's writer, then selects and checks fresh snapshots once. There is no repeated fix loop. `@svet/check-file-eol` converts all mismatched endings to its configured style without adding a final newline. `@svet/check-file-trailing-whitespace` removes all terminal runs of its configured characters, preserving interior bytes and line boundaries.

Filesystem glob sources and Git working-tree snapshots supply writers. Staged/index/revision sources do not: fixes are explicitly unavailable, and findings remain. The indexed EOL check never proposes working-tree fixes. Svet never stages changes, writes Git blobs/indexes, or redirects read-only snapshots to disk.

`svet --dry-run` executes configuration and file selection, lists the selected candidates and configured check references, and does not import, validate options for, or execute checks. Its report is `planned`, not passed, with `dryRun: true` and `not-run` checks. Selection may read files and invoke Git; this is not a promise of zero work. Selection/configuration errors still fail.

`svet --fix --dry-run` runs checks and prepares, merges, and validates fixes, including target safety, without creating temporary files or applying changes. Findings and their normal exit codes remain; proposed fixes are not reported as applied.

Edits use captured byte offsets. Identical edits are deduplicated; overlaps, ambiguous same-offset insertions, out-of-range edits, changed snapshots, and failed checks block that file's fixes. Unscoped check/load errors block all writes. Other files can still be fixed after a per-file failure, but the run retains initial errors and exits `2`.

The filesystem writer rejects symlink targets/parents, hard-linked or nonregular files, files without write bits, special permission bits, and (where ownership is available) files owned by another user. It verifies captured contents, identity, and permissions before writing and immediately before replacement. Replacement uses a same-directory temporary file, preserves ordinary permission bits, and cleans up its temporary file on failure. Unsupported writes fail explicitly; there is no non-atomic fallback.

Safety is per file, not a repository transaction. Files already fixed remain fixed if another target fails. Verification and replacement are separate filesystem operations: concurrent editors can still race the final check. Avoid concurrent changes while fixing. Ownership beyond the invoking user, extended attributes, ACLs, and timestamps are not preserved as a metadata-backup contract.

Fix reports add `fix: { dryRun, files, summary }`. File entries identify paths/candidates (or an unsupported project check), status (`proposed`, `applied`, `unavailable`, `failed`, or `unchanged`), optional edit count, and optional reason. Summary counts cover applied/proposed/unavailable/failed entries; unavailable checks can produce separate entries for one file. No original/replacement bytes are serialized. After application, the ordinary report describes rechecking; initial errors are retained.

## Loading and Execution

Only effective configuration entries are imported. Inactive profiles and omitted/merely installed plugins are never discovered, imported, option-validated, or executed. Local references and installed npm packages use normal ESM resolution relative to the configuration directory (including import-only package exports), not the invoking directory or project root. Resolved modules must be local files; network and built-in module specifiers are not plugin sources.

Each selected plugin's `validateOptions` is awaited before invocation and must return no value. Reusing the same module with different options creates separate configured entries; reports identify their indices. Different modules declaring the same plugin id within a kind are errors.

Selectors execute in explicit array order. The first receives `input: null`. Later stages are narrowing filters: they must reuse input candidate objects and retain existing capability values by identity, including any full inventory. They may add nonconflicting capabilities, but cannot rediscover omitted candidates or silently replace a snapshot. Core does not infer union/intersection or support graph references/cycles; unsupported configuration fields are rejected.

Each filter returns its own new decisions. The driver accumulates decisions for downstream filters/checks and retains each stage's decisions and reportable context separately. A failed stage stops later selector imports and prevents using partial selection as if complete. Independent project checks can still run without selection; required capabilities remain explicitly unavailable.

Checks execute in configuration order and candidates in deterministic id order, awaiting each call. File checks run once per candidate; project checks run once, even with no selected candidates or no selector. Such project checks receive `selection: null` when no successful selection exists and must not require absent capabilities. File checks without candidates are `not-run`, not passed. A check requiring an absent capability is `unavailable`, with an error; no implicit provider is invoked.

Per-file exceptions or invalid results fail that invocation, while later files and independent checks continue. An intentional `{ skip: "reason" }` is distinct from failure or checked content.

## Report Schema Version 1

The returned object is JSON-safe data and contains:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Currently `1`; breaking report changes require a new version. |
| `status` | `completed`, `findings`, `empty`, `planned`, or `error`. Completed is not a claim that skipped/excluded content was checked. |
| `exitCode` | `0` for completed/intentional empty/checking-preview runs, `1` for any findings (including warnings), `2` for load/capability/contract/execution/fix errors. Errors take precedence over findings, without dropping them. |
| `emptyReason` | On empty runs: `no-checks`, `no-selection`, `no-candidates`, or `all-skipped`. |
| `configuration` | Configuration source, project root, and active profile. |
| `selection` | Selection status, selected candidate summaries, capability names, and ordered stage reports. |
| `checks` | Configured module references/indices, resolved plugin ids/scopes, overall statuses, and per-invocation outcomes. |
| `findings` | Deterministically ordered declared rule findings with plugin id, check index, severity, message, optional paths and location. |
| `errors` | Explicit phase/reference/index, optional plugin/candidate identity, code, optional external `pluginCode`, and message. No automatic stacks or cause dumps. |
| `summary` | Selected candidates, distinct files checked by at least one check, checked/skipped/failed invocation counts, unavailable checks, and finding count. |
| `dryRun` | `true` for checking previews; omitted otherwise. |
| `fix` | Present only with fixing requested: dry-run flag, per-file outcomes and summary counts. |

File outcomes identify `candidateId` and `path`; project outcomes do not invent a path. Selected candidates do not imply checked files. The distinct checked-file count is not a claim that every configured check inspected each file: consult per-check outcomes for skips/failures. Selection decisions describe provider-reported inclusion, filtering, exclusions, or unavailability without implying unvisited directories were exhaustively scanned.

Only id/path/snapshot summaries, capability names, whitelisted finding/error fields, and explicitly reportable selector context/decisions enter reports. Readers, capability values (including full inventories), arbitrary candidate metadata, plugin options, environment, and source bytes are not automatically serialized. Plugins are trusted and remain responsible for keeping their messages/context free of sensitive data and terminal control sequences.

There are no progress prints or process exits in core; those responsibilities belong to the CLI. The default plan is ordinary configuration, not privileged plugin-loading behavior. The Git provider owns its index/revision semantics without adding Git queries to core.
