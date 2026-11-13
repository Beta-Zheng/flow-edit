'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  validateManifest,
  validateProject,
  validateRelease,
  assets,
} = require('../scripts/validate.cjs');
const root = path.resolve(__dirname, '..');
const { validateTrackedFiles } = require('../scripts/release-preflight.cjs');

test('public release requires tracked sources and excludes personal files or credentials', () => {
  const names = [
    'manifest.json',
    'versions.json',
    'README.md',
    'LICENSE',
    'styles.css',
    'package.json',
    'package-lock.json',
    'src/plugin.ts',
    'src/core.ts',
    'src/dom.ts',
    'scripts/compile.cjs',
    'src/images.ts',
    'src/editor.ts',
    'src/ui.ts',
    'src/reading.ts',
    'scripts/build.cjs',
    'scripts/validate.cjs',
    '.github/workflows/check.yml',
    '.github/workflows/release.yml',
  ];
  validateTrackedFiles(names, () => 'safe content');
  assert.throws(
    () =>
      validateTrackedFiles(
        names.filter((n) => n !== 'src/plugin.ts'),
        () => '',
      ),
    /not committed/,
  );
  assert.throws(
    () => validateTrackedFiles([...names, 'data.json'], () => ''),
    /Private\/generated/,
  );
  assert.throws(() => validateTrackedFiles([...names, 'main.js'], () => ''), /Private\/generated/);
  const token = 'gh' + 'p_' + 'x'.repeat(36);
  assert.throws(() => validateTrackedFiles(names, () => token), /Potential credential/);
});

test('manifest and exact release tag are validated together', () => {
  const manifest = validateProject();
  validateProject(manifest.version);
  assert.throws(() => validateProject('v' + manifest.version), /exactly match/);
  for (const id of ['Bad ID', 'obsidian-flow', 'flow-plugin'])
    assert.throws(() => validateManifest({ ...manifest, id }));
  assert.throws(() => validateManifest({ ...manifest, description: 'Missing punctuation' }));
});

test('development verification cannot contaminate the normal or release build', () => {
  const normal = fs.readFileSync(path.join(root, 'main.js'));
  execFileSync(process.execPath, ['scripts/build.cjs', '--host-qa'], { cwd: root });
  assert.ok(fs.readFileSync(path.join(root, 'main.js')).equals(normal));
  assert.match(
    fs.readFileSync(path.join(root, '.host-build/flow-edit/main.js'), 'utf8'),
    /verify-installed-fixes/,
  );
  const bad = spawnSync(process.execPath, ['scripts/build.cjs', '--host-qa', '--release'], {
    cwd: root,
  });
  assert.notEqual(bad.status, 0);
  assert.ok(fs.readFileSync(path.join(root, 'main.js')).equals(normal));
  assert.doesNotMatch(normal.toString(), /verify-installed-fixes|node:crypto|node:fs/);
});

test('release validation rejects private settings and mismatched artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-edit-release-'));
  try {
    for (const file of assets) fs.copyFileSync(path.join(root, file), path.join(dir, file));
    validateRelease(dir);
    fs.writeFileSync(path.join(dir, 'data.json'), '{"personal":true}');
    assert.throws(() => validateRelease(dir), /Unexpected release files/);
    fs.unlinkSync(path.join(dir, 'data.json'));
    fs.appendFileSync(path.join(dir, 'main.js'), '\n// changed');
    assert.throws(() => validateRelease(dir), /Release differs from source/);
  } finally {
    // Only remove the scratch directory just created directly inside tmpdir.
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('flow-edit-release-'));
    fs.rmSync(dir, { recursive: true });
  }
});
