'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const images = require('../src/images');
const { blocks } = require('../src/core');
const { JSDOM } = require('jsdom');
const apply = (text, change) => text.slice(0, change.from) + change.insert + text.slice(change.to);
const source = '![[附件/第一张.png|300]]\n\n![第二张](<附件/第二张 (1).png>)';

test('image layout preserves embeds, paths, aliases, order and neighboring text', () => {
  const text = '前文\n\n' + source + '\n\n后文';
  const target = images.galleryTarget(text, 4, 4 + source.length);
  const next = apply(text, images.layoutChange(target, 2));
  assert.equal(
    next,
    '前文\n\n> [!flow-gallery-2|widths=50,50]\n> ![[附件/第一张.png|300]]\n>\n> ![第二张](<附件/第二张 (1).png>)\n\n后文',
  );
  const gallery = images.galleryTarget(next, next.indexOf('第二张'), next.indexOf('第二张'));
  assert.equal(apply(next, images.layoutChange(gallery, 0)), text);
});

test('recognizes adjacent image paragraphs without selecting and changes existing columns', () => {
  const target = images.galleryTarget(source, 3, 3);
  assert.equal(target.images.length, 2);
  const text = apply(source, images.layoutChange(target, 2));
  const gallery = images.galleryTarget(text, text.length - 2, text.length - 2);
  assert.equal(gallery.columns, 2);
  assert.match(images.layoutChange(gallery, 3).insert, /widths=33\.33,33\.33/);
});

test('selected blank-line separators never join a gallery to neighboring prose', () => {
  const text = '前文\n\n' + source + '\n\n后文';
  const target = images.galleryTarget(text, text.indexOf('!') - 1, text.indexOf('后文'));
  const next = apply(text, images.layoutChange(target, 2));
  assert.ok(next.startsWith('前文\n\n> [!flow-gallery-2'));
  assert.ok(next.endsWith('第二张 (1).png>)\n\n后文'));
});

test('image parser supports inline embeds, escaped alt and balanced URL parentheses', () => {
  assert.deepEqual(
    images.imageTokens('![a\\]b](https://example.com/a_(b).png "Title") ![[图.webp]]'),
    ['![a\\]b](https://example.com/a_(b).png "Title")', '![[图.webp]]'],
  );
  for (const text of [
    '文字 ![[a.png]]',
    '![[note]]',
    '![[file.pdf]]',
    '![broken](x',
    '![[a.png]]\n说明',
    '[a](url)',
  ])
    assert.equal(images.imageTokens(text), null);
});

test('rejects partial embeds and protected source contexts without modifying content', () => {
  for (const text of [
    '```\n' + source + '\n```',
    '---\ncover: x\n---',
    '> ![[a.png]]\n> ![[b.png]]',
  ]) {
    assert.throws(() => images.galleryTarget(text, 0, text.length));
  }
  assert.throws(() => images.galleryTarget(source, 5, 10));
});

test('resizing preserves the neighboring pair total and other rows', () => {
  assert.deepEqual(images.resizeWidths([50, 50, 50, 50], 2, 0, 20), [70, 30, 50, 50]);
  assert.deepEqual(images.resizeWidths([50, 50], 2, 1, 100), [10, 90]);
  assert.deepEqual(images.resizeWidths([50, 50, 50], 2, 2, 20), [50, 50, 70]);
});

test('invalid metadata is bounded, resizing rewrites only the gallery header', () => {
  const text = '> [!flow-gallery-2|widths=999,-1]\n> ![[a.png]]\n>\n> ![[b.png]]';
  const target = images.galleryTarget(text, 0, 0);
  assert.deepEqual(target.widths, [50, 50]);
  const change = images.widthChange(target, [65, 35]);
  assert.equal(change.to, text.indexOf('\n'));
  const next = apply(text, change);
  assert.equal(next.slice(next.indexOf('\n')), text.slice(text.indexOf('\n')));
  assert.equal(blocks(next)[0].type, 'callout');
});

function dragHarness(saveOverride) {
  const dom = new JSDOM(
    '<div class="callout" data-callout="flow-gallery-2" data-callout-metadata="widths=50,50"><div class="callout-content"><p><img src="a.png"></p><p><img src="b.png"></p></div></div>',
    { pretendToBeVisual: true },
  );
  const node = dom.window.document.querySelector('.callout'),
    saved = [],
    errors = [];
  const text = '> [!flow-gallery-2|widths=50,50]\n> ![[a.png]]\n>\n> ![[b.png]]';
  const captured = { snapshot: text, target: images.galleryTarget(text, 0, 0) };
  const controller = new images.ImageLayouts(
    node,
    () => captured,
    async (context, change) => {
      if (saveOverride) await saveOverride(context, change);
      saved.push(change);
    },
    (err) => errors.push(err.message),
  );
  controller.refresh();
  const content = node.querySelector('.callout-content');
  content.getBoundingClientRect = () => ({ width: 1012 });
  Object.defineProperty(content, 'offsetWidth', { value: 1012 });
  const dispatch = (type, x, target = dom.window) => {
    const event = new dom.window.MouseEvent(type, {
      clientX: x,
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  return {
    dom,
    node,
    saved,
    errors,
    controller,
    dispatch,
    handle: node.querySelector('button'),
    tick: () => new Promise((resolve) => setTimeout(resolve, 0)),
    close: () => {
      controller.destroy();
      dom.window.close();
    },
  };
}

test('drag previews widths, commits once on release and cleans up controls', async () => {
  const h = dragHarness();
  try {
    assert.equal(h.node.querySelectorAll('button').length, 1);
    h.dispatch('pointerdown', 500, h.handle);
    await h.tick();
    h.dispatch('pointermove', 700);
    assert.equal(h.node.querySelector('p').style.getPropertyValue('--flow-image-share'), '0.7');
    assert.equal(h.saved.length, 0);
    h.dispatch('pointerup', 700);
    await h.tick();
    assert.equal(h.saved.length, 1);
    assert.match(h.saved[0].insert, /widths=70,30/);
    h.controller.destroy();
    assert.equal(h.node.querySelector('button'), null);
    assert.equal(h.node.querySelector('p').style.getPropertyValue('--flow-image-share'), '');
  } finally {
    h.close();
  }
});

test('escape, pointer cancellation and disposal restore previews without saving', async () => {
  for (const action of ['escape', 'cancel', 'lost', 'dispose']) {
    const h = dragHarness();
    try {
      h.dispatch('pointerdown', 500, h.handle);
      await h.tick();
      h.dispatch('pointermove', 700);
      if (action === 'escape')
        h.dom.window.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
      if (action === 'cancel') h.dispatch('pointercancel', 700);
      if (action === 'lost') h.dispatch('lostpointercapture', 700, h.handle);
      if (action === 'dispose') h.controller.destroy();
      h.dispatch('pointerup', 700);
      await h.tick();
      assert.equal(h.saved.length, 0);
      if (action !== 'dispose')
        assert.equal(h.node.querySelector('p').style.getPropertyValue('--flow-image-share'), '0.5');
    } finally {
      h.close();
    }
  }
});

test('stale source failures are reported and previews revert', async () => {
  const h = dragHarness(() => {
    throw new Error('文档已更改');
  });
  try {
    h.dispatch('pointerdown', 500, h.handle);
    await h.tick();
    h.dispatch('pointerup', 700);
    await h.tick();
    assert.equal(h.saved.length, 0);
    assert.deepEqual(h.errors, ['文档已更改']);
    assert.equal(h.node.querySelector('p').style.getPropertyValue('--flow-image-share'), '0.5');
  } finally {
    h.close();
  }
});

test('keyboard resizing and metadata updates use the current source widths', async () => {
  const h = dragHarness();
  try {
    h.handle.dispatchEvent(
      new h.dom.window.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    );
    await h.tick();
    assert.match(h.saved[0].insert, /widths=52,48/);
    h.node.dataset.calloutMetadata = 'widths=65,35';
    h.controller.refresh();
    assert.equal(h.node.querySelector('p').style.getPropertyValue('--flow-image-share'), '0.65');
    assert.equal(h.node.querySelectorAll('button').length, 1);
  } finally {
    h.close();
  }
});

test('live preview takes ownership from nested markdown rendering without duplicate handles', () => {
  const h = dragHarness();
  let editor;
  try {
    editor = new images.ImageLayouts(
      h.node,
      () => {},
      () => {},
      () => {},
      true,
    );
    editor.refresh();
    h.controller.refresh();
    assert.equal(h.node.querySelectorAll('button').length, 1);
    assert.equal(h.controller.entries.size, 0);
    assert.equal(editor.entries.size, 1);
  } finally {
    editor?.destroy();
    h.close();
  }
});

test('reading view saves atomically and refuses an intervening source edit', async () => {
  const { readingSupport } = require('../src/reading');
  const h = dragHarness();
  h.controller.destroy();
  const source = '> [!flow-gallery-2|widths=50,50]\n> ![[a.png]]\n>\n> ![[b.png]]';
  let current = source;
  const file = { path: 'reading-images.md' };
  const plugin = {
    readers: new Set(),
    imageNotice: (message) => h.errors.push(message),
    app: {
      vault: {
        getAbstractFileByPath: () => file,
        cachedRead: async () => source,
        process: async (target, update) => {
          assert.equal(target, file);
          current = update(current);
        },
      },
    },
  };
  const Reader = readingSupport(plugin, { MarkdownRenderChild: class {} });
  const reader = new Reader(h.node, {
    sourcePath: file.path,
    getSectionInfo: () => ({ lineStart: 0, lineEnd: 4 }),
  });
  try {
    reader.onload();
    reader.images.refresh();
    const resize = () =>
      h.node.querySelector('button').dispatchEvent(
        new h.dom.window.KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      );
    resize();
    await h.tick();
    assert.match(current, /widths=52,48/);
    current = '其他编辑\n' + current;
    const intervening = current;
    resize();
    await h.tick();
    assert.equal(current, intervening);
    assert.match(h.errors.at(-1), /已更改/);
  } finally {
    reader.onunload();
    h.close();
  }
});

test('live preview resize preserves its caret outside the gallery and supports undo', async () => {
  const { EditorState, StateField } = require('@codemirror/state');
  const { EditorView, WidgetType, Decoration } = require('@codemirror/view');
  const { history, undo } = require('@codemirror/commands');
  const { editorExtension } = require('../src/editor');
  const dom = new JSDOM('<body></body>', { pretendToBeVisual: true }),
    previous = {};
  for (const key of [
    'window',
    'document',
    'MutationObserver',
    'Window',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    previous[key] = global[key];
    global[key] = /AnimationFrame/.test(key) ? dom.window[key].bind(dom.window) : dom.window[key];
  }
  let view;
  try {
    const source = '# 标题\n\n> [!flow-gallery-2|widths=50,50]\n> ![[a.png]]\n>\n> ![[b.png]]';
    const ctx = { editor: {}, file: { path: 'images.md' } };
    const field = StateField.define({ create: () => ctx, update: (value) => value });
    const plugin = {
      settings: { blockHandles: false, selectionToolbar: false },
      editors: new Set(),
      perform: (editor, file, fn) => fn(),
      change: () => {
        throw new Error('resize must not move focus through the generic edit path');
      },
    };
    const extension = editorExtension(plugin, { editorInfoField: field });
    const node = dom.window.document.createElement('div');
    node.className = 'callout';
    node.dataset.callout = 'flow-gallery-2';
    node.dataset.calloutMetadata = 'widths=50,50';
    const content = dom.window.document.createElement('div');
    content.className = 'callout-content';
    node.append(content);
    for (const name of ['a.png', 'b.png']) {
      const card = dom.window.document.createElement('p'),
        img = dom.window.document.createElement('img');
      img.src = name;
      card.append(img);
      content.append(card);
    }
    class GalleryWidget extends WidgetType {
      toDOM() {
        return node;
      }
    }
    const widgets = StateField.define({
      create: () =>
        Decoration.set([
          Decoration.replace({ widget: new GalleryWidget(), block: true }).range(
            source.indexOf('>'),
            source.length,
          ),
        ]),
      update: (value, tr) => value.map(tr.changes),
      provide: (field) => EditorView.decorations.from(field),
    });
    view = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [field, widgets, history(), extension],
      }),
      parent: dom.window.document.body,
    });
    view.plugin(extension.at(-1)).controller.refresh();
    node.querySelector('button').dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(view.state.doc.toString(), /widths=52,48/);
    assert.equal(view.state.selection.main.head, 0, 'caret remains outside the rendered callout');
    undo(view);
    assert.equal(view.state.doc.toString(), source);
  } finally {
    view?.destroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
    dom.window.close();
  }
});
