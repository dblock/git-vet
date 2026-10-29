# Test Plugins

These are test fixtures, not GitVet's shipped providers or default checks. They use the public version-1 contract without private driver imports.

The memory source, recent-file filter, and file/project checks exercise orchestration and snapshot preservation. The separate `timestamp-package` is packed and installed alongside the packed driver during `npm test`. Its import-only package exports exercise ESM package resolution from a configuration directory different from the project root.

The package integration restores dependencies offline, runs with an empty executable search path, blocks socket connections and `fetch`, and verifies that selected files' contents and modification times remain unchanged. The timestamp fixture captures bytes during selection and retains the full inventory when selecting only recent files.
