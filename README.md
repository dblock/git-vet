# GitVet

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="artwork/logo-dark.svg">
  <img src="artwork/logo.svg" alt="GitVet, with its crocodile mascot" width="450">
</picture>

Git and filesystem linter.

## Status

This repository currently contains project scaffolding. The validation engine, public plugin API, providers, and checks are planned in the [project issues](https://github.com/dblock/git-vet/issues).

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
```

The initial scaffold has no implementation tests yet. Tests will be introduced with the corresponding features.

See [AGENTS.md](AGENTS.md) for contributor instructions.

## Mascot

[Mascot, logos, icons, and artwork guidelines](artwork/README.md).

## License

[MIT](LICENSE).
