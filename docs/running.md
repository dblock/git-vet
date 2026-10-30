# Programmatic Runner (Foundation)

The experimental library can run explicitly configured local or installed plugins, including the separately packaged [Git selection provider](../plugins/files/git/README.md), [glob selector](../plugins/files/glob/README.md), and [indexed LF check](../plugins/checks/index-lf/README.md). It does not yet ship a CLI, default checks, or an out-of-the-box default configuration. Do not interpret these foundations as completion of the planned distribution.

```js
import { loadConfig, run } from "git-vet";

const config = await loadConfig({ configFile: "./git-vet.config.mjs" });
const report = await run(config);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.exitCode;
```

See [configuration](configuration.md) and [plugin contracts](plugin-api.md). Configuration errors reject before execution. Selected plugin load/option/contract/selection/check errors become structured run errors, retaining independent results. Missing modules are errors, never installed on demand.

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
| `status` | `completed`, `findings`, `empty`, or `error`. Completed is not a claim that skipped/excluded content was checked. |
| `exitCode` | `0` for completed/intentional empty runs, `1` for any findings (including warnings), `2` for load/capability/contract/execution errors. Errors take precedence over findings, without dropping them. |
| `emptyReason` | On empty runs: `no-checks`, `no-selection`, `no-candidates`, or `all-skipped`. |
| `configuration` | Configuration source, project root, and active profile. |
| `selection` | Selection status, selected candidate summaries, capability names, and ordered stage reports. |
| `checks` | Configured module references/indices, resolved plugin ids/scopes, overall statuses, and per-invocation outcomes. |
| `findings` | Deterministically ordered declared rule findings with plugin id, check index, severity, message, optional paths and location. |
| `errors` | Explicit phase/reference/index, optional plugin/candidate identity, code, optional external `pluginCode`, and message. No automatic stacks or cause dumps. |
| `summary` | Selected candidates, distinct files checked by at least one check, checked/skipped/failed invocation counts, unavailable checks, and finding count. |

File outcomes identify `candidateId` and `path`; project outcomes do not invent a path. Selected candidates do not imply checked files. The distinct checked-file count is not a claim that every configured check inspected each file: consult per-check outcomes for skips/failures. Selection decisions describe provider-reported inclusion, filtering, exclusions, or unavailability without implying unvisited directories were exhaustively scanned.

Only id/path/snapshot summaries, capability names, whitelisted finding/error fields, and explicitly reportable selector context/decisions enter reports. Readers, capability values (including full inventories), arbitrary candidate metadata, plugin options, environment, and source bytes are not automatically serialized. Plugins are trusted and remain responsible for keeping their messages/context free of sensitive data and terminal control sequences.

There are no progress prints or process exits in core. Terminal formatting, CLI error handling/overrides, packaged `git vet` invocation, additional checking plugins, and shipped default-run acceptance remain separate work. The optional Git provider owns its index/revision semantics without adding Git queries to core.
