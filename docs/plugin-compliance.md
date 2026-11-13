# Obsidian plugin standards audit

Audit date: 2026-10-27. Scope: the Flow Edit repository, based on the existing 0.3.3 worktree, normalized as 0.3.4. Existing uncommitted work was retained. The separate Lumen Docs theme and user vault are outside the modification scope.

Public versioning was reset to 0.0.1 on 2026-11-08. Version numbers in this audit describe historical development builds, not public releases.

The table below was updated on 2026-11-13 for the strict-TypeScript and release-provenance remediation. The historical validation evidence at the end remains a record of the earlier audit; current checks must be run for each release.

| Area | Project treatment |
| --- | --- |
| Metadata | Stable `flow-edit` ID, English action description ending in a period, semantic version, project attribution and synchronized manifests/lockfile. |
| Project layout | Strict TypeScript/ESM runtime in `src/`; development utilities in `scripts/` and `dev/`; type-checked CommonJS bundle for Obsidian. |
| Official rules | All official Obsidian rules, strict TypeScript checking, `no-unsafe-*`, no explicit `any`, no suppression comments and ESM source imports. |
| Public API | Optional comments now use a public Workspace event. The runtime does not access private App plugin/command registries. |
| Window/resource ownership | Uses the editor's owning document with `activeDocument` fallback. Render children use `unload()`; listeners, observers, popups and view references are released. |
| Styling | Static probe/checkmark appearance moved to scoped CSS. Measured menu/toolbar/handle coordinates remain dynamic. The independent theme stays separate. |
| Mobile/runtime | No Node/Electron runtime imports. CodeMirror and Obsidian remain external. Desktop host QA is development-only. |
| Release assets | Individual three-file Obsidian assets plus manual-install README/LICENSE; validator rejects extra private files and mismatched bytes. Tag releases generate and verify signed GitHub provenance for all three installation files before upload. |
| Development isolation | QA builds go to `.host-build/flow-edit/`, cannot combine with `--release`, and leave normal `main.js` untouched. |
| Reproducibility | Locked development dependencies, formatter, tests, metadata checks and CI. Companion-theme testing is explicit opt-in. |
| Privacy | No runtime network calls, telemetry or self-update. Clipboard writes follow user actions; settings use Obsidian persistence; formatting remains local Markdown. |

Public submission still requires a real GitHub remote, maintainer community profile, name/ID availability, release tag/assets and the directory's review. Local automation cannot certify acceptance. Full phone and oldest-app UI verification have not been performed in this audit. Existing host QA reports are historical evidence, not a new host acceptance run.

Validation evidence: the isolated checkout (without a generated entry point, installed modules or sibling theme) completed a lockfile `npm ci --ignore-scripts`, `npm run check` and `npm run release`. The test run had 49 passing checks, one explicit optional theme check skipped, and no failures. Official API/style linting and formatting passed with no warnings. The dependency installation audit reported zero vulnerabilities after the development-only Moment override. The final comment-provider unload regression was also included in the isolated recheck.

The optional desktop host verifier uses internal diagnostic controls to exercise plugin enable/disable and save operations. These are deliberately outside the runtime source graph and release assets; they are not examples of supported production APIs.

References:

- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Plugin submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Official plugin guidelines source](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Plugin%20guidelines.md)
- [Official ESLint plugin](https://github.com/obsidianmd/eslint-plugin)
