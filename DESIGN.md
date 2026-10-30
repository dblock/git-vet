# Svet Design

- Selection providers discover or filter candidates; checking plugins inspect them.
- Git is a provider capability, not a requirement of the generic driver.
- User configuration completely replaces shipped defaults. Only selected plugins are loaded.
- Checks report findings without staging, stashing, rewriting, renaming, or automatically installing anything.
- Terminal and JSON reports distinguish findings, skips, exclusions, unavailable capabilities, and execution failures.
