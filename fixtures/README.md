# Test Plugins

These are test fixtures, not GitVet's shipped providers or default checks. They use the public version-1 contract without private driver imports.

The memory source, recent-file filter, and file/project checks exercise orchestration and snapshot preservation. The separate `timestamp-package` is packed and installed alongside the packed driver during `npm test`. Its import-only package exports exercise ESM package resolution from a configuration directory different from the project root.

The package integration restores dependencies from local archives offline into an empty npm cache, blocks socket connections and `fetch`, and verifies that selected files' contents and modification times remain unchanged. Timestamp selection runs with an empty executable search path even when the real Git provider is installed but unselected. A second run selects the packed Git provider and checks actual staged blobs against different working-tree bytes. The timestamp fixture captures bytes during selection and retains the full inventory when selecting only recent files.
