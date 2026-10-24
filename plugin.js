'use strict';
const O = require('obsidian');
const core = require('./core');
const ui = require('./ui');
const { editorExtension, refresh } = require('./editor');
const { readingSupport } = require('./reading');
const DEFAULTS = { slashMenu: true, blockHandles: true, selectionToolbar: true };
function offsetPos(text, offset) {
  const lines = text.slice(0, Math.max(0, offset)).split('\n'); return { line: lines.length - 1, ch: lines.at(-1).length };
}
function safeSettings(data) {
  const out = { ...DEFAULTS };
  for (const key of ['slashMenu', 'blockHandles', 'selectionToolbar']) if (typeof data?.[key] === 'boolean') out[key] = data[key];
  return out;
}
function destination(value) {
  const url = value.trim();
  if (!url || /[<>\r\n]/.test(url) || /^(?:javascript|vbscript|data):/i.test(url.replace(/\s/g, ''))) throw new Error('请输入网页地址或库内附件路径');
  return '<' + url + '>';
}
class LinkModal extends O.Modal {
  constructor(plugin, options) { super(plugin.app); this.plugin = plugin; this.options = options; plugin.modals.add(this); }
  onOpen() {
    const { image, initial = '', submit } = this.options, doc = this.contentEl.ownerDocument;
    this.titleEl.textContent = image ? '插入图片' : '插入链接';
    const form = ui.el(doc, 'form', 'flow-link-form');
    const nameLabel = ui.el(doc, 'label', '', image ? '图片说明' : '显示文字');
    const name = ui.el(doc, 'input'); name.type = 'text'; name.value = initial; name.placeholder = image ? '图片说明（可选）' : '链接文字'; nameLabel.append(name);
    const urlLabel = ui.el(doc, 'label', '', image ? '图片地址或附件路径' : '链接地址');
    const url = ui.el(doc, 'input'); url.type = 'text'; url.placeholder = image ? '附件/图片.png 或 https://…' : 'https://…'; url.required = true; urlLabel.append(url);
    const error = ui.el(doc, 'div', 'flow-form-error'); error.setAttribute('role', 'alert');
    const row = ui.el(doc, 'div', 'flow-form-actions');
    const cancel = ui.el(doc, 'button', '', '取消'); cancel.type = 'button'; cancel.onclick = () => this.close();
    const save = ui.el(doc, 'button', 'mod-cta', '插入'); save.type = 'submit'; row.append(cancel, save);
    form.append(nameLabel, urlLabel, error, row); this.contentEl.append(form);
    form.addEventListener('submit', e => {
      e.preventDefault();
      try {
        const dest = destination(url.value), label = (name.value || url.value).replace(/([\\\[\]])/g, '\\$1').replace(/[\r\n]/g, ' ');
        submit(`${image ? '!' : ''}[${label}](${dest})`); this.close();
      } catch (err) { error.textContent = err.message; }
    });
    url.focus();
  }
  onClose() { this.plugin.modals.delete(this); this.contentEl.replaceChildren(); }
}
class SlashSuggest extends O.EditorSuggest {
  constructor(plugin) {
    super(plugin.app); this.plugin = plugin; this.limit = 30; this.cache = new WeakMap();
    this.setInstructions([{ command: '↑ ↓', purpose: '选择' }, { command: '↵', purpose: '插入' }, { command: 'esc', purpose: '关闭' }]);
  }
  onTrigger(cursor, editor, file) {
    if (!this.plugin.settings.slashMenu || !file || editor.somethingSelected()) return null;
    const text = editor.getValue(); let cached = this.cache.get(editor);
    if (!cached || cached.text !== text) { cached = { text, blocks: core.blocks(text) }; this.cache.set(editor, cached); }
    const ctx = core.slashContext(text, editor.posToOffset(cursor), cached.blocks);
    return ctx ? { start: editor.offsetToPos(ctx.from), end: cursor, query: ctx.query } : null;
  }
  getSuggestions(ctx) { return core.searchItems(ctx.query); }
  renderSuggestion(item, el) {
    this.doc = el.ownerDocument; el.classList.add('flow-slash-item');
    el.closest('.suggestion-container')?.classList.add('flow-slash');
    el.append(ui.itemRow(el.ownerDocument, item, O.setIcon));
  }
  selectSuggestion(item) {
    const ctx = this.context; if (!ctx) return;
    const editor = ctx.editor, from = editor.posToOffset(ctx.start), to = editor.posToOffset(ctx.end);
    this.close(); this.plugin.insert(editor, ctx.file, item.id, { from, to }, this.doc || document);
  }
}
class SettingsTab extends O.PluginSettingTab {
  constructor(plugin) { super(plugin.app, plugin); this.plugin = plugin; }
  display() {
    const p = this.plugin, root = this.containerEl; root.replaceChildren();
    root.append(ui.el(root.ownerDocument, 'h2', '', 'Flow Edit · 流式编辑'));
    root.append(ui.el(root.ownerDocument, 'p', 'setting-item-description', '像文档一样写作，保留 Markdown 的自由。'));
    for (const [key, title, desc] of [
      ['slashMenu', '斜杠插入菜单', '在空行输入 /，支持中文和英文关键词。若启用了 Obsidian 核心斜杠命令，请关闭它以避免菜单竞争。'],
      ['blockHandles', '块操作入口', '悬停块或聚焦编辑位置时，在正文左侧显示当前块入口；不占正文宽度。'],
      ['selectionToolbar', '浮动格式工具栏', '完成文字选择、松开鼠标或选择按键后显示，拖选过程中保持隐藏。']
    ]) new O.Setting(root).setName(title).setDesc(desc).addToggle(t => t.setValue(p.settings[key]).onChange(v => p.updateSetting(key, v)));
    root.append(ui.el(root.ownerDocument, 'p', 'setting-item-description', '主题与文档排版由 Obsidian 外观设置管理，可独立选择 Lumen Docs 或任意主题。'));
    root.append(ui.el(root.ownerDocument, 'p', 'setting-item-description', '颜色与对齐保存在对应块前的 flow-edit HTML 注释中。停用后正文仍是 Markdown，重新启用恢复样式。插件不联网。'));
  }
}
class FlowEdit extends O.Plugin {
  async onload() {
    this.settings = safeSettings(await this.loadData()); this.editors = new Set(); this.readers = new Set(); this.modals = new Set(); this.saveQueue = Promise.resolve();
    this.registerEditorExtension(editorExtension(this, O));
    this.suggest = new SlashSuggest(this); this.registerEditorSuggest(this.suggest);
    const Reading = readingSupport(this, O);
    this.registerMarkdownPostProcessor((el, ctx) => ctx.addChild(new Reading(el, ctx)));
    this.addSettingTab(new SettingsTab(this));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      if (!view.file) return;
      const offset=editor.posToOffset(editor.getCursor());
      if(core.blockAt(editor.getValue(),offset).type==='callout')menu.addItem(item=>item.setTitle('更改高亮块类型…').setIcon('panel-top').onClick(()=>this.openCalloutTypes(editor,view.file,offset)));
      menu.addItem(item => item.setTitle('Flow Edit · 块操作').setIcon('grip-vertical').onClick(() => this.openBlock(editor, view.file, editor.posToOffset(editor.getCursor()))));
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{if(leaf && (!this.popupSession || leaf.view?.editor!==this.popupSession.editor))this.closePopup('leaf-change');}));
    // Obsidian can deliver editor-change after a new panel has already opened.
    // Close only if that panel's captured document has actually changed.
    this.registerEvent(this.app.workspace.on('editor-change',()=>{if(this.popup && this.popupSession && !this.popupSession.valid())this.closePopup();}));
    this.addCommand({ id: 'block-menu', name: '打开块操作菜单', editorCallback: (editor, ctx) => this.openBlock(editor, ctx.file, editor.posToOffset(editor.getCursor())) });
    this.addCommand({ id: 'insert-menu', name: '插入内容块', editorCallback: (editor, ctx) => this.openInsert(editor, ctx.file) });
    this.addCommand({id:'block-type',name:'转换块类型',editorCallback:(editor,ctx)=>this.openBlockTypes(editor,ctx.file,editor.posToOffset(editor.getCursor()))});
    this.addCommand({id:'callout-type',name:'选择高亮块类型',editorCallback:(editor,ctx)=>this.openCalloutTypes(editor,ctx.file,editor.posToOffset(editor.getCursor()))});
    for (const item of core.ITEMS.filter(x => !['link', 'image'].includes(x.id))) {
      this.addCommand({ id: `format-${item.id}`, name: `设置为${item.label}`, editorCallback: (editor, ctx) => this.perform(editor, ctx.file, () => {
        const b = core.blockAt(editor.getValue(), editor.posToOffset(editor.getCursor())); this.change(editor, core.convertBlock(b, item.id));
      }) });
    }
    this.addRibbonIcon('text-cursor-input', 'Flow Edit · 插入内容', () => {
      const v = this.app.workspace.getActiveViewOfType(O.MarkdownView);
      if (v?.getMode() === 'source' && v.file) this.openInsert(v.editor, v.file); else new O.Notice('请先打开 Markdown 笔记的编辑视图');
    });
  }
  clearPopupTarget() { this.popupTargetMarker?.remove();this.popupTargetMarker=null; }
  markPopupTarget(editor,block) {
    const view=this.editorView(editor);if(!view)return;
    const host=view.dom.getBoundingClientRect(),bounds=ui.editorBounds(view.dom.ownerDocument,view.scrollDOM),content=view.contentDOM.getBoundingClientRect();
    const scale=host.width/(view.dom.offsetWidth||host.width||1)||1;
    const node=view.dom.querySelector(`.flow-callout-type-trigger[data-flow-callout-from="${block.from}"]`)?.closest('.callout');
    const native=node?.getBoundingClientRect(),start=view.coordsAtPos(block.contentFrom),end=view.coordsAtPos(block.to);
    const inset=(parseFloat(view.dom.ownerDocument.defaultView.getComputedStyle(view.contentDOM).paddingLeft)||0)*scale;
    const rect=native||{left:content.left+inset,right:content.right-inset,top:start?.top??bounds.top,bottom:end?.bottom??bounds.bottom};
    const top=Math.max(rect.top,bounds.top+2),bottom=Math.min(rect.bottom,bounds.bottom-2),left=Math.max(rect.left,bounds.left+2),right=Math.min(rect.right,bounds.right-2);
    const marker=this.popupTargetMarker||ui.el(view.dom.ownerDocument,'div','flow-format-target');this.popupTargetMarker=marker;
    marker.setAttribute('aria-hidden','true');if(!marker.isConnected)view.dom.append(marker);
    marker.style.cssText=`left:${(left-host.left)/scale}px;top:${(top-host.top)/scale}px;width:${Math.max(0,right-left)/scale}px;height:${Math.max(0,bottom-top)/scale}px;`;
  }
  closePopup(reason='action') { this.popup?.close(false,reason);this.clearPopupTarget(); this.popup = null; this.popupSession=null; }
  async updateSetting(key, value) {
    this.settings[key] = value; this.settings = safeSettings(this.settings); this.closePopup();
    for (const view of this.editors) view.dispatch({ effects: refresh.of(null) });
    for (const reader of this.readers) reader.repaint().catch(e => console.error('Flow Edit:', e));
    const data = { ...this.settings };
    this.saveQueue = this.saveQueue.catch(() => {}).then(() => this.saveData(data));
    try { await this.saveQueue; } catch (e) { new O.Notice('Flow Edit 设置保存失败，请重试'); console.error('Flow Edit:', e); }
  }
  session(editor, file) {
    if (!file) throw new Error('请先打开 Markdown 笔记');
    const snapshot = editor.getValue(), path = file.path;
    return { snapshot, editor, file, valid: () => {
      const leaves = this.app.workspace.getLeavesOfType('markdown');
      return !this.dead && file.path === path && editor.getValue() === snapshot && leaves.some(l => l.view.editor === editor && l.view.file === file);
    } };
  }
  perform(editor, file, action) {
    if (!file) return;
    try { const result = action(); if (result?.catch) result.catch(e => { console.error('Flow Edit:', e); new O.Notice(e.message || '操作失败'); }); }
    catch (e) { new O.Notice(e.message || '操作失败'); }
  }
  change(editor, change) {
    if (!change) return;
    const old = editor.getValue(), next = old.slice(0, change.from) + change.insert + old.slice(change.to);
    const from = change.selectFrom ?? change.cursor ?? change.from + change.insert.length;
    editor.transaction({ changes: [{ from: editor.offsetToPos(change.from), to: editor.offsetToPos(change.to), text: change.insert }],
      selection: { from: offsetPos(next, from), to: offsetPos(next, change.selectTo ?? from) } }); editor.focus();
  }
  editorView(editor) {
    return [...this.editors].find(v => v.state.field(O.editorInfoField, false)?.editor === editor);
  }
  documentFor(editor) { return this.editorView(editor)?.dom.ownerDocument || document; }
  anchor(editor, doc) {
    const view = this.editorView(editor), c = view?.coordsAtPos(editor.posToOffset(editor.getCursor()));
    if (c) return { left: c.left, bottom: c.bottom, top: c.top, right: c.right };
    // Command menus can still open while the caret is outside the rendered viewport.
    const rect = (view?.dom || doc.body).getBoundingClientRect();
    return { left: Math.max(12, rect.left + 24), bottom: Math.max(12, rect.top + 24) };
  }
  openInsert(editor, file, anchor, doc) {
    this.perform(editor, file, () => {
      doc ||= this.documentFor(editor);
      this.closePopup(); const s = this.session(editor, file); const from = editor.posToOffset(editor.getCursor('from')), to = editor.posToOffset(editor.getCursor('to'));
      this.popupSession=s;
      this.popup = ui.insertMenu({ doc, anchor: anchor || this.anchor(editor, doc), setIcon: O.setIcon, returnFocus: () => editor.focus(),
        choose: id => { if (s.valid()) this.insert(editor, file, id, { from, to }, doc); } });
    });
  }
  insert(editor, file, id, range, doc) {
    this.perform(editor, file, () => {
      doc ||= this.documentFor(editor);
      const s = this.session(editor, file), source = s.snapshot;
      if (id === 'link' || id === 'image') {
        new LinkModal(this, { image: id === 'image', initial: /^\//.test(source.slice(range.from, range.to)) ? '' : source.slice(range.from, range.to),
          submit: insert => { if (!s.valid()) throw new Error('文档已更改，请重新插入'); this.change(editor, { ...range, insert }); } }).open(); return;
      }
      const token = source.slice(range.from, range.to), before = source.slice(0, range.from).split('\n').at(-1), after = source.slice(range.to).split('\n')[0];
      const content = token.startsWith('/') ? '' : token;
      const result = core.convert(content, id);
      const prefix = before.trim() ? '\n\n' : '', suffix = after.trim() ? '\n\n' : '';
      const place = ['code', 'math'].includes(id) ? result.indexOf('\n') + 1 : result.length;
      this.change(editor, { ...range, insert: prefix + result + suffix, cursor: range.from + prefix.length + place });
    });
  }
  inline(editor, file, id, range) {
    this.perform(editor, file, () => {
      if (id === 'link') { this.insert(editor, file, id, range); return; }
      const mark = { bold: '**', italic: '*', strike: '~~', highlight: '==', 'inline-code': '`' }[id];
      if (mark) this.change(editor, core.wrapInline(editor.getValue(), range.from, range.to, mark));
    });
  }
  menuContext(editor,file,offset,anchor,doc) {
    doc ||= this.documentFor(editor);this.closePopup();const s=this.session(editor,file),block=core.blockAt(s.snapshot,offset);this.popupSession=s;
    if(block.protected)throw new Error('文档属性和 HTML 区块请直接编辑源码');
    const range={from:editor.posToOffset(editor.getCursor('from')),to:editor.posToOffset(editor.getCursor('to'))};
    if(anchor)this.markPopupTarget(editor,block);
    return {doc,block,s,range,anchor:{...(anchor||this.anchor(editor,doc)),boundary:this.editorView(editor)?.scrollDOM,fallback:this.anchor(editor,doc)},onPosition:anchor?()=>{if(s.valid())this.markPopupTarget(editor,block);else this.clearPopupTarget();}:undefined,onClose:()=>this.clearPopupTarget(),returnFocus:()=>editor.focus(),setIcon:O.setIcon};
  }
  applyMenuChange(editor,file,ctx,change) {
    this.perform(editor,file,()=>{if(!ctx.s.valid())throw new Error('文档已更改，请重新打开类型面板');this.change(editor,core.retainSelection(change,ctx.s.snapshot,ctx.range));editor.focus();});
  }
  openBlockTypes(editor,file,offset,anchor,doc) {
    this.perform(editor,file,()=>{const ctx=this.menuContext(editor,file,offset,anchor,doc);this.popup=ui.typeMenu({...ctx,choose:id=>{
      if(!ctx.s.valid()){new O.Notice('文档已更改，请重新打开类型面板');return;}
      if(id==='callout')this.openCalloutTypes(editor,file,offset,ctx.anchor,ctx.doc);
      else this.perform(editor,file,()=>this.applyMenuChange(editor,file,ctx,core.convertBlock(ctx.block,id)));
    }});});
  }
  openCalloutTypes(editor,file,offset,anchor,doc) {
    this.perform(editor,file,()=>{const ctx=this.menuContext(editor,file,offset,anchor,doc);
      if(!core.canConvert(ctx.block,'callout'))throw new Error('此复杂块请在源码中转换');
      this.popup=ui.calloutTypeMenu({...ctx,choose:type=>this.perform(editor,file,()=>{
        if(!ctx.s.valid())throw new Error('文档已更改，请重新打开类型面板');
        let change;
        if(ctx.block.type==='callout')change=core.setCalloutType(ctx.block,type);
        else {change=core.convertBlock(ctx.block,'callout');const created=core.blocks(change.insert)[0],header=core.setCalloutType(created,type);if(header)change.insert=change.insert.slice(0,header.from)+header.insert+change.insert.slice(header.to);}
        this.applyMenuChange(editor,file,ctx,change);
      })});
    });
  }
  openBlockStyle(editor,file,offset,mode,anchor,doc) {
    this.perform(editor,file,()=>{const ctx=this.menuContext(editor,file,offset,anchor,doc);this.popup=ui.styleMenu({...ctx,mode,choose:patch=>this.perform(editor,file,()=>this.applyMenuChange(editor,file,ctx,core.setBlockStyle(ctx.s.snapshot,ctx.block,patch)))});});
  }
  convertSelectedBlock(editor,file,offset,type) {
    this.perform(editor,file,()=>{const ctx=this.menuContext(editor,file,offset);this.applyMenuChange(editor,file,ctx,core.convertBlock(ctx.block,type));});
  }
  indentSelectedBlock(editor,file,offset,direction) {
    this.perform(editor,file,()=>{const ctx=this.menuContext(editor,file,offset);if(!['bullet','ordered','task'].includes(ctx.block.type))return;
      const insert=ctx.block.text.split('\n').map(line=>direction>0?'  '+line:line.replace(/^(?: {1,2}|\t)/,'')).join('\n');
      this.applyMenuChange(editor,file,ctx,{from:ctx.block.contentFrom,to:ctx.block.to,insert});
    });
  }
  commentSelection(editor,file,range) {
    if(!this.app.plugins?.getPlugin?.('feishu-comments'))return;
    editor.setSelection(editor.offsetToPos(range.from),editor.offsetToPos(range.to));
    this.app.commands.executeCommandById('feishu-comments:add-comment');
  }
  openBlock(editor, file, offset, anchor, doc) {
    this.perform(editor, file, () => {
      doc ||= this.documentFor(editor);
      this.closePopup(); const s = this.session(editor, file), b = core.blockAt(s.snapshot, offset);
      this.popupSession=s;
      if (b.protected) throw new Error('文档属性和 HTML 区块请直接编辑源码');
      const act = (action, value) => this.perform(editor, file, async () => {
        if (!s.valid()) throw new Error('文档已更改，请重新打开块菜单');
        if (action === 'convert') this.change(editor, core.convertBlock(b, value));
        if (action === 'style') this.change(editor, core.setBlockStyle(s.snapshot, b, value));
        if (action === 'delete') this.change(editor, core.deleteBlock(s.snapshot, b));
        if (action === 'move') { const change = core.moveBlock(s.snapshot, b, value); if (!change) throw new Error('已到达可移动区域的边界'); this.change(editor, change); }
        if (action === 'duplicate') this.change(editor, { from: b.to, to: b.to, insert: '\n\n' + s.snapshot.slice(b.from, b.to).replace(/(?:\n\n| )\^[\w-]+\s*$/, '') });
        if (action === 'indent') {
          if (!['bullet', 'ordered', 'task'].includes(b.type)) throw new Error('缩进适用于列表块；段落请使用对齐设置');
          this.change(editor, { from: b.contentFrom, to: b.to, insert: b.text.split('\n').map(x => value > 0 ? '  ' + x : x.replace(/^(?: {1,2}|\t)/, '')).join('\n') });
        }
        if (action === 'copy' || action === 'cut') {
          await doc.defaultView.navigator.clipboard.writeText(s.snapshot.slice(b.from, b.to));
          if (action === 'cut') { if (!s.valid()) throw new Error('内容已复制，但文档已更改，未剪切'); this.change(editor, core.deleteBlock(s.snapshot, b)); }
          else new O.Notice('已复制内容块');
        }
        if (action === 'below') {
          const text = ['link', 'image'].includes(value) ? '/' : core.convert('', value);
          this.change(editor, { from: b.to, to: b.to, insert: '\n\n' + text, cursor: b.to + 2 + (['code', 'math'].includes(value) ? text.indexOf('\n') + 1 : text.length) });
          if (['link', 'image'].includes(value)) this.insert(editor, file, value, { from: b.to + 2, to: b.to + 3 }, doc);
        }
        if (action === 'block-link') {
          if (!b.text.trim()) throw new Error('请先在正文块中输入内容');
          const match = /(?: |\n)\^([\w-]+)\s*$/.exec(b.text);
          const id = match?.[1] || 'flow-' + crypto.randomUUID().slice(0, 8);
          await doc.defaultView.navigator.clipboard.writeText(`[[${file.path.replace(/\.md$/, '')}#^${id}]]`);
          if (!match) { if (!s.valid()) throw new Error('文档已更改，请重新复制块链接'); this.change(editor, { from: b.to, to: b.to, insert: (/^h\d$/.test(b.type) || b.type === 'text' ? ' ' : '\n\n') + '^' + id }); }
          new O.Notice('已复制块链接');
        }
      });
      const comments = this.app.plugins?.getPlugin?.('feishu-comments');
      this.popup = ui.blockMenu({ doc, block: b, anchor: anchor || this.anchor(editor, doc), setIcon: O.setIcon, act, returnFocus: () => editor.focus(),
        types:()=>{if(s.valid())this.openBlockTypes(editor,file,offset,anchor,doc);},
        callouts:()=>{if(s.valid())this.openCalloutTypes(editor,file,offset,anchor,doc);},
        comment: comments ? () => {
          if (!s.valid()) return; editor.setSelection(editor.offsetToPos(b.contentFrom), editor.offsetToPos(b.to));
          this.app.commands.executeCommandById('feishu-comments:add-comment');
        } : null });
    });
  }
  onunload() {
    this.dead = true; this.closePopup(); this.suggest?.close(); for (const modal of [...this.modals]) modal.close();
    for (const view of this.editors) view.dom.classList.remove('flow-editor');
    for (const reader of this.readers) reader.onunload();
  }
}
module.exports = FlowEdit;
module.exports.safeSettings = safeSettings;
module.exports.offsetPos = offsetPos;
module.exports.destination = destination;
