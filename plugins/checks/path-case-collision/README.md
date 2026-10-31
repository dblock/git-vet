# Path Case Collision Check

`svet-check-path-case-collision` is an opt-in version-1 checking plugin with id `path/case-collision` and rule `case-collision`. It requires Node.js 22.18+ and the provider's `fs.inventory` capability. It has no Git requirement, private driver imports, content reads, filesystem queries, subprocesses, or runtime networking.

Install it beside your configuration:

```sh
npm install --save-dev svet-check-path-case-collision@0.1.0
```

```js
export default {
  files: "@svet-files-git",
  checks: ["@svet-check-file-eol", "@svet-check-path-case-collision"],
};
```

There are no plugin-specific options; unknown options are errors. A custom configuration replaces defaults, so repeat the EOL check if wanted. Use `files: "**/*"` for non-Git operation, limited to names discoverable on that filesystem.

## Collision Policy

The check compares full inventory paths using `caseFold(path.normalize("NFC")).normalize("NFC")`, with the full, default Unicode folding table supplied by the pinned `unicode-case-folding@1.1.2` dependency. It does not use locale-sensitive lowercasing, runtime downloads, or the host filesystem's case behavior.

NFC-equivalent spellings collide. Full folding also detects expansions such as `Straße` versus `STRASSE` and the equivalent Greek sigma forms. Default folding preserves the distinction between ordinary `i` and dotted `İ` unless the corresponding combining dot is present; it does not apply Turkish-specific rules. NFC does not perform general compatibility normalization, so full-width letters and ASCII letters are not implicitly identical.

This is a deterministic, conservative portability policy, not exact emulation of Windows, macOS, or every filesystem's Unicode tables. Broader restrictions such as reserved Windows names and trailing dots/spaces are separate concerns.

## Files, Directories, and Full Inventory

Every filename and inferred directory prefix participates. Examples:

| Inventory | Collision |
| --- | --- |
| `Foo.txt`, `foo.txt` | File names. |
| `Src/a.js`, `src/b.js` | Directory spellings `Src`, `src`. |
| File `ReadMe`, directory `readme/` containing another file | File-versus-directory spellings `ReadMe`, `readme`. |

Each equivalence group produces one finding with all original spellings in `paths`. Paths and groups have deterministic code-unit ordering; exact duplicate entries are deduplicated. Nested collisions can produce both directory and descendant-path groups. Names are never normalized or altered in the report.

The full inventory includes binary/nonselected entries and directory prefixes. Narrowing changed/staged candidates or applying glob/content exclusions does not shrink the check's scope; unchanged counterparts and unrelated existing collisions can still be reported. The check never adds old/deleted paths from change provenance to the current inventory, so a valid case-only rename with only the new spelling present passes.

Git-backed inventories can detect incompatible indexed or committed paths even on a filesystem that cannot store both spellings. A filesystem glob source can only report paths the filesystem actually retains and the glob discovers. Both use the same [public inventory contract](../../../docs/plugin-api.md), without implicit Git access.

## Independence and Safety

Collision detection does not enforce lowercase or uppercase naming. Use [`svet-check-path-case`](../path-case/README.md) for casing policies; its exceptions never suppress collision findings. Submodule entries are directory entries; symlinks and special files participate as named leaf entries without following targets.

Missing `fs.inventory` is an unavailable error. Invalid entries or contradictory file/directory descriptions of exactly the same path are execution errors. The check never reads file contents, renames anything, updates references, stages changes, or modifies an index. Findings under `--fix` report fixes unavailable.

The package declares the pinned folding dependency and the public `svet-files-glob/inventory` helper. Importing the helper does not activate a filesystem selector or discover files.
