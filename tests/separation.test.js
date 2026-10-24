'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '..');
test('theme styles native Obsidian elements with no plugin or Things dependency', {skip:!fs.existsSync(path.join(base,'../lumen-docs/theme.css')) && 'Optional sibling lumen-docs repository is not checked out'}, () => {
  const css = fs.readFileSync(path.join(base, '../lumen-docs/theme.css'), 'utf8');
  assert.doesNotMatch(css, /\.flow-[\w-]+|--flow-|@import|url\(/);
  for (const selector of ['.theme-light', '.theme-dark', '.markdown-rendered h2', '.callout-title', '.cm-header-2']) assert.ok(css.includes(selector), selector);
  assert.match(css, /data-callout-metadata="compact"/);
  const manifest = JSON.parse(fs.readFileSync(path.join(base, '../lumen-docs/manifest.json')));
  assert.equal(manifest.name, 'Lumen Docs'); assert.equal(manifest.version, '1.0.0');
});
test('plugin contains only control styling and explicit user formatting', () => {
  const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /flow-page|flow-preview|HyperMD-header|HyperMD-quote|\.callout|--file-line-width|--font-text-size|--lumen-/);
  for (const name of ['editor.js','reading.js','plugin.js']) {
    const js = fs.readFileSync(path.join(base, name), 'utf8');
    assert.doesNotMatch(js, /documentStyle|pageWidth|fontSize|lineHeight|compactCallouts|Lumen Docs.*(?:===|!==)/, name);
  }
  assert.match(css, /\.flow-popup/); assert.match(css, /\.flow-background-yellow/);
});
