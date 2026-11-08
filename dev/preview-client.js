'use strict';
const { EditorState, StateField } = require('@codemirror/state');
const { EditorView, keymap, Decoration } = require('@codemirror/view');
const { history, historyKeymap, defaultKeymap } = require('@codemirror/commands');
const { editorExtension } = require('../src/editor');
const core = require('../src/core');
const ui = require('../src/ui');
const doc = document;
window.activeDocument = doc;
const paths = {
  type: 'M4 4h16M12 4v16M8 20h8',
  'heading-1': 'M4 5v14M14 5v14M4 12h10M18 8l2-2v13',
  'heading-2': 'M3 5v14M12 5v14M3 12h9M16 9q5-5 5 1c0 2-5 4-5 8h6',
  'heading-3': 'M3 5v14M12 5v14M3 12h9M16 7h5l-3 5q5 0 3 5-2 3-5 0',
  list: 'M9 6h12M9 12h12M9 18h12M4 6h.1M4 12h.1M4 18h.1',
  'list-ordered': 'M10 6h11M10 12h11M10 18h11M3 4l2-1v5M3 12q4-3 3 1l-3 4h4',
  'square-check': 'M9 11l3 3 8-9M20 12v8H4V4h11',
  quote: 'M4 6h6v6H4V6m10 0h6v6h-6V6M10 12c0 5-3 7-6 7m16-7c0 5-3 7-6 7',
  braces: 'M9 3C5 3 7 10 3 12c4 2 2 9 6 9M15 3c4 0 2 7 6 9-4 2-2 9-6 9',
  minus: 'M4 12h16',
  link: 'M10 13l4-4M8 16l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0M16 8l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-5 0',
  image: 'M3 3h18v18H3V3M3 17l5-6 5 5 3-3 5 5M16 7h.1',
  'grip-vertical': 'M9 5h.1M9 12h.1M9 19h.1M15 5h.1M15 12h.1M15 19h.1',
  bold: 'M6 4h7a4 4 0 0 1 0 8H6V4m0 8h8a4 4 0 0 1 0 8H6v-8',
  italic: 'M10 4h10M4 20h10M15 4L9 20',
  strikethrough: 'M18 5c-6-5-13 1-8 5M4 12h16M6 19c8 5 14-2 8-7',
  highlighter: 'M8 14l6-10 6 4-6 10-6-4M7 15l-3 5h6l3-3',
  code: 'M8 6l-6 6 6 6M16 6l6 6-6 6',
  ellipsis: 'M5 12h.1M12 12h.1M19 12h.1',
  'align-left': 'M3 5h18M3 10h12M3 15h18M3 20h12',
  'align-center': 'M3 5h18M6 10h12M3 15h18M6 20h12',
  'align-right': 'M3 5h18M9 10h12M3 15h18M9 20h12',
  copy: 'M9 9h12v12H9V9M15 9V3H3v12h6',
  scissors: 'M6 3l14 18M6 21L20 3M7 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M7 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  'trash-2': 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  'arrow-up': 'M12 20V4M5 11l7-7 7 7',
  'arrow-down': 'M12 4v16M5 13l7 7 7-7',
  'chevron-left': 'M15 5l-7 7 7 7',
  'panel-top': 'M3 4h18v16H3V4M3 9h18',
  table: 'M3 3h18v18H3V3M3 9h18M3 15h18M9 3v18M15 3v18',
  'square-plus': 'M3 3h18v18H3V3M7 12h10M12 7v10',
  palette: 'M12 3C0 3 0 21 11 21c6 0-1-5 4-5h3c8-1 2-13-6-13M7 9h.1M12 6h.1M17 9h.1',
  eraser: 'M4 13l9-10 9 9-9 9H9l-5-5v-3M8 9l9 9',
};
function setIcon(node, name) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name] || 'M4 4h16v16H4V4M8 12h8M12 8v8');
  svg.append(path);
  node.replaceChildren(svg);
}
class Modal {
  constructor() {
    this.host = ui.el(doc, 'div', 'preview-modal');
    this.box = ui.el(doc, 'div', 'preview-modal-box');
    this.titleEl = ui.el(doc, 'h2');
    this.contentEl = ui.el(doc, 'div');
    this.box.append(this.titleEl, this.contentEl);
    this.host.append(this.box);
    this.host.addEventListener('click', (e) => {
      if (e.target === this.host) this.close();
    });
  }
  open() {
    doc.body.append(this.host);
    this.onOpen();
  }
  close() {
    this.host.remove();
    this.onClose?.();
  }
}
const file = { path: 'Flow Edit 使用指南.md' };
let editor, view;
const editorInfoField = StateField.define({
  create: () => ({ editor, file }),
  update: (value) => value,
});
window.FlowObsidian = {
  Plugin: class {},
  PluginSettingTab: class {},
  EditorSuggest: class {},
  Modal,
  editorInfoField,
  setIcon,
  Notice: class {
    constructor(message) {
      const n = ui.el(doc, 'div', 'preview-notice', message);
      doc.body.append(n);
      setTimeout(() => n.remove(), 3500);
    }
  },
};
const FlowEdit = require('../src/plugin');
const p = new FlowEdit();
p.settings = FlowEdit.safeSettings();
p.editors = new Set();
p.readers = new Set();
p.modals = new Set();
p.app = {
  workspace: { trigger() {}, getLeavesOfType: () => [{ view: { editor, file } }] },
  plugins: { getPlugin() {} },
};
editor = {
  getValue: () => view.state.doc.toString(),
  getCursor(which) {
    const s = view.state.selection.main;
    return this.offsetToPos(which === 'from' ? s.from : which === 'to' ? s.to : s.head);
  },
  offsetToPos(offset) {
    const l = view.state.doc.lineAt(offset);
    return { line: l.number - 1, ch: offset - l.from };
  },
  posToOffset(pos) {
    return view.state.doc.line(pos.line + 1).from + pos.ch;
  },
  somethingSelected: () => !view.state.selection.main.empty,
  transaction(tx) {
    const changes = tx.changes.map((c) => ({
      from: this.posToOffset(c.from),
      to: this.posToOffset(c.to),
      insert: c.text,
    }));
    const next = view.state.update({ changes }).state.doc;
    const off = (pos) => next.line(pos.line + 1).from + pos.ch;
    view.dispatch({
      changes,
      selection: { anchor: off(tx.selection.from), head: off(tx.selection.to) },
    });
  },
  setSelection(from, to) {
    view.dispatch({ selection: { anchor: this.posToOffset(from), head: this.posToOffset(to) } });
  },
  focus: () => view.focus(),
  cursorCoords: () => view.coordsAtPos(view.state.selection.main.head),
};
const initial =
  '让想法，自然成文。\n\n## 从一个斜杠开始\n\n在空行输入 /，插入标题、列表、引用、代码与表格。也可以点击右上角的「插入」开始。\n\n## 专注内容，轻松排版\n\n选中这段文字，试试加粗、高亮或添加链接。点击左侧的块手柄，可调整整段的颜色和对齐方式。\n\n- 写下一个想法\n- 整理成清晰的结构\n- 留出思考的空间\n\n> 好的工具，让表达更自然。\n\n## 保留你的写作习惯\n\n所有内容都保留在本地 Markdown 中。移动、复制、修改格式，随时可以撤销。\n\n';
const headingStyles = EditorView.decorations.compute(['doc'], (state) => {
  const ranges = [];
  for (const b of core.blocks(state.doc.toString())) {
    if (!/^h[1-6]$/.test(b.type)) continue;
    const n = Number(b.type[1]);
    ranges.push(
      Decoration.line({ class: 'HyperMD-header HyperMD-header-' + n }).range(b.contentFrom),
    );
    ranges.push(Decoration.replace({}).range(b.contentFrom, b.contentFrom + n + 1));
    ranges.push(Decoration.mark({ class: 'cm-header-' + n }).range(b.contentFrom + n + 1, b.to));
  }
  return Decoration.set(ranges, true);
});
let scheduled = false;
view = new EditorView({
  state: EditorState.create({
    doc: initial,
    extensions: [
      editorInfoField,
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      editorExtension(p, window.FlowObsidian),
      headingStyles,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        p.closePopup();
        doc.querySelector('#count').textContent = `${update.state.doc.length} 字符`;
        const s = update.state.selection.main,
          ctx = core.slashContext(update.state.doc.toString(), s.head);
        if (s.empty && ctx && ctx.query === '' && !scheduled) {
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            const coords = view.coordsAtPos(s.head);
            if (!coords) return;
            p.popup = ui.insertMenu({
              doc,
              anchor: coords,
              setIcon,
              returnFocus: () => view.focus(),
              choose: (id) => p.insert(editor, file, id, ctx, doc),
            });
          });
        }
      }),
    ],
  }),
  parent: doc.querySelector('#editor'),
});
doc.querySelector('#insert').onclick = () =>
  p.openInsert(editor, file, doc.querySelector('#insert').getBoundingClientRect(), doc);
doc.querySelector('#theme').onclick = () => {
  const dark = doc.body.classList.toggle('theme-dark');
  doc.body.classList.toggle('theme-light', !dark);
  p.closePopup();
};
doc.querySelector('#undo').onclick = () => {
  require('@codemirror/commands').undo(view);
  view.focus();
};
doc.querySelector('#count').textContent = `${initial.length} 字符`;
