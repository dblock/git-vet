# Changelog

## 0.1.0 (2026-10-31)

- [#31](https://github.com/dblock/svet/pull/31): Support `@` configuration markers for unscoped selector and check packages while preserving scoped names and file-glob shorthand - [@dblock](https://github.com/dblock).
- [#29](https://github.com/dblock/svet/pull/29): Add `--precommit` for read-only staged snapshots and selected change targets, with Git selection configured through `scope` - [@dblock](https://github.com/dblock).
- [#28](https://github.com/dblock/svet/pull/28): Add opt-in `svet-check-path-case` with shared casing defaults, file/directory specializations, and path exceptions - [@dblock](https://github.com/dblock).
- [#28](https://github.com/dblock/svet/pull/28): Add opt-in `svet-check-path-case-collision` for NFC/Unicode-case-folded file and directory collisions across full provider inventories - [@dblock](https://github.com/dblock).
- [#27](https://github.com/dblock/svet/pull/27): Add explicit working-tree autofix for file EOL/trailing whitespace and a global `--dry-run` preview for checking and fixing - [@dblock](https://github.com/dblock).
- [#26](https://github.com/dblock/svet/pull/26): Add opt-in `svet-check-file-trailing-whitespace` with configurable spaces, tabs, and literal single-character policies for captured contents - [@dblock](https://github.com/dblock).
- [#25](https://github.com/dblock/svet/pull/25): Support configurable LF, CR, and CRLF endings in `svet-check-file-eol` and `svet-check-git-index-eol`, with LF as the default - [@dblock](https://github.com/dblock).
- [#24](https://github.com/dblock/svet/pull/24): Support check module-name shorthand throughout configuration and use captured file contents for the default LF check - [@dblock](https://github.com/dblock).
- [#23](https://github.com/dblock/svet/pull/23): Add `svet-check-file-eol` for provider-captured file contents - [@dblock](https://github.com/dblock).
- [#22](https://github.com/dblock/svet/pull/22): Run an inspectable shipped default plan without user configuration, selecting Git-tracked text and checking indexed LF line endings while preserving complete custom replacement - [@dblock](https://github.com/dblock).
- [#20](https://github.com/dblock/svet/pull/20): Add an experimental `svet` / `git svet` CLI with configuration overrides, terminal and JSON reports, and explicit findings/error exit codes - [@dblock](https://github.com/dblock).
- [#16](https://github.com/dblock/svet/pull/16): Add an independently packaged LF check for captured Git index text blobs, with explicit skips and first-offending-line diagnostics - [@dblock](https://github.com/dblock).
- [#17](https://github.com/dblock/svet/pull/17): Configure `files` with scoped plugin names or glob shortcuts, backed by an independently packaged filesystem glob selector and snapshot-preserving filters - [@dblock](https://github.com/dblock).
- [#15](https://github.com/dblock/svet/pull/15): Add an independently packaged Git-tracked text provider with working-tree, index, and revision snapshots, configurable change scopes, and full-inventory capabilities - [@dblock](https://github.com/dblock).
- [#14](https://github.com/dblock/svet/pull/14): Add a programmatic plugin runner with capability checks, snapshot-preserving selection pipelines, and structured findings, skips, failures, and empty-run outcomes - [@dblock](https://github.com/dblock).
- [#13](https://github.com/dblock/svet/pull/13): Add versioned public selector/check contracts and replacement-only configuration with named profiles and Git-independent discovery - [@dblock](https://github.com/dblock).
