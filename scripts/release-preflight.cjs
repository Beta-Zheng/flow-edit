'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { validateProject, validateRelease } = require('./validate.cjs');
const root = path.resolve(__dirname, '..');
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}
function validateTrackedFiles(files, read) {
  const required = [
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
  for (const name of required)
    assert.ok(files.includes(name), 'Required source is not committed: ' + name);
  for (const name of files) {
    assert.ok(
      !/^(?:main\.js$|(?:node_modules|release|\.host-build|\.npm-cache)\/)|(?:^|\/)(?:data\.json|\.env(?:\..*)?|verification[^/]*)$/.test(
        name,
      ),
      'Private/generated file is tracked: ' + name,
    );
    if (!/\.(?:[cm]?js|ts|json|ya?ml|md|html|css)$/.test(name)) continue;
    const text = read(name);
    assert.ok(
      !/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(
        text,
      ),
      'Potential credential in tracked file: ' + name,
    );
  }
}
function preflight() {
  const manifest = validateProject();
  validateRelease();
  const files = git(['ls-tree', '-r', '--name-only', 'HEAD']).trim().split(/\r?\n/);
  validateTrackedFiles(files, (name) => git(['show', 'HEAD:' + name]));
  assert.ok(
    files.includes('docs/releases/' + manifest.version + '.md'),
    'Commit release notes for the current version',
  );
  assert.equal(
    git(['status', '--porcelain']).trim(),
    '',
    'Commit reviewed source changes before publishing',
  );
  const committed = JSON.parse(git(['show', 'HEAD:manifest.json']));
  assert.equal(committed.version, manifest.version, 'Committed and built versions differ');
  const hashes = Object.fromEntries(
    ['main.js', 'manifest.json', 'styles.css'].map((name) => [
      name,
      require('node:crypto')
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, 'release', 'flow-edit', name)))
        .digest('hex'),
    ]),
  );
  console.log(
    JSON.stringify(
      { version: manifest.version, commit: git(['rev-parse', 'HEAD']).trim(), assets: hashes },
      null,
      2,
    ),
  );
}
if (require.main === module) preflight();
module.exports = { validateTrackedFiles };
