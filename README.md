# GitVet

<img src="artwork/mascot-badge.png" alt="GitVet's full-standing crocodile mascot in a green circle" width="133">

Git and filesystem linter.

## Status

This repository contains an experimental [CLI and programmatic runner](docs/running.md), [public plugin contract](docs/plugin-api.md), [replacement-only configuration loader](docs/configuration.md), optional [Git file provider](plugins/files/git/README.md), [glob file selector](plugins/files/glob/README.md), and [indexed LF check](plugins/checks/index-lf/README.md). Packages remain private and unpublished. Shipped defaults and additional checking plugins remain under development in the [project issues](https://github.com/dblock/git-vet/issues); running without configuration is an explicit error.

See the [changelog](CHANGELOG.md) for implemented features.

## Design

- Selection providers discover or filter candidates; checking plugins inspect them.
- Git is a provider capability, not a requirement of the generic driver.
- User configuration completely replaces shipped defaults. Only selected plugins are loaded.
- Checks report findings without staging, stashing, rewriting, renaming, or automatically installing anything.
- Terminal and JSON reports distinguish findings, skips, exclusions, unavailable capabilities, and execution failures.

## Development

Requires Node.js 22.18 or later.

```sh
npm ci
npm run lint
npm test
npm run check
```

`npm run check` runs GitVet on this repository's indexed text, excluding integration fixture and test paths. The [CLI acceptance suite](fixtures/README.md) runs checked-in fixture projects through the installed command and compares output and exit codes.

See [AGENTS.md](AGENTS.md) for contributor instructions.

## Mascot

[Mascot, logos, icons, and artwork guidelines](artwork/README.md).

## License

[MIT](LICENSE).
