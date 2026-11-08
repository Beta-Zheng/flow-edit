# Contributing

Flow Edit is a CommonJS JavaScript Obsidian plugin. TypeScript source is not a submission requirement; the TypeScript project supplies type information to the official Obsidian ESLint API rules. `checkJs` is disabled: this is not a claim of complete TypeScript type safety.

Use Node.js **22.14 or newer** and npm. No runtime Node.js or Electron dependency is included in the mobile-compatible plugin.

```sh
npm ci --ignore-scripts
npm run check
npm run format:check
npm run release
```

The lockfile pins development tools. The Moment override fixes a vulnerability in the development-only Obsidian types/linter dependency; Moment is not bundled into the plugin.

## Layout

```text
manifest.json           Plugin metadata used by Obsidian
versions.json           Plugin version / minimum app version map
styles.css              Plugin controls and explicit user formatting
src/                    Runtime source
  plugin.js             Plugin, settings, commands and editor transactions
  editor.js             CodeMirror extensions and their resource cleanup
  core.js               Markdown block and formatting transformations
  ui.js                 Menus and toolbars, scoped to the owning document
  reading.js            Source-range-based reading styles
scripts/                Build, validation, versioning and optional host QA
dev/                    Browser preview; never shipped in the plugin
tests/                  Automated runtime and release regression tests
.github/workflows/      Continuous checks and tag-driven GitHub releases
```

`main.js`, `release/`, `.host-build/`, previews, local configuration and verification reports are build/local artifacts. They are not source files to commit. Root `build.js` remains as a compatibility entry point.

## Checks

- `npm run lint` uses all base and type-aware `eslint-plugin-obsidianmd` rules, plus JavaScript correctness rules. Warnings fail the command. Static visual styles belong in CSS; measured positions may remain dynamic.
- `npm run validate` checks metadata, synchronized versions, the permitted runtime module graph and private App API access.
- `npm test` builds the standalone entry point and tests editor transactions, UI, unload behavior, the public comment bridge and release isolation.
- `npm run format` / `npm run format:check` maintain consistent source formatting.
- `npm run preview` serves a local demonstration at `http://127.0.0.1:18767`; `npm run preview:build` creates an offline preview.

The plugin tests do not require a sibling theme repository. To opt into the optional theme contract check, set `FLOW_EDIT_THEME_DIR` to an existing Lumen Docs checkout and run `npm test`. This check is separate from a full visual/theme acceptance test.

## Optional host QA

```sh
node scripts/build.cjs --host-qa
```

This produces **`.host-build/flow-edit/`**, leaving the normal `main.js` untouched. It may be manually installed in an isolated test vault. The development-only command expects Lumen Docs and the dedicated `测试插件.md`; it temporarily inserts test material and attempts to restore only its own known changes. Avoid concurrent editing during a host QA run. Keep a note backup. Never publish the host build.

`scripts/host-check.cjs` is an optional desktop helper for an already configured local REST API. It requires `FLOW_EDIT_REST_CONFIG` (an existing local configuration file). Its verification mode also requires `FLOW_EDIT_INSTALLED_DIR`. It does not create credentials, print credentials, or discover a personal vault. Do not commit these settings or reports. Run `node scripts/host-check.cjs --help` for the available modes.

## Runtime boundaries

- Use the public Obsidian API and `editorInfoField`; do not access `app.plugins`, `app.commands`, a global app instance or editor private fields.
- Use the editor transaction API for active notes. Do not silently rewrite frontmatter, duplicate titles or source whitespace.
- Resolve DOM and clipboard operations through the owning document/window. Release listeners, observers, animation frames and render children on teardown.
- Keep appearance in the separate theme. Flow Edit owns only its UI and formatting explicitly selected by the user.
- External Obsidian/CodeMirror modules remain host-provided. New runtime modules must be added to the build/validation allowlists deliberately.

See [RELEASING.md](RELEASING.md) and [docs/plugin-compliance.md](docs/plugin-compliance.md).
