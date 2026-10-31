# Releasing Svet

Publishing packages, pushing tags, and creating GitHub releases require explicit maintainer authorization. Never overwrite published versions or move release tags.

## Packages

The driver `svet` and each plugin are separate npm packages. The seven plugins are npm workspaces under `plugins/files/` and `plugins/checks/`; publishing the root does not publish them. Installing `svet` installs its declared default-plugin dependencies, while users install optional checks separately. All eight packages start at version `0.1.0`.

The plugin packages use unscoped `svet-files-*` and `svet-check-*` npm names; no npm organization is required. Confirm the intended publisher with `npm whoami`. Configuration uses an `@` marker for unscoped package references, such as `"@svet-files-git"`; the published and installed package name is `svet-files-git`, without that marker.

## Prepare

1. Start from a clean `main` synchronized with GitHub. Create a release branch and confirm all intended features are merged.
2. Update versions in the packages being released and the lockfile without creating tags. Dependencies on released workspace packages must point to their intended published versions. Date the matching feature-only changelog section.
3. Remove any `private: true` guards from packages intended for publication. Run `npm run lint`, `npm test`, and `npm run check` immediately before committing. The tests include actual packed, installed CLI acceptance checks with offline execution.
4. Review `npm pack --dry-run --json` for the driver and `npm pack --workspaces --dry-run --json` for every plugin. Verify runtime modules, exports, commands, README files, and licenses are present; development tests and fixtures must not be packaged.
5. Open a focused release-preparation PR with one logical commit. Wait for all CI checks at its exact head and squash-merge it before publishing from the clean merged commit.

## Publish

Check registry versions before publishing. An `E404` for a new package/version is expected; authentication, permission, or network errors are not evidence of availability. A dry run cannot guarantee that npm will approve an unscoped package name.

Publish dependencies before their dependents. For the initial release, use this order from the repository root:

```sh
npm publish --workspace svet-files-glob --access public
npm publish --workspace svet-files-git --access public
npm publish --workspace svet-check-file-eol --access public
npm publish --workspace svet-check-file-trailing-whitespace --access public
npm publish --workspace svet-check-git-index-eol --access public
npm publish --workspace svet-check-path-case --access public
npm publish --workspace svet-check-path-case-collision --access public
npm publish --workspaces=false --access public
```

Follow npm authentication prompts. If an authenticator code is required, obtain a fresh code immediately before publication and pass `--otp FRESH_CODE`; never save it in files or memory. Verify each published package's exact version and `dist.integrity` with `npm view PACKAGE@VERSION version dist.integrity` before proceeding to dependent packages.

Publication is not atomic across packages. If a later publication fails, record the packages already published and resume only the missing ones after resolving the error. Never attempt to overwrite an existing version.

## Verify and Tag

Install `svet@VERSION` and all released optional checks into an owned temporary project using only registry packages, not workspace links or local tarballs. Verify both `svet` and `git svet`, default operation, filesystem selection, optional checks, JSON reporting, findings/error exit codes, and an explicit working-tree fix. Runtime execution must remain offline after dependencies are installed and must not modify source during ordinary checking or change the Git index during fixes.

After all packages are verified, create an annotated `vVERSION` tag at the merged release commit, push it, and create the GitHub release with the matching changelog entries:

```sh
git tag -a vVERSION RELEASE_COMMIT -m "Release VERSION"
git push origin vVERSION
gh release create vVERSION --repo dblock/svet --verify-tag --title VERSION --notes-file RELEASE_NOTES
```

Remove only the temporary consumer and notes file created for verification. For subsequent releases, release changed plugins and their dependent packages as needed; a plugin-only release does not require republishing unchanged packages. Git tags and release notes must identify the exact package versions published.
