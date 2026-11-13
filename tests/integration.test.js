'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('./helpers/dom.cjs');
const { EditorState, StateField, Transaction } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');
const { history, undo, redo } = require('@codemirror/commands');
const core = require('../.host-build/modules/core');

function harness() {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const doc = dom.window.document,
    commands = [],
    notices = [],
    callbacks = {};
  class Plugin {
    registerEditorExtension(e) {
      this.extension = e;
    }
    registerEditorSuggest(s) {
      this.suggester = s;
    }
    registerMarkdownPostProcessor() {}
    addSettingTab() {}
    registerEvent() {}
    addRibbonIcon() {}
    addCommand(c) {
      commands.push(c);
    }
    async loadData() {
      return {};
    }
    async saveData() {}
  }
  class EditorSuggest {
    setInstructions() {}
    close() {
      this.context = null;
    }
  }
  const file = { path: '测试.md', extension: 'md' },
    stateField = StateField.define({ create: () => ({ editor, file }), update: (v) => v });
  const O = {
    Plugin,
    EditorSuggest,
    Modal: class {},
    PluginSettingTab: class {},
    MarkdownRenderChild: class {},
    MarkdownView: class {},
    Notice: class {
      constructor(message) {
        notices.push(message);
      }
    },
    editorInfoField: stateField,
    setIcon() {},
  };
  const mod = { exports: {} };
  vm.runInNewContext(
    '(function(require,module,exports){' +
      fs.readFileSync(require.resolve('../main'), 'utf8') +
      '\n})',
    { console, crypto: require('node:crypto').webcrypto, document: doc, activeDocument: doc },
  )(
    (id) => {
      if (id === 'obsidian') return O;
      if (id.startsWith('.')) throw new Error('Release must not require local sources: ' + id);
      return require(id);
    },
    mod,
    mod.exports,
  );
  const p = new mod.exports();
  let state = EditorState.create({ doc: '第一段\n\n第二段', extensions: [history()] });
  const editor = {
    getValue: () => state.doc.toString(),
    getCursor: () => ({ line: 0, ch: 0 }),
    somethingSelected: () => false,
    posToOffset: (pos) => state.doc.line(pos.line + 1).from + pos.ch,
    offsetToPos: (offset) => {
      const l = state.doc.lineAt(offset);
      return { line: l.number - 1, ch: offset - l.from };
    },
    transaction(tx) {
      const changes = tx.changes.map((c) => ({
        from: editor.posToOffset(c.from),
        to: editor.posToOffset(c.to),
        insert: c.text,
      }));
      const next = state.update({ changes }).state;
      const toOffset = (pos) => next.doc.line(pos.line + 1).from + pos.ch;
      state = state.update({
        changes,
        selection: { anchor: toOffset(tx.selection.from), head: toOffset(tx.selection.to) },
      }).state;
    },
    focus() {},
    cursorCoords: () => ({ left: 100, top: 100, bottom: 125, right: 100 }),
  };
  const view = { editor, file };
  p.app = {
    workspace: {
      on: (name, fn) => {
        callbacks[name] = fn;
      },
      trigger: (name, ...args) => callbacks[name]?.(...args),
      getLeavesOfType: () => [{ view }],
      getActiveViewOfType: () => view,
    },
    plugins: { getPlugin() {} },
  };
  return {
    dom,
    doc,
    p,
    editor,
    file,
    commands,
    notices,
    O,
    module: mod.exports,
    callbacks,
    state: () => state,
    dispatch: (tx) => {
      state = state.update(tx).state;
    },
    view,
    close() {
      p.onunload();
      dom.window.close();
    },
  };
}

test('standalone build loads and registers native editor extensions, slash suggester and commands', async () => {
  const h = harness();
  await h.p.onload();
  assert.ok(h.p.extension.length);
  assert.ok(h.p.suggester);
  assert.ok(h.commands.find((c) => c.id === 'block-menu'));
  h.close();
  assert.equal(
    h.commands.some((c) => c.id === 'verify-installed-fixes'),
    false,
    'temporary host verifier must be absent from release builds',
  );
});
test('comments use the public workspace bridge and disappear without a provider', async () => {
  const h = harness();
  await h.p.onload();
  delete h.p.app.plugins;
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  assert.equal(h.doc.querySelector('[aria-label="评论"]'), null);
  let received, selected;
  h.editor.setSelection = (from, to) => {
    selected = { from, to };
  };
  h.callbacks['flow-edit:resolve-comment-provider'] = (request) => {
    request.provider = {
      addComment: (context) => {
        received = context;
      },
    };
  };
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.doc.querySelector('[aria-label="评论"]').click();
  assert.equal(received.editor, h.editor);
  assert.equal(received.file, h.file);
  assert.equal(h.editor.getValue().slice(received.range.from, received.range.to), '第一段');
  assert.deepEqual(selected.from, { line: 0, ch: 0 });
  h.p.commentSelection(h.editor, h.file, { from: 0, to: 2 });
  assert.equal(received.range.to, 2);
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  const lastReceived = received;
  delete h.callbacks['flow-edit:resolve-comment-provider'];
  h.doc.querySelector('[aria-label="评论"]').click();
  assert.equal(received, lastReceived, 'an open menu must not retain an unloaded comment provider');
  assert.equal(h.editor.getValue(), '第一段\n\n第二段');
  h.close();
});
test('reader components unload and editor documents retain their own window', async () => {
  const h = harness();
  await h.p.onload();
  const other = new JSDOM('<!doctype html><body></body>');
  const editorHost = other.window.document.createElement('div');
  h.p.editors.add({ state: { field: () => ({ editor: h.editor }) }, dom: editorHost });
  assert.equal(h.p.documentFor(h.editor), other.window.document);
  let unloaded = 0;
  h.p.readers.add({
    unload() {
      unloaded++;
    },
  });
  h.close();
  assert.equal(unloaded, 1);
  assert.equal(h.p.editors.size, 0);
  assert.equal(h.p.readers.size, 0);
  other.window.close();
});
test('native EditorSuggest recognizes slash input and inserts without private host fields', async () => {
  const h = harness();
  await h.p.onload();
  h.dispatch({ changes: { from: 0, to: h.state().doc.length, insert: '/h2' } });
  const trigger = h.p.suggester.onTrigger({ line: 0, ch: 3 }, h.editor, h.file);
  assert.equal(trigger.query, 'h2');
  h.p.suggester.context = { ...trigger, editor: h.editor, file: h.file };
  const item = h.p.suggester.getSuggestions(h.p.suggester.context)[0];
  h.p.suggester.renderSuggestion(item, h.doc.createElement('div'));
  h.p.suggester.selectSuggestion(item);
  assert.equal(h.editor.getValue(), '## ');
  h.close();
});
test('image layout menu applies an undoable gallery and refuses stale changes', async () => {
  const h = harness();
  await h.p.onload();
  try {
    const source = '![[a.png]]\n\n![[b.png]]';
    h.dispatch({
      changes: { from: 0, to: h.editor.getValue().length, insert: source },
      annotations: Transaction.addToHistory.of(false),
    });
    const command = h.commands.find((c) => c.id === 'image-layout');
    assert.ok(command);
    command.editorCallback(h.editor, { file: h.file });
    h.doc.querySelector('[aria-label="每行 2 张（均分）"]').click();
    assert.match(h.editor.getValue(), /^> \[!flow-gallery-2\|widths=50,50\]/);
    undo({ state: h.state(), dispatch: h.dispatch });
    assert.equal(h.editor.getValue(), source);
    redo({ state: h.state(), dispatch: h.dispatch });
    h.p.openImageLayout(h.editor, h.file);
    h.doc.querySelector('[aria-label="恢复普通图片"]').click();
    assert.equal(h.editor.getValue(), source + '\n\n');
    h.p.openImageLayout(h.editor, h.file);
    h.dispatch({ changes: { from: 0, insert: '新内容\n' } });
    h.doc.querySelector('[aria-label="每行 3 张（均分）"]').click();
    assert.equal(h.editor.getValue(), '新内容\n' + source + '\n\n');
    assert.match(h.notices.at(-1), /已更改/);
  } finally {
    h.close();
  }
});

test('block conversion is a single undoable CodeMirror transaction', async () => {
  const h = harness();
  await h.p.onload();
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.doc.querySelector('[aria-label="转换块类型"]').click();
  h.doc.querySelector('[aria-label="二级标题"]').click();
  assert.equal(h.editor.getValue(), '## 第一段\n\n第二段');
  undo({ state: h.state(), dispatch: h.dispatch });
  assert.equal(h.editor.getValue(), '第一段\n\n第二段');
  redo({ state: h.state(), dispatch: h.dispatch });
  assert.equal(h.editor.getValue(), '## 第一段\n\n第二段');
  h.close();
});
test('stale block menu and a changed editor binding do not mutate documents', async () => {
  const h = harness();
  await h.p.onload();
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.dispatch({ changes: { from: 0, insert: '新' } });
  h.doc.querySelector('[aria-label="删除"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.editor.getValue(), '新第一段\n\n第二段');
  assert.match(h.notices.at(-1), /已更改/);
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.view.file = { path: '另一篇.md' };
  h.doc.querySelector('[aria-label="删除"]').click();
  assert.equal(h.editor.getValue(), '新第一段\n\n第二段');
  h.close();
});
test('clipboard rejection and an intervening edit never remove content during cut', async () => {
  const h = harness();
  await h.p.onload();
  Object.defineProperty(h.dom.window.navigator, 'clipboard', {
    value: {
      writeText: async () => {
        throw new Error('剪贴板权限不足');
      },
    },
    configurable: true,
  });
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.doc.querySelector('[aria-label="剪切"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.editor.getValue(), '第一段\n\n第二段');
  Object.defineProperty(h.dom.window.navigator, 'clipboard', {
    value: {
      writeText: async () => {
        h.dispatch({ changes: { from: 0, insert: '编辑' } });
      },
    },
  });
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.doc.querySelector('[aria-label="剪切"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.editor.getValue(), '编辑第一段\n\n第二段');
  h.close();
});
test('duplicate removes block IDs and copying a block link adds an ID once', async () => {
  const h = harness();
  await h.p.onload();
  let clipboard;
  Object.defineProperty(h.dom.window.navigator, 'clipboard', {
    value: {
      writeText: async (text) => {
        clipboard = text;
      },
    },
  });
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.doc.querySelector('[aria-label="复制块链接"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(clipboard, /\[\[测试#\^flow-/);
  assert.match(h.editor.getValue(), /第一段 \^flow-/);
  h.p.openBlock(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.doc.querySelector('[aria-label="创建副本"]').click();
  assert.equal((h.editor.getValue().match(/\^flow-/g) || []).length, 1);
  assert.match(h.editor.getValue(), /\n\n第一段\n\n第二段/);
  h.close();
});
test('legacy appearance settings are ignored and unsafe link protocols are rejected', async () => {
  const h = harness();
  await h.p.onload();
  assert.deepEqual(
    Object.keys(
      h.module.safeSettings({
        pageWidth: 99999,
        fontSize: NaN,
        documentStyle: true,
        lineHeight: 2,
      }),
    ),
    ['slashMenu', 'blockHandles', 'selectionToolbar'],
  );
  assert.equal(
    h.commands.some((c) => c.id === 'toggle-document-style'),
    false,
  );
  assert.throws(() => h.module.destination('java\nscript:alert(1)'));
  assert.throws(() => h.module.destination('javascript:alert(1)'));
  assert.equal(h.module.destination('https://example.com/a (b)'), '<https://example.com/a (b)>');
  h.close();
});
test('real CodeMirror extension mounts, renders handles and styles, and cleans up', async () => {
  const h = harness();
  await h.p.onload();
  const previous = {};
  for (const key of [
    'window',
    'document',
    'MutationObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'Window',
  ]) {
    previous[key] = global[key];
    const v = h.dom.window[key];
    global[key] = typeof v === 'function' && /AnimationFrame/.test(key) ? v.bind(h.dom.window) : v;
  }
  let view;
  try {
    const ext = h.p.extension;
    const state = EditorState.create({
      doc: core.styleLine({ align: 'center', color: 'blue' }) + '\n正文',
      extensions: [h.O.editorInfoField, ext],
    });
    view = new EditorView({ state, parent: h.doc.body });
    assert.ok(view.dom.querySelector(':scope > .flow-block-overlay'));
    assert.equal(view.dom.querySelector('.flow-gutter'), null);
    assert.ok(h.doc.querySelector('.flow-align-center'));
    assert.equal(h.p.editors.size, 1);
    assert.ok(view.dom.classList.contains('flow-editor'));
    assert.equal(view.dom.classList.contains('flow-page'), false);
    assert.equal(view.dom.style.getPropertyValue('--flow-font-size'), '');
    assert.equal(view.dom.style.getPropertyValue('--flow-width'), '');
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    assert.ok(
      view.dom.classList.contains('flow-editor'),
      'CM must preserve plugin classes after an update',
    );
    await h.p.updateSetting('blockHandles', false);
    assert.equal(view.dom.classList.contains('flow-page'), false);
    view.destroy();
    view = null;
    assert.equal(h.p.editors.size, 0);
    assert.equal(h.doc.querySelector('.flow-block-overlay'), null);
  } finally {
    view?.destroy();
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete global[key];
      else global[key] = previous[key];
    }
    h.close();
  }
});
test('retained CodeMirror toolbar buttons toggle current selection twice without reselecting', async () => {
  const h = harness();
  await h.p.onload();
  const previous = {};
  for (const key of [
    'window',
    'document',
    'MutationObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'Window',
  ]) {
    previous[key] = global[key];
    const v = h.dom.window[key];
    global[key] = typeof v === 'function' && /AnimationFrame/.test(key) ? v.bind(h.dom.window) : v;
  }
  const rect = { left: 20, right: 100, top: 50, bottom: 70, width: 80, height: 20 };
  h.dom.window.Range.prototype.getClientRects = () => [rect];
  h.dom.window.Range.prototype.getBoundingClientRect = () => rect;
  let view;
  try {
    h.editor.getValue = () => view.state.doc.toString();
    h.editor.posToOffset = (pos) => view.state.doc.line(pos.line + 1).from + pos.ch;
    h.editor.offsetToPos = (offset) => {
      const l = view.state.doc.lineAt(offset);
      return { line: l.number - 1, ch: offset - l.from };
    };
    h.editor.transaction = (tx) => {
      const changes = tx.changes.map((c) => ({
        from: h.editor.posToOffset(c.from),
        to: h.editor.posToOffset(c.to),
        insert: c.text,
      }));
      const next = view.state.update({ changes }).state.doc;
      const off = (pos) => next.line(pos.line + 1).from + pos.ch;
      view.dispatch({
        changes,
        selection: { anchor: off(tx.selection.from), head: off(tx.selection.to) },
      });
    };
    view = new EditorView({
      state: EditorState.create({
        doc: '- 我是无序',
        extensions: [h.O.editorInfoField, h.p.extension],
      }),
      parent: h.doc.body,
    });
    for (const label of ['加粗', '斜体', '删除线', '高亮', '行内代码']) {
      view.dispatch({ selection: { anchor: 2, head: view.state.doc.length } });
      const button = h.doc.querySelector(`[aria-label="${label}"]`);
      assert.ok(button, label);
      button.click();
      assert.notEqual(view.state.doc.toString(), '- 我是无序', label + ' applies');
      button.click();
      assert.equal(view.state.doc.toString(), '- 我是无序', label + ' toggles off');
      assert.equal(view.state.selection.main.from, 2);
      assert.equal(view.state.selection.main.to, 6);
    }
  } finally {
    view?.destroy();
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete global[key];
      else global[key] = previous[key];
    }
    h.close();
  }
});
test('selection toolbar waits for pointer and keyboard selection completion and recovers after cancellation', async () => {
  const h = harness();
  await h.p.onload();
  const previous = {};
  for (const key of [
    'window',
    'document',
    'MutationObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'Window',
  ]) {
    previous[key] = global[key];
    const value = h.dom.window[key];
    global[key] =
      typeof value === 'function' && /AnimationFrame/.test(key) ? value.bind(h.dom.window) : value;
  }
  const rect = { left: 20, right: 100, top: 50, bottom: 70, width: 80, height: 20 };
  h.dom.window.Range.prototype.getClientRects = () => [rect];
  h.dom.window.Range.prototype.getBoundingClientRect = () => rect;
  let view;
  const wait = () =>
    new Promise((resolve) =>
      h.dom.window.requestAnimationFrame(() => h.dom.window.requestAnimationFrame(resolve)),
    );
  const toolbar = () => h.doc.querySelector('.flow-toolbar');
  const event = (target, name) =>
    target.dispatchEvent(
      new h.dom.window.MouseEvent(name, { bubbles: true, button: 0, cancelable: true }),
    );
  try {
    h.editor.getValue = () => view.state.doc.toString();
    view = new EditorView({
      state: EditorState.create({
        doc: '选择完成后才显示工具栏',
        extensions: [h.O.editorInfoField, h.p.extension],
      }),
      parent: h.doc.body,
    });
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    assert.ok(toolbar(), 'programmatic selection remains supported');
    event(view.contentDOM, 'pointerdown');
    assert.equal(toolbar(), null, 'existing toolbar hides immediately');
    for (const head of [3, 5, 8]) {
      view.dispatch({ selection: { anchor: 0, head } });
      await wait();
      assert.equal(toolbar(), null, 'held drag stays hidden despite pauses');
    }
    event(h.doc.body, 'pointerup');
    await wait();
    assert.ok(toolbar(), 'release outside content commits selection');
    assert.equal(view.state.selection.main.to, 8);
    event(toolbar().querySelector('button'), 'pointerdown');
    assert.ok(toolbar(), 'toolbar interaction does not begin a text gesture');
    event(view.contentDOM, 'pointerdown');
    view.dispatch({ selection: { anchor: 1, head: 4 } });
    event(h.doc, 'pointercancel');
    await wait();
    assert.ok(toolbar(), 'cancellation does not leave toolbar blocked');
    event(view.contentDOM, 'pointerdown');
    view.dispatch({ selection: { anchor: 4 } });
    event(h.doc, 'pointerup');
    await wait();
    assert.equal(toolbar(), null, 'empty final selection stays hidden');
    view.contentDOM.dispatchEvent(
      new h.dom.window.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    await wait();
    assert.equal(toolbar(), null, 'held keyboard selection stays hidden');
    h.doc.dispatchEvent(
      new h.dom.window.KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
    );
    await wait();
    assert.ok(toolbar(), 'keyboard release reveals selection');
    event(view.contentDOM, 'pointerdown');
    h.dom.window.dispatchEvent(new h.dom.window.Event('blur'));
    await wait();
    assert.ok(toolbar(), 'window blur releases an interrupted gesture');
    event(view.contentDOM, 'pointerdown');
    event(h.doc, 'pointerup');
    view.destroy();
    view = null;
    await wait();
    assert.equal(toolbar(), null, 'destroy cancels queued completion');
  } finally {
    view?.destroy();
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete global[key];
      else global[key] = previous[key];
    }
    h.close();
  }
});

test('callout type picker changes only the header and rejects a stale menu', async () => {
  const h = harness();
  await h.p.onload();
  const original = '> [!tip|compact]- 自定义 **标题**\n> 正文\n> > 嵌套引用';
  h.dispatch({
    changes: { from: 0, to: h.state().doc.length, insert: original },
    annotations: Transaction.addToHistory.of(false),
  });
  h.p.openCalloutTypes(h.editor, h.file, original.indexOf('正文'), { left: 10, bottom: 10 }, h.doc);
  h.doc.querySelector('[data-callout-type="warning"]').click();
  assert.equal(h.editor.getValue(), original.replace('[!tip|', '[!warning|'));
  undo({ state: h.state(), dispatch: h.dispatch });
  assert.equal(h.editor.getValue(), original);
  h.p.openCalloutTypes(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.dispatch({ changes: { from: h.state().doc.length, insert: '新增' } });
  h.doc.querySelector('[data-callout-type="success"]').click();
  assert.equal(h.editor.getValue(), original + '新增');
  assert.match(h.notices.at(-1), /已更改/);
  h.close();
});
test('delayed editor-change events do not dismiss a freshly opened unchanged panel', async () => {
  const h = harness();
  await h.p.onload();
  h.p.openCalloutTypes(h.editor, h.file, 0, { left: 10, bottom: 10 }, h.doc);
  h.callbacks['editor-change'](h.editor);
  assert.ok(h.doc.querySelector('.flow-callout-picker'));
  h.dispatch({ changes: { from: h.state().doc.length, insert: '新增' } });
  h.callbacks['editor-change'](h.editor);
  assert.equal(h.doc.querySelector('.flow-callout-picker'), null);
  h.close();
});
