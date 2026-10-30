# Path Case Check

`@svet/check-path-case` is an opt-in version-1 checking plugin with id `path/case` and rule `case`. It requires Node.js 22.18+ and the provider's `fs.inventory` capability. It checks names, not content, and has no Git requirement, private driver imports, filesystem reads, subprocesses, or runtime networking.

Install it beside your configuration:

```sh
npm install --save-dev @svet/check-path-case@0.1.0
```

```js
export default {
  files: "@svet/files-git",
  checks: ["@svet/check-file-eol", "@svet/check-path-case"],
};
```

String shorthand requires lowercase file and directory names. A custom configuration replaces the defaults, so repeat the EOL check if wanted. For non-Git operation use `files: "**/*"`; only the glob source's discovered inventory is available, with no implicit ignore rules.

## Shared Defaults and Specializations

```js
export default {
  files: "**/*",
  checks: [
    {
      plugin: "@svet/check-path-case",
      options: {
        case: "lower",
        exceptions: ["LICENSE"],
        files: {
          case: "lower",
          exceptions: ["README.md", "LICENSE", "**/Dockerfile"],
        },
        directories: { exceptions: ["API"] },
      },
    },
  ],
};
```

| Option | Meaning |
| --- | --- |
| `case` | `"lower"` (default) or `"upper"`, shared by files and directories. |
| `exceptions` | Positive, case-sensitive, provider-relative POSIX globs; defaults to `[]`. |
| `files` | An override object containing `case` and/or `exceptions`, or `false` to disable filename policy. |
| `directories` | An override object containing `case` and/or `exceptions`, or `false` to disable directory-name policy. |

Omitted override fields inherit shared values. Explicit exception arrays replace inherited lists rather than merging; `[]` removes inherited exceptions for that category. Repeating the inherited case is valid. For lowercase directories with unrestricted filenames, use `options: { files: false }`. For uppercase files with lowercase directories, use `options: { files: { case: "upper" } }`.

Exceptions match each entry's original full provider-relative path, including dotfiles. `README.md` exempts that root file; `**/README.md` also matches nested files. Exempting `SRC/README.md` never exempts the parent directory `SRC`. Exempting `API` permits that directory's name without exempting its children's names. Paths in exceptions do not affect the separate collision check.

Unknown fields, invalid cases, malformed/negated/absolute/parent-traversing exception globs, invalid category values, and disabling both categories are errors. Omit the plugin to disable both.

## Inventory and Unicode Semantics

The check inspects the full provider inventory, not just selected content candidates. Git inventory includes tracked binary files, missing working-tree paths, directories, symlinks, and submodules. Changed/staged scopes, glob filters, and provider content exclusions do not suppress inventory findings, including existing violations. Use this check's exceptions for casing-policy exclusions. A glob source has only its matched inventory and inferred ancestors; it cannot report names it never discovered.

Each filename (including all extensions and dot prefixes) and each directory component is checked once. Parent directories are inferred from entries, deduplicated, and checked independently. Submodule entries use directory policy; symlinks, special files, and untracked file entries use filename policy. The inventory contract and shared public helper are documented in the [plugin API](../../../docs/plugin-api.md).

Lowercase means a name equals its JavaScript `toLowerCase()` result; uppercase means it equals `toUpperCase()`. These are locale-independent Unicode conversions supplied by Node.js, not locale-sensitive conversions or ASCII-only rules. Digits, punctuation, and other characters unchanged by the requested conversion are allowed. Names are not normalized, and this policy does not prescribe separators, filename stems, or extension-specific styles.

One finding identifies each offending entry, with original spelling and the required case. Findings use deterministic code-unit path ordering; the driver also applies its standard report ordering. As a project check, this contributes a checked invocation rather than file-check outcomes.

## Safety and Failures

Names come exclusively from `fs.inventory`; readers and live filesystem/Git queries are never used. Missing capabilities are unavailable errors, and malformed inventory is an explicit execution error. Ordinary checks and `--fix` never rename paths, update references, or modify the index. Findings under `--fix` report fixes unavailable. Use [`@svet/check-path-case-collision`](../path-case-collision/README.md) independently to detect conflicting spellings.

The package declares `picomatch` and the public `@svet/files-glob/inventory` helper as dependencies. Importing that helper does not activate the glob selector or discover files.
