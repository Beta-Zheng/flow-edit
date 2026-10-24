'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../core');
const apply = (text, change) => text.slice(0, change.from) + change.insert + text.slice(change.to);
test('callout type switching preserves title, fold, metadata and arbitrary body bytes',()=>{
  const text='> [!tip|compact]- **自定义标题**\n> 正文\n> ```js\n> const v = 1;\n> ```\n> > 嵌套引用';
  const b=c.blocks(text)[0],change=c.setCalloutType(b,'warning');
  assert.equal(apply(text,change),text.replace('[!tip|','[!warning|'));
  assert.equal(c.setCalloutType(b,'tip'),null);assert.throws(()=>c.setCalloutType(b,'bad] type'));
  assert.equal(c.canConvert(b,'h2'),false);assert.equal(c.calloutInfo(b).fold,'-');
});
test('callout conversion preserves authored title and same type conversion is a no-op',()=>{
  const text='> [!important] 重要标题\n> 正文',b=c.blocks(text)[0];
  assert.equal(c.convertBlock(b,'callout'),null);
  assert.equal(apply(text,c.convertBlock(b,'text')),'重要标题\n正文');
});
test('prefix and callout header edits retain the selected content',()=>{
  for(const text of ['正文','> [!note|compact]- 标题\n> 正文']){
    const b=c.blocks(text)[0],range={from:text.indexOf('正文'),to:text.indexOf('正文')+2};
    const edit=c.retainSelection(b.type==='callout'?c.setCalloutType(b,'important'):c.convertBlock(b,'h2'),text,range);
    const result=apply(text,edit);assert.equal(result.slice(edit.selectFrom,edit.selectTo),'正文');
  }
});

test('slash search supports Chinese, English and heading shortcuts', () => {
  assert.equal(c.searchItems('代码')[0].id, 'code'); assert.equal(c.searchItems('h2')[0].id, 'h2');
  assert.equal(c.searchItems('table')[0].id, 'table'); assert.equal(c.searchItems('不存在').length, 0);
});
test('slash triggers on an empty line only, never URL, inline text or a code fence', () => {
  assert.equal(c.slashContext('/h2', 3).query, 'h2');
  for (const [text, pos] of [['https://abc', 10], ['正文 /h1', 6], ['```js\n/h1\n```', 9], ['---\nkey: /h1\n---', 12], ['/h1 trailing', 3], ['    /h1', 7]]) assert.equal(c.slashContext(text, pos), null, text);
});
test('scanner keeps fenced code, quote, list, table and frontmatter intact', () => {
  const text = '---\ntitle: test\n---\n\n# 标题\n\n段落\n续行\n\n- 第一\n  - 子项\n- 第二\n\n> 引用\n> 续行\n\n```js\n\n/h1\n```\n\n| a | b |\n| - | - |\n| c | d |';
  const blocks = c.blocks(text);
  assert.deepEqual(blocks.map(x => x.type), ['frontmatter', 'h1', 'text', 'bullet', 'quote', 'code', 'table']);
  assert.equal(blocks[0].protected, true); assert.match(blocks[5].text, /\n\n\/h1/);
});
test('metadata travels with its block and cannot accept arbitrary HTML or CSS', () => {
  const text = '正文', b = c.blocks(text)[0];
  const styled = apply(text, c.setBlockStyle(text, b, { align: 'center', color: 'blue' }));
  const sb = c.blocks(styled)[0]; assert.equal(sb.text, text); assert.equal(sb.style.align, 'center');
  assert.equal(apply(styled, c.setBlockStyle(styled, sb, { align: 'left', color: 'default' })), text);
  assert.throws(() => c.setBlockStyle(text, b, { color: 'red;display:none' }));
  assert.equal(c.parseStyle('<!-- flow-edit align=center color=blue background=none style=evil -->'), null);
});
test('block conversion does not lose text and is reversible through normal undo', () => {
  const text = '第一行\n第二行'; const converted = apply(text, c.convertBlock(c.blocks(text)[0], 'h2'));
  assert.equal(converted, '## 第一行\n## 第二行'); assert.equal(c.convert(converted, 'text'), text);
  assert.equal(c.convert('- [x] 已办', 'quote'), '> 已办');
  assert.equal(c.convert('', 'task'), '- [ ] ');
});
test('complex code, math and table conversions are explicitly blocked', () => {
  for (const text of ['```js\nvalue\n```', '$$\nx\n$$', '| a | b |\n| - | - |']) assert.throws(() => c.convertBlock(c.blocks(text)[0], 'h1'));
});
test('code wrapping chooses a fence longer than any contained backtick run', () => {
  assert.equal(c.convert('```\n原文\n```', 'code'), '````\n```\n原文\n```\n````');
});
test('delete first / middle / last blocks retains separation and adjacent content', () => {
  const text = '甲\n\n乙\n\n丙', bs = c.blocks(text);
  assert.equal(apply(text, c.deleteBlock(text, bs[0])), '乙\n\n丙');
  assert.equal(apply(text, c.deleteBlock(text, bs[1])), '甲\n\n丙');
  assert.equal(apply(text, c.deleteBlock(text, bs[2])), '甲\n\n乙');
});
test('move swaps complete blocks and styles without entering frontmatter', () => {
  const text = '---\na: b\n---\n\n甲\n\n' + c.styleLine({ color: 'blue' }) + '\n乙';
  const bs = c.blocks(text); assert.equal(c.moveBlock(text, bs[1], -1), null);
  const moved = apply(text, c.moveBlock(text, bs[2], -1));
  assert.deepEqual(c.blocks(moved).map(x => x.text), ['---\na: b\n---', '乙', '甲']);
  assert.equal(c.blocks(moved)[1].style.color, 'blue');
});
test('standalone complex block IDs are included in moves and deletion', () => {
  const text = '```\na\n```\n\n^my-code\n\n正文';
  assert.equal(c.blocks(text)[0].text, '```\na\n```\n\n^my-code');
  assert.equal(apply(text, c.deleteBlock(text, c.blocks(text)[0])), '正文');
});
test('inline formatting toggles surrounding or selected marks and preserves selection', () => {
  assert.equal(apply('abc', c.wrapInline('abc', 0, 3, '**')), '**abc**');
  assert.equal(apply('**abc**', c.wrapInline('**abc**', 2, 5, '**')), 'abc');
  assert.equal(apply('**abc**', c.wrapInline('**abc**', 0, 7, '**')), 'abc');
});
test('italic can be combined with existing bold without stripping the bold markers', () => {
  assert.equal(apply('**abc**', c.wrapInline('**abc**', 2, 5, '*')), '***abc***');
  assert.equal(apply('**abc**', c.wrapInline('**abc**', 0, 7, '*')), '***abc***');
});
test('inline code protects embedded backticks and nested list conversion retains indentation', () => {
  assert.equal(apply('a`b', c.wrapInline('a`b', 0, 3, '`')), '``a`b``');
  assert.equal(c.convert('- 父\n  - 子\n- 父二', 'task'), '- [ ] 父\n  - [ ] 子\n- [ ] 父二');
  assert.equal(c.blocks(c.convert('', 'divider'))[0].type, 'divider', 'a first-line divider must not become YAML');
});
test('every inline format toggles twice and preserves the same selected text', () => {
  for (const value of ['我是无序', 'a`b', '`边界`', ' 保留空格 ']) {
    for (const mark of ['**', '*', '~~', '==', '`']) {
      const original = '- ' + value;
      const first = c.wrapInline(original, 2, original.length, mark), styled = apply(original, first);
      const second = c.wrapInline(styled, first.selectFrom, first.selectTo, mark), restored = apply(styled, second);
      assert.equal(restored, original, `${mark}: ${value}`);
      assert.equal(restored.slice(second.selectFrom, second.selectTo), mark === '`' && value === '`边界`' ? '边界' : value);
    }
  }
});
