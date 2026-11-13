'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '..');
const themeDirectory = process.env.FLOW_EDIT_THEME_DIR;
test(
  'theme styles native Obsidian elements with no plugin or Things dependency',
  {
    skip:
      !themeDirectory && 'Set FLOW_EDIT_THEME_DIR to opt into the companion theme contract check',
  },
  () => {
    const css = fs.readFileSync(path.join(themeDirectory, 'theme.css'), 'utf8');
    assert.doesNotMatch(css, /\.flow-[\w-]+|--flow-|@import|url\(/);
    for (const selector of [
      '.theme-light',
      '.theme-dark',
      '.markdown-rendered',
      '.callout-title',
      '.cm-header-2',
    ])
      assert.ok(css.includes(selector), selector);
    assert.match(css, /data-callout-metadata="compact"/);
    const manifest = JSON.parse(fs.readFileSync(path.join(themeDirectory, 'manifest.json')));
    assert.equal(manifest.name, 'Lumen Docs');
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  },
);
test('plugin contains only control styling and explicit user formatting', () => {
  const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8');
  assert.doesNotMatch(
    css,
    /flow-page|flow-preview|HyperMD-header|HyperMD-quote|--file-line-width|--font-text-size|--lumen-/,
  );
  // Native callouts are styled only when explicitly opted into an image group.
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const selector = rule.slice(0, rule.indexOf('{'));
    if (selector.includes('.callout'))
      assert.ok(
        selector
          .split(',')
          .every(
            (part) =>
              part.includes('[data-callout^="flow-gallery-"]') ||
              part.includes('[data-callout="flow-gallery-'),
          ),
      );
  }
  for (const name of ['editor.ts', 'reading.ts', 'plugin.ts']) {
    const js = fs.readFileSync(path.join(base, 'src', name), 'utf8');
    assert.doesNotMatch(
      js,
      /documentStyle|pageWidth|fontSize|lineHeight|compactCallouts|Lumen Docs.*(?:===|!==)/,
      name,
    );
  }
  assert.match(css, /\.flow-popup/);
  assert.match(css, /\.flow-background-yellow/);
});
