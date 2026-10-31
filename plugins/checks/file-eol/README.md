# File EOL Check

`svet-check-file-eol` is an independently packageable version-1 checking plugin with id `file/eol` and rule `eol`. It requires Node.js 22.18+ and a provider exposing `content.snapshot: true`, captured `candidate.read()` readers, and `content.text.isText(bytes)`. It has no dependencies, Git requirement, private driver imports, filesystem reads, subprocesses, or runtime networking.

Svet declares this package as a runtime dependency and selects it in the ordinary shipped default plan. For custom configurations, restore referenced plugin packages where they resolve beside your configuration. Merely installing a plugin does not activate it.

Install it beside your configuration:

```sh
npm install --save-dev svet-check-file-eol@0.1.0
```

```js
export default {
  files: "**/*.txt",
  checks: ["@svet-check-file-eol"],
};
```

The glob selector captures actual filesystem contents during selection without requiring Git. It includes matching untracked files; scope your globs deliberately because there are no implicit Git-ignore or `node_modules` exclusions.

## Configuration

String shorthand requires LF endings. To require a different ending, use `options.eol`:

```js
export default {
  files: "**/*.txt",
  checks: [{ plugin: "@svet-check-file-eol", options: { eol: "crlf" } }],
};
```

| `eol`                 | Required bytes                        |
| --------------------- | ------------------------------------- |
| `"lf"` (default)      | LF (`\n`).                            |
| `"cr"`                | CR (`\r`).                            |
| `"crlf"` or `"cr-lf"` | CRLF (`\r\n`), treated as one ending. |

Values are case-sensitive. Unknown options and invalid values, including `null`, are errors. There is no automatic style detection or mixed-ending allowance.

## What Is Checked

Read the selected provider's **captured content snapshot**, not the live filesystem at check time. Filesystem globs and ordinary Git working-tree selection capture working-tree bytes. Git index/staged selection supplies indexed bytes, and revision selection supplies target-commit bytes. Later disk changes do not replace captured content.

Binary snapshots are explicitly skipped using the provider's text classifier. Every ending must match the configured style. Empty files and files without line endings pass; a final newline is not required. Mixed or mismatched endings produce one finding per file at the first offending line, counting CRLF pairs and lone CR as single line boundaries. Final-newline policy and trailing whitespace are not checked.

Convert the intended source to the configured style and select a fresh snapshot by rerunning Svet. With Git index or revision selection, stage or commit the intended correction yourself as appropriate; changing only the working tree does not update those snapshots. The check never writes files, stages changes, installs hooks, or silently switches snapshot kinds.

## Autofix

With `svet --fix`, this check proposes byte edits for every mismatched ending, preserving all other bytes and whether the file has a final newline. The runner applies them only through a writable filesystem or Git working-tree source and rechecks fresh snapshots. `svet --fix --dry-run` prepares and validates those edits without writing. Indexed and committed sources remain read-only; their fixes are explicitly unavailable.

## Choosing the EOL Check

| Plugin | Reads | Git required |
| --- | --- | --- |
| `svet-check-file-eol` | The selected provider snapshot via `candidate.read()`. | Only if the selected provider requires it. |
| [`svet-check-git-index-eol`](../git-index-eol/README.md) | Captured Git index blobs, regardless of selected working-tree content. | Yes, with the Git provider. |

Use the indexed check for staged-byte validation. Use the file check with filesystem or working-tree selection for current file contents. A custom configuration completely replaces the default plan, so selecting the file check does not also enable the indexed check.

## Incompatibility and Failures

Missing required capabilities are unavailable errors, not passes. Invalid snapshot capabilities, missing readers, non-byte results, invalid text classifiers, and snapshot read failures are explicit execution errors. The check does not infer a provider or fall back to reading disk.
