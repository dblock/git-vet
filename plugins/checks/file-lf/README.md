# File LF Check

`@svet/check-file-lf` is an independently packageable version-1 checking plugin with stable id `file/lf` and rule `lf`. It requires Node.js 22.18+ and a provider exposing `content.snapshot: true`, captured `candidate.read()` readers, and `content.text.isText(bytes)`. It has no dependencies, Git requirement, private driver imports, filesystem reads, subprocesses, or runtime networking.

The package is private and unpublished. Svet declares it as a runtime dependency and selects it in the ordinary shipped default plan. For custom configurations, restore referenced plugin packages where they resolve beside your configuration. Merely installing a plugin does not activate it.

For the planned 0.1.0 release:

```sh
npm install --save-dev @svet/check-file-lf@0.1.0
```

```js
export default {
  files: "**/*.txt",
  checks: ["@svet/check-file-lf"],
};
```

The glob selector captures actual filesystem contents during selection without requiring Git. It includes matching untracked files; scope your globs deliberately because there are no implicit Git-ignore or `node_modules` exclusions.

## What Is Checked

Read the selected provider's **captured content snapshot**, not the live filesystem at check time. Filesystem globs and ordinary Git working-tree selection capture working-tree bytes. Git index/staged selection supplies indexed bytes, and revision selection supplies target-commit bytes. Later disk changes do not replace captured content.

Binary snapshots are explicitly skipped using the provider's text classifier. LF-only content, empty files, and files without line endings pass. CRLF, mixed LF/CRLF, and lone CR produce one finding per file at the first offending line. Final-newline policy and trailing whitespace are not checked.

Convert the intended source to LF and select a fresh snapshot by rerunning Svet. With Git index or revision selection, stage or commit the intended correction yourself as appropriate; changing only the working tree does not update those snapshots. The check never writes files, stages changes, installs hooks, or silently switches snapshot kinds.

## Choosing the LF Check

| Plugin | Reads | Git required |
| --- | --- | --- |
| `@svet/check-file-lf` | The selected provider snapshot via `candidate.read()`. | Only if the selected provider requires it. |
| [`@svet/check-git-index-lf`](../git-index-lf/README.md) | Captured Git index blobs, regardless of selected working-tree content. | Yes, with the Git provider. |

Use the indexed check for staged-byte validation. Use the file check with filesystem or working-tree selection for current file contents. A custom configuration completely replaces the default plan, so selecting the file check does not also enable the indexed check.

## Incompatibility and Failures

All check options are rejected. Missing required capabilities are unavailable errors, not passes. Invalid snapshot capabilities, missing readers, non-byte results, invalid text classifiers, and snapshot read failures are explicit execution errors. The check does not infer a provider or fall back to reading disk.
