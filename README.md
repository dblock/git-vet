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

No Svet configuration is needed. By default, Svet selects Git-tracked text files and checks their **working-tree contents** for LF line endings. Untracked files are not checked; stage new files to include them. After fixing a tracked file, run the check again without needing to stage the fix. Svet never edits or stages files for you.

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

### File Selection

| Plugin | Selects | Enabled by default |
| --- | --- | --- |
| [`@svet/files-git`](plugins/files/git/README.md) | Git-tracked text, with working-tree, index, staged, and revision selection. | Yes |
| [`@svet/files-glob`](plugins/files/glob/README.md) | Filesystem globs, or narrowing filters over an earlier selection. | No |

### Checks

| Plugin | Checks | Enabled by default |
| --- | --- | --- |
| [`@svet/check-git-index-eol`](plugins/checks/git-index-eol/README.md) | Configurable line endings in captured Git index blobs, regardless of unstaged edits. | No |
| [`@svet/check-file-eol`](plugins/checks/file-eol/README.md) | Configurable line endings in the selected content snapshot; filesystem and Git working-tree sources capture actual file contents. | Yes |

Both EOL checks default to LF. To require CRLF instead, configure `{ plugin: "@svet/check-file-eol", options: { eol: "crlf" } }`; `"cr"` and the `"cr-lf"` spelling are also supported.

Packages remain private and unpublished; the usage example assumes the planned 0.1.0 release. See [configuration](docs/configuration.md), [CLI and API usage](docs/running.md), [plugin contracts](docs/plugin-api.md), and the [changelog](CHANGELOG.md).

## Design

See [DESIGN.md](DESIGN.md) for the architecture and design principles.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contributor instructions.

## Mascot

[Mascot, logos, icons, and artwork guidelines](artwork/README.md).

## License

[MIT](LICENSE).
