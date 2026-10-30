# Changelog

## Unreleased

- [#20](https://github.com/dblock/svet/pull/20): Add an experimental `svet` / `git svet` CLI with configuration overrides, terminal and JSON reports, and explicit findings/error exit codes - [@dblock](https://github.com/dblock).
- [#16](https://github.com/dblock/svet/pull/16): Add an independently packaged LF check for captured Git index text blobs, with explicit skips and first-offending-line diagnostics - [@dblock](https://github.com/dblock).
- [#17](https://github.com/dblock/svet/pull/17): Configure `files` with scoped plugin names or glob shortcuts, backed by an independently packaged filesystem glob selector and snapshot-preserving filters - [@dblock](https://github.com/dblock).
- [#15](https://github.com/dblock/svet/pull/15): Add an independently packaged Git-tracked text provider with working-tree, index, and revision snapshots, configurable change scopes, and full-inventory capabilities - [@dblock](https://github.com/dblock).
- [#14](https://github.com/dblock/svet/pull/14): Add a programmatic plugin runner with capability checks, snapshot-preserving selection pipelines, and structured findings, skips, failures, and empty-run outcomes - [@dblock](https://github.com/dblock).
- [#13](https://github.com/dblock/svet/pull/13): Add versioned public selector/check contracts and replacement-only configuration with named profiles and Git-independent discovery - [@dblock](https://github.com/dblock).
