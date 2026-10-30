# Svet Design

- Selection providers discover or filter candidates; checking plugins inspect them.
- Git is a provider capability, not a requirement of the generic driver.
- Inventory-level path checks inspect names independently of content candidates. Casing policy and case-insensitive collisions are separate checks; both retain full provider inventory after narrowing.
- User configuration completely replaces shipped defaults. Only selected plugins are loaded.
- Checks report findings without staging, stashing, rewriting, renaming, or automatically installing anything.
- Explicit autofix collects byte edits from checks, applies them through the selected source's writer, and rechecks fresh snapshots. Checking dry-run previews selection without invoking checks; fixing dry-run prepares changes without writing.
- Terminal and JSON reports distinguish findings, skips, exclusions, unavailable capabilities, and execution failures.
