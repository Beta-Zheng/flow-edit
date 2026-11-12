'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { EditorState, StateField } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');
const { editorExtension, refresh } = require('../src/editor');

const scenarios = [
  { name: 'normal heading', space: 80, foldLeft: 56 },
  { name: 'scaled heading', space: 80, foldLeft: 56, scale: 2 },
  { name: 'wider native folding target', space: 80, foldLeft: 35 },
  { name: 'compact heading handle', space: 60, foldLeft: 36, compact: true },
  { name: 'heading without enough margin', space: 40, foldLeft: 16, hidden: true },
  { name: 'folding target temporarily absent', space: 80 },
  { name: 'ordinary paragraph in a narrow margin', space: 40, text: '正文', compact: true },
];

for (const scenario of scenarios) {
  test('block handles preserve a separate folding lane: ' + scenario.name, () => {
    const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
    const doc = dom.window.document,
      previous = {};
    for (const key of [
      'window',
      'document',
      'MutationObserver',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Window',
    ]) {
      previous[key] = global[key];
      const value = dom.window[key];
      global[key] = /AnimationFrame/.test(key) ? value.bind(dom.window) : value;
    }
    let view;
    try {
      const style = doc.createElement('style');
      style.textContent = fs.readFileSync(require.resolve('../styles.css'), 'utf8');
      doc.head.append(style);
      const context = { editor: {}, file: { path: 'heading.md' } };
      const field = StateField.define({ create: () => context, update: (value) => value });
      const plugin = { settings: { blockHandles: true }, editors: new Set() };
      view = new EditorView({
        state: EditorState.create({
          doc: scenario.text || '## 内容与结论',
          extensions: [field, editorExtension(plugin, { editorInfoField: field })],
        }),
        parent: doc.body,
      });
      const scale = scenario.scale || 1,
        hostLeft = 100;
      const rect = (left, right) => ({
        left,
        right,
        top: 20,
        bottom: 60,
        width: right - left,
        height: 40,
      });
      Object.defineProperty(view.dom, 'offsetWidth', { value: 1000 });
      view.dom.getBoundingClientRect = () => rect(hostLeft, hostLeft + 1000 * scale);
      view.scrollDOM.getBoundingClientRect = () => rect(hostLeft, hostLeft + 1000 * scale);
      view.contentDOM.getBoundingClientRect = () =>
        rect(hostLeft + scenario.space * scale, hostLeft + 1000 * scale);
      view.contentDOM.style.paddingLeft = '0px';
      view.coordsAtPos = () => rect(hostLeft + scenario.space * scale, hostLeft + 200 * scale);
      const measures = [];
      view.requestMeasure = (request) => {
        if (request?.read) measures.push(request);
      };
      view.dispatch({ effects: refresh.of(null) });
      // Obsidian supplies its folding control after CodeMirror redraws the line.
      if (scenario.foldLeft != null) {
        const wrapper = doc.createElement('span');
        wrapper.className = 'cm-fold-indicator';
        const arrow = doc.createElement('span');
        arrow.className = 'collapse-indicator';
        arrow.contentEditable = 'false';
        arrow.getBoundingClientRect = () =>
          rect(hostLeft + scenario.foldLeft * scale, hostLeft + scenario.space * scale);
        wrapper.append(arrow);
        view.contentDOM.querySelector('.cm-line').prepend(wrapper);
      }
      for (const request of measures) request.write(request.read(view), view);
      const button = view.dom.querySelector('.flow-block-handle');
      if (scenario.hidden) {
        assert.equal(button, null, "a handle must not take the native folding target's space");
      } else {
        assert.ok(button, 'a handle remains available when it fits');
        const width = parseFloat(dom.window.getComputedStyle(button).width);
        const left = hostLeft + parseFloat(button.style.left) * scale;
        const right = left + width * scale;
        assert.ok(left >= hostLeft, 'the button stays inside the visible margin');
        assert.ok(right < hostLeft + scenario.space * scale, 'the button stays outside the text');
        if (scenario.foldLeft != null) {
          assert.ok(
            hostLeft + scenario.foldLeft * scale - right >= 12 * scale,
            'leave at least 12 CSS pixels between the two clickable targets',
          );
        } else if (!scenario.text) {
          assert.ok(
            right <= hostLeft + (scenario.space - 36) * scale,
            'reserve the folding lane before a heading arrow is rendered',
          );
        }
        if (scenario.compact) assert.ok(button.classList.contains('flow-handle-compact'));
      }
      assert.equal(view.contentDOM.style.paddingLeft, '0px', 'do not shift the Markdown column');
    } finally {
      view?.destroy();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete global[key];
        else global[key] = value;
      }
      dom.window.close();
    }
  });
}
