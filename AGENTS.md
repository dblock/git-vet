# Contributor instructions

## Architecture

- Build a portable Node.js application using native ECMAScript modules. Support Node.js 22.18 and later; keep runtime JavaScript directly executable without a build step.
- Keep generic core limited to configuration, public plugin contracts, orchestration, and reporting. Do not query Git or assume Git, text files, or a particular filesystem provider in generic core.
- Make providers and checks independently packageable through public interfaces. Do not import private driver modules from plugins or give shipped plugins privileged interfaces.
- Load only plugins selected by the effective configuration. Do not statically import concrete plugins, discover installed plugins, or initialize inactive profiles.
- User configuration completely replaces shipped defaults. Empty and partial configurations must not restore omitted `files` stages, checks, profiles, options, or exclusions.
- Configure selection through `files`, not `selectors`. A glob is only shorthand for the public `@git-vet/files-glob` selector; keep discovery and matching in that plugin, not core. Ordered stages narrow candidates and preserve their snapshots and capabilities.
- Place file selector packages under `plugins/files/<name>` and their tests under `test/plugins/files/<name>.test.mjs`.
- Providers own candidate identity, snapshots, metadata, optional capabilities, and selection provenance. Checks must declare their requirements and explicitly report incompatibility.
- Preserve full-inventory context when narrowing selected files. Do not confuse changed files with newly introduced findings.
- Keep the initial selector contract open to later composition without prematurely implementing unrequested providers or pipeline operators.

## Safety and reporting

- Checks are read-only. Never stage, stash, rewrite, rename, build artifacts, install dependencies, install hooks, or fetch plugins while executing checks.
- Dependency restoration is separate from execution. Packaged checks must work offline after their declared dependencies are installed; do not download native checker binaries.
- Treat JavaScript configuration and plugins as trusted executable code, not sandboxed input.
- Distinguish findings, skips, exclusions, unavailable content/capabilities, configuration errors, and execution failures. Never imply that unprocessed files or an empty run passed validation.
- Return structured outcomes rather than printing or exiting from plugins. Preserve independent check results when another plugin fails.
- Keep reports deterministic. JSON output must not contain progress text, terminal escapes, file contents, credentials, or environment dumps by default.

## Development

- Use `.mjs` for JavaScript modules, existing Node.js APIs, ESLint, and Prettier. Prefer the simplest implementation that satisfies the documented contracts.
- Keep Markdown paragraphs on one source line. Use LF line endings and preserve intended formatting through the project configuration.
- Add focused tests for introduced behavior, including external plugins, unselected-plugin non-loading, configuration replacement, capability mismatches, and non-Git operation where relevant.
- Test actual staged/revision snapshots and packaged execution when implementing those features. Do not replace these with working-tree or source-checkout proxies.
- Run `npm run lint` and the relevant tests immediately before committing. Do not add tests solely for constants or trivial accessors.
- Keep original artwork sources and document how generated assets are reproduced. Artwork tooling must not become a prerequisite of ordinary CLI execution.

## Delivery

- The initial scaffold is the only direct implementation commit to `main`. Make subsequent changes on feature branches and open pull requests.
- Keep each pull request focused and its branch history to one logical commit. Do not force-push `main` or amend commits without explicit authorization.
- Leave issues open while a pull request is pending. Use closing references only for requirements the pull request actually completes; reference partial work without claiming completion.
- Update directly related documentation. Keep proposed functionality distinct from implemented behavior.
- Keep `CHANGELOG.md` feature-only, with an entry linked to the implementing pull request for each user-visible feature. Do not add entries for bug fixes, refactoring, tooling, documentation, or branding-only changes.
- Format changelog entries as `- [#15](https://github.com/dblock/git-vet/pull/15): Description - [@contributor](https://github.com/contributor).`, using the actual pull request number and contributor.
- Do not publish packages or create release tags without explicit authorization.
