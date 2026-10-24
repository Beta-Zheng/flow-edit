'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const ui = require('../ui');
const { applyReadingStyle } = require('../reading');
const c = require('../core');
function host() { const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true }); return { dom, doc: dom.window.document }; }
const anchor = { left: 40, bottom: 40 };
test('block menu conversion, palette and alignment dispatch real actions', () => {
  const { dom, doc } = host(), actions = [], block = c.blocks('正文')[0];
  let m = ui.typeMenu({ doc, anchor, block, choose: id => actions.push(['convert',id]) });
  doc.querySelector('[aria-label="二级标题"]').click(); assert.deepEqual(actions.pop(), ['convert', 'h2']); assert.equal(m.closed, true);
  m = ui.blockMenu({ doc, anchor, block, act: (...args) => actions.push(args) });
  doc.querySelector('[aria-label="颜色"]').click(); doc.querySelector('.flow-color-blue').click();
  assert.deepEqual(actions.pop(), ['style', { color: 'blue' }]);
  m = ui.blockMenu({ doc, anchor, block, act: (...args) => actions.push(args) });
  doc.querySelector('[aria-label="缩进和对齐"]').click(); doc.querySelector('[aria-label="居中"]').click();
  assert.deepEqual(actions.pop(), ['style', { align: 'center' }]); dom.window.close();
});
test('insert search filters, keyboard chooses, Escape and outside clicks dismiss', () => {
  const { dom, doc } = host(), chosen = [];
  let m = ui.insertMenu({ doc, anchor, choose: id => chosen.push(id) });
  const input = doc.querySelector('input'); input.value = '表格'; input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(doc.querySelectorAll('[role=menuitem]').length, 1);
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(chosen, ['table']); assert.equal(m.closed, true);
  m = ui.insertMenu({ doc, anchor, choose() {} }); doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(m.closed, true);
  m = ui.insertMenu({ doc, anchor, choose() {} }); doc.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); assert.equal(m.closed, true); dom.window.close();
});
test('toolbar exposes accessible controls and retains editor selection on mousedown', () => {
  const { dom, doc } = host(); let action;
  const root = ui.toolbar(doc, id => { action = id; }); doc.body.append(root);
  const b = root.querySelector('[aria-label="加粗"]');
  const event = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  b.dispatchEvent(event); assert.equal(event.defaultPrevented, true); b.click(); assert.equal(action, 'bold'); dom.window.close();
});
test('reading style uses source line ranges and clears stale classes', () => {
  const { dom, doc } = host(), root = doc.createElement('div'); root.innerHTML = '<p>重复</p>';
  const text = '重复\n\n' + c.styleLine({ align: 'right', color: 'red' }) + '\n重复';
  applyReadingStyle(root, { lineStart: 3, lineEnd: 3 }, text); assert.equal(root.classList.contains('flow-align-right'), true);
  applyReadingStyle(root, { lineStart: 0, lineEnd: 0 }, text); assert.equal(root.classList.contains('flow-styled'), false);
  applyReadingStyle(root, { lineStart: 0, lineEnd: 3 }, text); assert.equal(root.classList.contains('flow-styled'), false);
  dom.window.close();
});
test('host button centering cannot shift ordinary block menu actions', () => {
  const { dom, doc } = host();
  const style = doc.createElement('style');
  style.textContent = 'button { justify-content: center; }\n' + fs.readFileSync(require.resolve('../styles.css'), 'utf8'); doc.head.append(style);
  const menu = ui.blockMenu({ doc, anchor, block: c.blocks('正文')[0], act() {} });
  for (const label of ['剪切', '复制', '创建副本', '向上移动', '向下移动', '删除', '复制块链接', '清除块样式']) {
    assert.equal(dom.window.getComputedStyle(doc.querySelector(`[aria-label="${label}"]`)).justifyContent, 'flex-start', label);
  }
  assert.equal(dom.window.getComputedStyle(doc.querySelector('[aria-label="转换块类型"]')).justifyContent, 'flex-start');
  menu.close(); dom.window.close();
});
test('rich toolbar exposes common actions directly with context and keyboard navigation',()=>{
  const {dom,doc}=host(), actions=[];
  const root=ui.toolbar(doc,id=>actions.push(id),null,[],{block:c.blocks('- 内容')[0],comment:true});doc.body.append(root);
  let bubbled=0;doc.body.addEventListener('click',()=>bubbled++);
  for(const label of ['转换块类型','高亮块类型','加粗','斜体','删除线','高亮','行内代码','链接','块颜色','块对齐','无序列表','有序列表','任务列表','引用','减少缩进','增加缩进','评论'])assert.ok(root.querySelector(`[aria-label="${label}"]`),label);
  assert.equal(root.querySelector('[data-flow-action="more"]'),null);
  const first=root.querySelector('button');first.focus();first.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(doc.activeElement,root.querySelectorAll('button')[1]);
  root.querySelector('[aria-label="任务列表"]').click();assert.equal(actions.pop(),'task');
  assert.equal(bubbled,0,'toolbar actions must not bubble into native editor click handlers');
  assert.equal(root.querySelector('[aria-label="增加缩进"]').hidden,false);
  ui.updateToolbar(root,[],{block:c.blocks('正文')[0]});assert.equal(root.querySelector('[aria-label="增加缩进"]').hidden,true);
  dom.window.close();
});
test('callout picker is a flat radio panel with current type and no hover submenu',()=>{
  const {dom,doc}=host(),chosen=[],block=c.blocks('> [!warning|compact]- 注意\n> 内容')[0];
  const menu=ui.calloutTypeMenu({doc,anchor,block,choose:id=>chosen.push(id)});
  assert.equal(doc.querySelectorAll('[role="menuitemradio"]').length,10);
  assert.equal(doc.querySelector('[aria-label="警告"]').getAttribute('aria-checked'),'true');
  assert.equal(doc.querySelector('.flow-chevron'),null);
  doc.querySelector('[aria-label="完成"]').click();assert.deepEqual(chosen,['success']);assert.equal(menu.closed,true);dom.window.close();
});
test('anchored menus follow editor scrolling instead of closing on focus-induced scroll',async()=>{
  const {dom,doc}=host(),button=doc.createElement('button'),scroller=doc.createElement('div');doc.body.append(button,scroller);
  button.getBoundingClientRect=()=>({left:30,top:30,bottom:60,right:80,width:50,height:30});
  const menu=ui.openPopup({doc,anchor:{left:30,bottom:60,element:button}});scroller.dispatchEvent(new dom.window.Event('scroll',{bubbles:false}));
  await new Promise(resolve=>dom.window.requestAnimationFrame(resolve));
  assert.equal(menu.closed,false);assert.equal(menu.root.style.top,'66px');menu.close();dom.window.close();
});

test('type picker keeps all headings together and focuses the current type',()=>{
  const {dom,doc}=host(),menu=ui.typeMenu({doc,anchor,block:c.blocks('#### 标题')[0],choose(){}});
  assert.deepEqual([...menu.root.querySelectorAll('[data-flow-type-group]')].map(n=>n.dataset.flowTypeGroup),['正文','标题','列表','内容块']);
  assert.deepEqual([...menu.root.querySelector('[data-flow-type-group="标题"]').querySelectorAll('button')].map(n=>n.getAttribute('aria-label')),['一级标题','二级标题','三级标题','四级标题','五级标题','六级标题']);
  assert.equal(doc.activeElement.getAttribute('aria-label'),'四级标题');menu.close();dom.window.close();
});

test('toolbar differentiates block and callout type and updates current icons',()=>{
  const {dom,doc}=host(),root=ui.toolbar(doc,()=>{},null,[],{block:c.blocks('> [!warning]\n> 正文')[0]});
  const type=root.querySelector('[data-flow-action="type"]'),callout=root.querySelector('[data-flow-action="callout"]');
  assert.equal(type.dataset.flowIcon,'panel-top');assert.equal(type.querySelector('.flow-tool-prefix').textContent,'块');
  assert.equal(callout.querySelector('.flow-tool-prefix').textContent,'标注');assert.equal(callout.querySelector('.flow-tool-label').textContent,'警告');
  ui.updateToolbar(root,[],{block:c.blocks('###### 六级标题')[0]});assert.equal(type.dataset.flowIcon,'heading-6');assert.equal(callout.querySelector('.flow-tool-prefix').textContent,'新建');dom.window.close();
});

test('popup stays inside its editor pane and retains its last valid hidden anchor',()=>{
  const {dom,doc}=host(),boundary=doc.createElement('div'),button=doc.createElement('button');doc.body.append(boundary,button);
  boundary.getBoundingClientRect=()=>({left:200,right:700,top:100,bottom:600,width:500,height:500});
  let rect={left:650,right:680,top:500,bottom:530,width:30,height:30};button.getBoundingClientRect=()=>rect;
  const menu=ui.openPopup({doc,anchor:{...rect,element:button,boundary}});
  menu.root.getBoundingClientRect=()=>({width:280,height:250});menu.position();
  assert.equal(menu.root.style.left,'412px');assert.equal(menu.root.style.top,'244px');assert.equal(menu.root.dataset.flowPlacement,'above');
  rect={left:0,right:0,top:-10000,bottom:-10000,width:0,height:0};menu.position();
  assert.equal(menu.root.style.left,'412px');assert.equal(menu.root.style.top,'244px');
  button.remove();menu.position();assert.equal(menu.root.style.left,'412px');menu.close();assert.equal(doc.querySelector('.flow-coordinate-probe'),null);dom.window.close();
});

test('popup compensates for a scaled fixed coordinate system',()=>{
  const {dom,doc}=host(),menu=ui.openPopup({doc,anchor:{left:400,top:250,bottom:280}});
  doc.querySelector('.flow-coordinate-probe').getBoundingClientRect=()=>({left:20,top:10,width:200,height:200});
  menu.root.getBoundingClientRect=()=>({width:300,height:100});menu.position();
  assert.equal(menu.root.style.left,'190px');assert.equal(menu.root.style.top,'138px');menu.close();dom.window.close();
});
test('toolbar shows and clears format pressed states', () => {
  const { dom, doc } = host(); const root = ui.toolbar(doc, () => {}, null, ['bold', 'strike']);
  assert.equal(root.querySelector('[aria-label="删除线"]').getAttribute('aria-pressed'), 'true');
  ui.updateToolbar(root, []);
  assert.equal(root.querySelector('[aria-label="删除线"]').getAttribute('aria-pressed'), 'false'); dom.window.close();
});
test('block controls are positioned out of flow and never reserve editor width', () => {
  const { dom, doc } = host(); const style = doc.createElement('style');
  style.textContent = fs.readFileSync(require.resolve('../styles.css'), 'utf8'); doc.head.append(style);
  const editor = doc.createElement('div'); editor.className = 'flow-editor';
  const content = doc.createElement('div'); content.className = 'cm-content'; content.textContent = '正文';
  const overlay = doc.createElement('div'); overlay.className = 'flow-block-overlay';
  const button = doc.createElement('button'); button.className = 'flow-block-handle'; overlay.append(button);
  editor.append(content, overlay); doc.body.append(editor);
  assert.equal(dom.window.getComputedStyle(overlay).position, 'absolute');
  assert.equal(dom.window.getComputedStyle(overlay).pointerEvents, 'none');
  assert.equal(dom.window.getComputedStyle(button).position, 'absolute');
  assert.equal(dom.window.getComputedStyle(button).pointerEvents, 'none');
  assert.equal(dom.window.getComputedStyle(button).opacity, '0');
  button.classList.add('flow-handle-revealed');
  assert.equal(dom.window.getComputedStyle(button).pointerEvents, 'auto');
  assert.equal(dom.window.getComputedStyle(button).opacity, '0.7');
  assert.equal(content.childNodes.length, 1, 'the Markdown content must not contain controls'); dom.window.close();
});
