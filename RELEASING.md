# Releasing Flow Edit

## Prepare locally

1. Preserve user changes and update `CHANGELOG.md`.
2. Run `npm version patch --no-git-tag-version` (or `minor`/`major`). The version hook synchronizes `manifest.json` and `versions.json`; npm updates `package-lock.json`. Review all changes.
3. Run `npm run check`, `npm run format:check` and `npm run release`.
4. Check a clean test vault on supported desktop/mobile targets. API compatibility checks do not replace testing the oldest supported app version or touch interactions.
5. Review the author attribution and manifest description before a public submission. The current author is the project group `Flow Edit contributors`; this must match the actual maintainers' attribution.

`release/flow-edit/` contains exactly:

```text
main.js
manifest.json
styles.css
README.md
LICENSE
```

For manual installation, put this folder under `<vault-config-dir>/plugins/flow-edit/`. Preserve an existing `data.json`. Never distribute a personal configuration, `.git`, `node_modules`, preview, host verifier or verification report.

## GitHub release

Obsidian downloads **individual** `main.js`, `manifest.json` and `styles.css` assets from the GitHub release whose tag exactly matches `manifest.version`. A ZIP alone is insufficient. The tag must be `0.3.4`, not `v0.3.4`, for this version.

The release workflow validates that relationship, runs checks, builds normal artifacts and publishes those three assets when a version tag is pushed. Review and commit source changes first. Configure the actual repository/maintainers before intentionally pushing a release tag. No remote publication is performed by the local check/build commands.

## Community directory submission

The publication target is `Beta-Zheng/flow-edit`. A local standards check is not an Obsidian review or acceptance. Before submission, maintainers must verify the public GitHub repository, confirm the ID/name is available in the directory, create a matching release, and complete the current community-directory ownership/submission process. See [the submission checklist](docs/community-submission.md).

After committing reviewed changes, run `npm run release:preflight`. It verifies the committed source set, a clean worktree, private/generated-file exclusions and the release assets, and prints their SHA256 hashes. The GitHub release workflow repeats this check before publication.

Keep `minAppVersion` accurate. It remains `1.5.0` because the runtime continues using APIs available at that level; the official API linter is part of CI. Test the oldest supported version before publicly claiming full compatibility. `isDesktopOnly` remains `false` because the distributed runtime has no Node.js/Electron imports; mobile interaction acceptance remains a separate check.

Official references:

- [Plugin submission](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Manifest](https://docs.obsidian.md/Reference/Manifest)
- [Versions](https://docs.obsidian.md/Reference/Versions)
