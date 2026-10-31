# Svet

<img src="artwork/mascot-badge.svg" alt="Svet's crocodile switching a light on and off in a green circle" width="133">

Git and filesystem linter.

## Usage

Requires Node.js 22.18+; the default checks also require Git 2.31+. Set up a new project:

```sh
mkdir my-project
cd my-project
git init
npm init -y
npm install --save-dev svet@0.1.0
npm pkg set scripts.check=svet
```

Add `node_modules/` to `.gitignore`, then stage your project files and check them:

```sh
git add .
npm run check
```

No Svet configuration is needed. By default, Svet selects Git-tracked text files and checks their **working-tree contents** for LF line endings. Untracked files are not checked; stage new files to include them. Ordinary checks never edit files. Use `svet --fix` to apply supported working-tree fixes and recheck; Svet never stages changes.

```sh
svet                  # Run checks.
svet --fix            # Check, apply supported fixes, and recheck.
svet --dry-run        # Select files and list checks without importing or running checks.
svet --fix --dry-run  # Run checks and prepare/validate fixes without writing.
svet --precommit     # Check staged/index snapshots without fixing.
```

File EOL and trailing-whitespace checks support fixes with filesystem globs and Git working-tree snapshots. Indexed and committed snapshots remain read-only. See [autofix safety and reporting](docs/running.md#autofix-and-dry-run).

To check what a commit will contain, use `svet --precommit`, or `svet --precommit --dry-run` to preview staged targets without running checks. See the [precommit-hook setup](docs/running.md#precommit-hooks) for a checked-in hook using your project's npm script.

Example output with CRLF line endings in `bad.txt`:

```text
> my-project@1.0.0 check
> svet

Configuration: (defaults)
Profile: (base)
Files: git/tracked-text (selected)
Checks: file/eol (completed)
bad.txt:1: error [file/eol/eol]: Selected text contains CRLF line endings; expected LF. Convert the intended source to LF and run the check again.
Selected 4; checked 4; findings 1; skipped 0; failed 0; unavailable 0.
```

Exit codes are `0` for a completed or intentionally empty run, `1` for findings, and `2` for errors. To customize selection or checks, add [`svet.config.mjs` or `svet.config.json`](docs/configuration.md); your configuration completely replaces the defaults.

## Plugins

Plugins are separate unscoped npm packages. Install them using the names below; prefix unscoped package references in configuration with `@`, for example `files: "@svet-files-git"` and `checks: ["@svet-check-file-eol"]`. The marker is not part of the published name. Scoped names such as `@scope/package` are used unchanged.

### File Selection

| Plugin | Selects | Enabled by default |
| --- | --- | --- |
| [`svet-files-git`](plugins/files/git/README.md) | Git-tracked text, with working-tree, index, staged, and revision selection. | Yes |
| [`svet-files-glob`](plugins/files/glob/README.md) | Filesystem globs, or narrowing filters over an earlier selection. | No |

### Checks

| Plugin | Checks | Enabled by default |
| --- | --- | --- |
| [`svet-check-git-index-eol`](plugins/checks/git-index-eol/README.md) | Configurable line endings in captured Git index blobs, regardless of unstaged edits. | No |
| [`svet-check-file-eol`](plugins/checks/file-eol/README.md) | Configurable line endings in the selected content snapshot; filesystem and Git working-tree sources capture actual file contents. | Yes |
| [`svet-check-file-trailing-whitespace`](plugins/checks/file-trailing-whitespace/README.md) | Trailing spaces/tabs or configured single Unicode characters in captured file contents. | No |
| [`svet-check-path-case`](plugins/checks/path-case/README.md) | Lowercase/uppercase names with shared defaults, file/directory overrides, and exceptions across provider inventory. | No |
| [`svet-check-path-case-collision`](plugins/checks/path-case-collision/README.md) | Unicode case-insensitive file/directory collisions across provider inventory, including binary and unselected paths. | No |

Both EOL checks default to LF. To require CRLF instead, configure `{ plugin: "@svet-check-file-eol", options: { eol: "crlf" } }`; `"cr"` and the `"cr-lf"` spelling are also supported.

The path-case check defaults to lowercase files and directories. Configure `{ plugin: "@svet-check-path-case", options: { case: "lower", files: { exceptions: ["README.md", "LICENSE"] } } }` for file-specific exceptions, or `files: false` to check only directory casing. The collision check has no options. Both inspect full provider inventory even after content selection is narrowed, and neither renames paths.

See [configuration](docs/configuration.md), [CLI and API usage](docs/running.md), [plugin contracts](docs/plugin-api.md), and the [changelog](CHANGELOG.md).

## Design

See [DESIGN.md](DESIGN.md) for the architecture and design principles.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contributor instructions.

## Mascot

[Mascot, logos, icons, and artwork guidelines](artwork/README.md).

## License

[MIT](LICENSE).
