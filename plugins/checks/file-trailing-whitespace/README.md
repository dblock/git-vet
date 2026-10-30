# File Trailing Whitespace Check

`@svet/check-file-trailing-whitespace` is an independently packageable version-1 checking plugin with id `file/trailing-whitespace` and rule `trailing-whitespace`. It reads only captured `candidate.read()` snapshots through `content.snapshot` and `content.text` capabilities. It has no dependencies, Git requirement, private driver imports, filesystem reads, subprocesses, or runtime networking.

The package requires Node.js 22.18+. It is opt-in, not part of Svet's shipped default plan. Install it beside your configuration:

```sh
npm install --save-dev @svet/check-file-trailing-whitespace@0.1.0
```

```js
export default {
  files: "**/*.txt",
  checks: ["@svet/check-file-trailing-whitespace"],
};
```

String shorthand rejects spaces and tabs at line ends. Leading indentation and whitespace inside a line are allowed.

## Configuring Whitespace

`options.whitespace` is a nonempty array. Each entry is `"space"` (U+0020), `"tab"` (U+0009), or any literal single Unicode code point:

```js
export default {
  files: "**/*.txt",
  checks: [
    {
      plugin: "@svet/check-file-trailing-whitespace",
      options: { whitespace: ["space", "tab", "x", "\u00a0"] },
    },
  ],
};
```

This example rejects trailing spaces, tabs, the literal character `x`, and nonbreaking spaces. Literal `" "` and `"\t"` are also accepted, as are supplementary characters such as `"\u{1f600}"`. Duplicate entries are harmless.

The list replaces the default `["space", "tab"]`; it does not extend it implicitly. Only configured characters immediately before a line boundary or end of file are rejected. Unconfigured terminal characters are not ignored: a spaces-only policy does not reject a line ending in a tab. Omit the plugin to disable the check rather than supplying an empty list.

Entries are case-sensitive. Empty or multi-code-point strings, unpaired surrogates, CR, LF, nonstrings, empty lists, nonarray values, and unknown options are errors. A combining sequence such as `"e\u0301"` has two code points and cannot be one entry; either individual code point can be configured.

## Snapshots and Line Boundaries

LF, CRLF, and lone CR delimit lines; CRLF counts as one boundary. The last line is checked even without a final newline, and whitespace-only lines are checked. Empty files and clean empty lines pass. One finding is reported per file at the first offending line. Line-ending style and final-newline policy are independent; combine this plugin with [`@svet/check-file-eol`](../file-eol/README.md) to enforce a style.

Characters match exact UTF-8 byte sequences without decoding or normalizing the rest of the snapshot. Space and tab checks therefore work with arbitrary non-NUL text bytes too; a non-UTF-8 byte such as `0xa0` does not match the UTF-8 encoding of `"\u00a0"`. Binary snapshots are explicitly skipped using the selected provider's text classifier.

Filesystem and Git working-tree selection capture actual file contents. Git staged/index and revision selection retain their selected indexed or committed snapshots. The checker never substitutes live disk or queries Git. Remove trailing characters from the intended source and rerun selection; stage or commit corrections yourself when checking indexed or committed snapshots.

## Incompatibility and Failures

Missing required capabilities are unavailable errors, not passes. Invalid snapshot capabilities, missing readers, non-byte results, invalid text classifiers, and snapshot read failures are explicit errors. The check never trims files, changes line endings, stages changes, installs hooks, or falls back to another content source.
