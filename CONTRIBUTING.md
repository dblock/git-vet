# Contributing to Svet

## Development

Requires Node.js 22.18 or later.

```sh
npm ci
npm run lint
npm test
npm run check
```

`npm run check` runs Svet on this repository's indexed text, excluding integration fixture and test paths. The [CLI acceptance suite](fixtures/README.md) runs checked-in fixture projects through the installed command and compares output and exit codes.

See [AGENTS.md](AGENTS.md) for contributor instructions.
