'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const assets = ['main.js', 'manifest.json', 'styles.css', 'README.md', 'LICENSE'];
const modules = ['core', 'dom', 'images', 'editor', 'plugin', 'reading', 'ui'];
const externals = new Set(['obsidian', '@codemirror/state', '@codemirror/view']);
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const semver = /^\d+\.\d+\.\d+$/;

function validateManifest(manifest) {
  for (const field of ['id', 'name', 'version', 'minAppVersion', 'description', 'author'])
    assert.equal(typeof manifest[field], 'string', field + ' must be a string');
  assert.match(manifest.id, /^[a-z]+(?:-[a-z]+)*$/);
  assert.ok(
    !manifest.id.includes('obsidian') && !manifest.id.endsWith('plugin'),
    'Invalid plugin ID',
  );
  assert.match(manifest.name, /^[A-Za-z0-9 +()-]+$/);
  assert.ok(!/obsidian|\bplugin\b/i.test(manifest.name), 'Invalid plugin name');
  assert.match(manifest.version, semver);
  assert.match(manifest.minAppVersion, semver);
  assert.ok(manifest.author.trim(), 'Author is required');
  assert.ok(
    manifest.description.length <= 250 && manifest.description.endsWith('.'),
    'Description must be <=250 characters and end with a period',
  );
  assert.equal(typeof manifest.isDesktopOnly, 'boolean');
}

function validateSources() {
  for (const name of modules) {
    const file = path.join(root, 'src', name + '.ts'),
      text = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
        assert.ok(
          ts.isStringLiteral(node.moduleSpecifier),
          file + ': static module paths required',
        );
        const id = node.moduleSpecifier.text;
        assert.ok(
          externals.has(id) || modules.some((m) => id === './' + m),
          file + ': forbidden runtime dependency ' + id,
        );
      }
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
          node.expression.kind === ts.SyntaxKind.ImportKeyword)
      ) {
        assert.fail(file + ': source must use static ESM imports');
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ['plugins', 'commands'].includes(node.name.text) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'app'
      )
        assert.fail(file + ': private App API: ' + node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.ok(
      !/(?:[A-Z]:[\\/](?:Users|charm|AI-Projects)|127\.0\.0\.1)/i.test(text),
      file + ': local development data in runtime source',
    );
  }
}

function validateProject(tag) {
  const manifest = json(path.join(root, 'manifest.json'));
  validateManifest(manifest);
  const pkg = json(path.join(root, 'package.json')),
    lock = json(path.join(root, 'package-lock.json'));
  assert.equal(pkg.version, manifest.version, 'package and manifest versions differ');
  assert.equal(lock.version, pkg.version, 'lock version differs');
  assert.equal(lock.packages[''].version, pkg.version, 'lock root version differs');
  assert.equal(
    json(path.join(root, 'versions.json'))[manifest.version],
    manifest.minAppVersion,
    'versions.json does not match the current manifest',
  );
  if (tag != null)
    assert.equal(
      tag,
      manifest.version,
      'Release tag must exactly match manifest.version (no v prefix)',
    );
  for (const file of ['README.md', 'LICENSE', 'styles.css'])
    assert.ok(fs.statSync(path.join(root, file)).size > 0, file + ' is empty');
  validateSources();
  return manifest;
}

function validateRelease(directory = path.join(root, 'release', 'flow-edit')) {
  validateProject();
  assert.deepEqual(
    fs.readdirSync(directory).sort(),
    [...assets].sort(),
    'Unexpected release files',
  );
  for (const name of assets)
    assert.ok(
      fs.readFileSync(path.join(directory, name)).equals(fs.readFileSync(path.join(root, name))),
      'Release differs from source: ' + name,
    );
  const main = fs.readFileSync(path.join(directory, 'main.js'), 'utf8');
  assert.doesNotMatch(
    main,
    /verify-installed-fixes|verification-original|Temporary, opt-in host verification|node:crypto|node:fs/,
  );
  validateManifest(json(path.join(directory, 'manifest.json')));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--release' && args.length === 1) validateRelease();
  else if (args[0] === '--tag' && args.length === 2) validateProject(args[1]);
  else if (!args.length) validateProject();
  else throw new Error('Usage: node scripts/validate.cjs [--release | --tag VERSION]');
  console.log('Plugin metadata, runtime imports and release checks passed.');
}
module.exports = { validateManifest, validateProject, validateRelease, assets };
