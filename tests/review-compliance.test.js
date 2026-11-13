'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { ESLint } = require('eslint');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('review findings remain enforced by strict compiler and lint gates', async () => {
  const config = JSON.parse(read('tsconfig.json'));
  assert.equal(config.compilerOptions.strict, true);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts.check.includes('npm run typecheck'));
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit');
  const lint = await new ESLint({ cwd: root }).calculateConfigForFile(
    path.join(root, 'src/core.ts'),
  );
  for (const rule of [
    'no-unsafe-member-access',
    'no-unsafe-argument',
    'no-unsafe-assignment',
    'no-unsafe-call',
    'no-unsafe-return',
    'no-require-imports',
    'no-explicit-any',
  ]) {
    assert.equal(lint.rules['@typescript-eslint/' + rule][0], 2, rule + ' must fail CI');
  }
  // A real, unique file avoids reusing the project's cached core.ts type graph.
  const probePath = path.join(root, 'src', `review-negative-probe-${process.pid}.ts`);
  let probe;
  try {
    fs.writeFileSync(probePath, 'export function unsafeProbe(value: any) { return value.path; }');
    [probe] = await new ESLint({ cwd: root }).lintFiles([probePath]);
  } finally {
    fs.rmSync(probePath, { force: true });
  }
  assert.ok(
    probe.messages.some(
      (message) => message.ruleId === '@typescript-eslint/no-unsafe-member-access',
    ),
  );
  assert.ok(
    probe.messages.some((message) => message.ruleId === '@typescript-eslint/no-explicit-any'),
  );
  for (const name of fs
    .readdirSync(path.join(root, 'src'))
    .filter((name) => name.endsWith('.ts'))) {
    const source = read('src/' + name);
    assert.doesNotMatch(source, /@ts-(?:ignore|nocheck|expect-error)|eslint-disable/);
    const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, name + ': explicit any');
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
});

test('release assets are attested and verified before public upload', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /uses: actions\/attest@[a-f0-9]{40}/);
  const start = workflow.indexOf('subject-path:');
  assert.ok(start >= 0);
  for (const file of ['main.js', 'manifest.json', 'styles.css'])
    assert.ok(workflow.slice(start).includes('release/flow-edit/' + file));
  assert.ok(workflow.indexOf('gh attestation verify') > start);
  assert.ok(workflow.indexOf('gh release create') > workflow.indexOf('gh attestation verify'));
});

test('control CSS avoids all reported compatibility and selector warnings', () => {
  assert.doesNotMatch(read('styles.css'), /!important|:has\(|scrollbar-width\s*:/);
  assert.match(read('styles.css'), /\.cm-tooltip\.flow-toolbar-tooltip/);
  assert.match(read('src/editor.ts'), /'flow-toolbar-tooltip'/);
});
