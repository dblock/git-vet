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

No Svet configuration is needed. By default, Svet selects Git-tracked text files and checks their **indexed contents** for LF line endings. Untracked files are not checked; after fixing a file, review and stage the intended changes before checking again. Svet never edits or stages files for you.

Example output with CRLF line endings staged in `bad.txt`:

```text
> my-project@1.0.0 check
> svet

Configuration: (defaults)
Profile: (base)
Files: git/tracked-text (selected)
Checks: git/index-lf (completed)
bad.txt:1: error [git/index-lf/lf]: Indexed text contains CRLF or CR line endings. Convert to LF and stage the intended changes manually.
Selected 4; checked 4; findings 1; skipped 0; failed 0; unavailable 0.
```

Exit codes are `0` for a completed or intentionally empty run, `1` for findings, and `2` for errors. To customize selection or checks, add [`svet.config.mjs` or `svet.config.json`](docs/configuration.md); your configuration completely replaces the defaults.

## Status

This repository contains an experimental [CLI and programmatic runner](docs/running.md), [public plugin contract](docs/plugin-api.md), [replacement-only configuration loader](docs/configuration.md), [shipped defaults](defaults.mjs), [Git file provider](plugins/files/git/README.md), [glob file selector](plugins/files/glob/README.md), and [indexed LF check](plugins/checks/index-lf/README.md). Packages remain private and unpublished; the usage example assumes the planned 0.1.0 release. Additional checking plugins remain under development in the [project issues](https://github.com/dblock/svet/issues).

See the [changelog](CHANGELOG.md) for implemented features.

## Design

See [DESIGN.md](DESIGN.md) for the architecture and design principles.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contributor instructions.

## Mascot

[Mascot, logos, icons, and artwork guidelines](artwork/README.md).

## License

[MIT](LICENSE).
