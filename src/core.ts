export interface BlockStyle {
  align: string;
  color: string;
  background: string;
}
export interface Block {
  from: number;
  to: number;
  contentFrom: number;
  startLine: number;
  contentLine: number;
  endLine: number;
  type: string;
  text: string;
  protected: boolean;
  style: BlockStyle | null;
}
export interface TextRange {
  from: number;
  to: number;
}
export interface Change extends TextRange {
  insert: string;
  cursor?: number;
  selectFrom?: number;
  selectTo?: number;
}
export interface InsertItem {
  id: string;
  label: string;
  keywords: string;
  icon: string;
  group: string;
}
const COLORS = ['default', 'gray', 'red', 'orange', 'green', 'blue', 'purple'];
const BACKGROUNDS = ['none', 'gray', 'red', 'yellow', 'green', 'blue', 'purple'];
const ALIGNS = ['left', 'center', 'right'];
const CALLOUT_TYPES = [
  ['note', '笔记', 'pencil', '普通记录', 'blue'],
  ['info', '信息', 'info', '补充信息', 'blue'],
  ['tip', '提示', 'lightbulb', '建议与技巧', 'green'],
  ['important', '重要', 'star', '关键内容', 'purple'],
  ['success', '完成', 'circle-check', '结果与进展', 'green'],
  ['question', '疑问', 'circle-help', '待确认事项', 'orange'],
  ['warning', '警告', 'triangle-alert', '注意与风险', 'orange'],
  ['danger', '危险', 'octagon-alert', '严重问题', 'red'],
  ['example', '示例', 'flask-conical', '案例与演示', 'purple'],
  ['quote', '引用', 'quote', '引述内容', 'gray'],
].map(([id, label, icon, description, color]) => ({ id, label, icon, description, color }));
function calloutInfo(block: Block) {
  if (block.type !== 'callout') return null;
  const m = /^(\s*>\s*\[!)([^\]\s|]+)(\|[^\]]*)?\]([+-]?)([^\n]*)/.exec(block.text);
  if (!m) return null;
  const aliases: Record<string, string> = {
    abstract: 'note',
    summary: 'note',
    tldr: 'note',
    hint: 'tip',
    check: 'success',
    done: 'success',
    attention: 'warning',
    caution: 'warning',
    error: 'danger',
    failure: 'danger',
    fail: 'danger',
    missing: 'danger',
    bug: 'danger',
    cite: 'quote',
    faq: 'question',
    help: 'question',
  };
  const type = m[2].toLowerCase(),
    canonical = aliases[type] || type;
  return {
    type,
    canonical,
    label: CALLOUT_TYPES.find((x) => x.id === canonical)?.label || type,
    from: block.contentFrom + m[1].length,
    to: block.contentFrom + m[1].length + m[2].length,
    title: m[5].trim(),
    metadata: m[3] || '',
    fold: m[4],
    headerLength: m[0].length,
  };
}
function setCalloutType(block: Block, type: string): Change | null {
  if (!CALLOUT_TYPES.some((x) => x.id === type)) throw new Error('无效的高亮块类型');
  const info = calloutInfo(block);
  if (!info) throw new Error('请先选择高亮块');
  if (info.type === type) return null;
  return { from: info.from, to: info.to, insert: type };
}
function canConvert(block: Block, type: string) {
  if (block.protected) return false;
  if (type === block.type) return true;
  if (['code', 'math', 'table', 'indented-code'].includes(block.type)) return false;
  if (
    block.type === 'callout' &&
    /^\s*>\s*(?:>|`{3,}|~{3,}|\|)/m.test(block.text.split('\n').slice(1).join('\n'))
  )
    return false;
  return true;
}
// Trim unchanged edges so prefix/header changes keep the selected body text.
function retainSelection(change: Change | null, text: string, range?: TextRange): Change | null {
  if (!change) return null;
  const old = text.slice(change.from, change.to);
  let start = 0,
    end = 0;
  while (start < Math.min(old.length, change.insert.length) && old[start] === change.insert[start])
    start++;
  while (
    end < old.length - start &&
    end < change.insert.length - start &&
    old[old.length - 1 - end] === change.insert[change.insert.length - 1 - end]
  )
    end++;
  const from = change.from + start,
    to = change.to - end,
    insert = change.insert.slice(start, change.insert.length - end);
  if (from === to && !insert) return null;
  const delta = insert.length - (to - from),
    map = (p: number) =>
      p < from ? p : p >= to ? p + delta : from + Math.min(p - from, insert.length);
  return {
    from,
    to,
    insert,
    ...(range ? { selectFrom: map(range.from), selectTo: map(range.to) } : {}),
  };
}
const ITEMS = [
  ['text', '文本', '正文 paragraph text', 'type', '基础'],
  ['h1', '一级标题', 'heading title biaoti h1', 'heading-1', '基础'],
  ['h2', '二级标题', 'heading biaoti h2', 'heading-2', '基础'],
  ['h3', '三级标题', 'heading biaoti h3', 'heading-3', '基础'],
  ['bullet', '无序列表', 'bullet list w序 wuliebiao', 'list', '基础'],
  ['ordered', '有序列表', 'number ordered list youxu', 'list-ordered', '基础'],
  ['task', '任务列表', 'todo task checkbox renwu', 'square-check', '基础'],
  ['quote', '引用', 'quote blockquote yinyong', 'quote', '基础'],
  ['code', '代码块', 'code daima', 'braces', '基础'],
  ['divider', '分隔线', 'divider hr fengexian', 'minus', '基础'],
  ['link', '链接', 'link lianjie', 'link', '媒体与进阶'],
  ['image', '图片', 'image picture tupian', 'image', '媒体与进阶'],
  ['table', '表格', 'table biaoge', 'table', '媒体与进阶'],
  ['callout', '高亮块', 'callout note tip gaoliang', 'panel-top', '媒体与进阶'],
  ['math', '公式块', 'math latex gongshi', 'sigma', '媒体与进阶'],
  ['h4', '四级标题', 'heading h4', 'heading-4', '更多标题'],
  ['h5', '五级标题', 'heading h5', 'heading-5', '更多标题'],
  ['h6', '六级标题', 'heading h6', 'heading-6', '更多标题'],
].map(([id, label, keywords, icon, group]) => ({ id, label, keywords, icon, group }));

function searchItems(query: string) {
  const q = query.trim().toLowerCase();
  return ITEMS.filter((x) => `${x.label} ${x.id} ${x.keywords}`.toLowerCase().includes(q));
}
function parseStyle(line: string): BlockStyle | null {
  const match =
    /^<!-- flow-edit align=(left|center|right) color=(default|gray|red|orange|green|blue|purple) background=(none|gray|red|yellow|green|blue|purple) -->$/.exec(
      line.trim(),
    );
  return match ? { align: match[1], color: match[2], background: match[3] } : null;
}
function styleLine(style: Partial<BlockStyle>) {
  const s = { align: 'left', color: 'default', background: 'none', ...style };
  if (!ALIGNS.includes(s.align) || !COLORS.includes(s.color) || !BACKGROUNDS.includes(s.background))
    throw new Error('无效的块样式');
  return `<!-- flow-edit align=${s.align} color=${s.color} background=${s.background} -->`;
}
function linesOf(text: string) {
  let offset = 0;
  return text.split('\n').map((text, n) => {
    const line = { text, from: offset, to: offset + text.length, n };
    offset += text.length + 1;
    return line;
  });
}
function kind(line: string) {
  if (/^ {0,3}#{1,6}\s/.test(line)) return 'h' + (line.trimStart().match(/^#+/)?.[0].length || 1);
  if (/^\s*[-+*]\s+\[[ xX]\]\s/.test(line)) return 'task';
  if (/^\s*[-+*]\s+/.test(line)) return 'bullet';
  if (/^\s*\d+[.)]\s+/.test(line)) return 'ordered';
  if (/^\s*>\s*\[!/.test(line)) return 'callout';
  if (/^\s*>/.test(line)) return 'quote';
  if (/^\s*(?:([-*_])\s*){3,}$/.test(line)) return 'divider';
  if (/^\s*\|/.test(line)) return 'table';
  if (/^(?: {4}|\t)/.test(line)) return 'indented-code';
  return 'text';
}
// Top-level Markdown blocks. Nested lists / quotes / tables stay intact as one block.
function blocks(text: string): Block[] {
  const lines = linesOf(text),
    out = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].text.trim()) {
      i++;
      continue;
    }
    const start = i;
    let style = parseStyle(lines[i].text);
    if (style && i + 1 < lines.length && lines[i + 1].text.trim()) i++;
    else style = null;
    const content = i;
    let type = kind(lines[i].text),
      protectedBlock = false;
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i].text);
    if (i === 0 && /^\uFEFF?---\s*$/.test(lines[i].text)) {
      type = 'frontmatter';
      protectedBlock = true;
      i++;
      while (i < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[i].text)) i++;
      if (i < lines.length) i++;
    } else if (fence) {
      type = 'code';
      const close = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}\\s*$');
      i++;
      while (i < lines.length && !close.test(lines[i].text)) i++;
      if (i < lines.length) i++;
    } else if (/^\s*\$\$\s*$/.test(lines[i].text)) {
      type = 'math';
      i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i].text)) i++;
      if (i < lines.length) i++;
    } else if (/^\s*<!--/.test(lines[i].text)) {
      type = 'html';
      protectedBlock = true;
      i++;
      while (i < lines.length && !lines[i - 1].text.includes('-->')) i++;
    } else if (/^\s*</.test(lines[i].text)) {
      type = 'html';
      protectedBlock = true;
      i++;
      while (i < lines.length && lines[i].text.trim()) i++;
    } else {
      i++;
      if (!/^h\d$/.test(type) && type !== 'divider') {
        while (i < lines.length && lines[i].text.trim()) {
          const next = lines[i].text;
          if (parseStyle(next) || /^ {0,3}(?:#{1,6}\s|`{3,}|~{3,})/.test(next)) break;
          if (type === 'text' && kind(next) !== 'text') break;
          if (['quote', 'callout'].includes(type) && !/^\s*>/.test(next)) break;
          i++;
        }
      }
    }
    // Obsidian block IDs for complex blocks occupy a separate line.
    if (i + 1 < lines.length && !lines[i].text.trim() && /^\^[\w-]+\s*$/.test(lines[i + 1].text))
      i += 2;
    const end = lines[Math.max(start, i - 1)];
    out.push({
      from: lines[start].from,
      to: end.to,
      contentFrom: lines[content].from,
      startLine: start,
      contentLine: content,
      endLine: end.n,
      type,
      style,
      protected: protectedBlock,
      text: text.slice(lines[content].from, end.to),
    });
  }
  return out;
}
function blockAt(text: string, pos: number, parsed = blocks(text)): Block {
  return (
    parsed.find((b) => pos >= b.from && pos <= b.to) || {
      from: pos,
      to: pos,
      contentFrom: pos,
      type: 'text',
      text: '',
      protected: false,
      style: null,
      startLine: text.slice(0, pos).split('\n').length - 1,
      contentLine: text.slice(0, pos).split('\n').length - 1,
      endLine: text.slice(0, pos).split('\n').length - 1,
    }
  );
}
function stripPrefix(line: string) {
  return line.replace(/^(\s*)(?:#{1,6}\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)/, '$1');
}
function convert(text: string, type: string): string {
  const plain = text.split('\n').map(stripPrefix);
  if (/^h[1-6]$/.test(type))
    return plain.map((x) => '#'.repeat(Number(type[1])) + ' ' + x.trimStart()).join('\n');
  if (type === 'text') return plain.join('\n');
  if (['bullet', 'ordered', 'task'].includes(type)) {
    const counts = new Map<string, number>();
    return plain
      .map((x) => {
        const indent = x.match(/^\s*/)?.[0] || '',
          n = (counts.get(indent) || 0) + 1;
        counts.set(indent, n);
        return (
          indent +
          (type === 'bullet' ? '- ' : type === 'task' ? '- [ ] ' : `${n}. `) +
          x.slice(indent.length)
        );
      })
      .join('\n');
  }
  if (type === 'quote') return plain.map((x) => '> ' + x).join('\n');
  if (type === 'callout') return '> [!note]\n' + plain.map((x) => '> ' + x).join('\n');
  if (type === 'code') {
    const runs = text.match(/`+/g) || [];
    const fence = '`'.repeat(Math.max(3, ...runs.map((x) => x.length + 1)));
    return `${fence}\n${text}\n${fence}`;
  }
  if (type === 'math') return '$$\n' + text + '\n$$';
  if (type === 'divider') return (text.trim() ? text + '\n\n' : '') + '***';
  if (type === 'table')
    return (
      '| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n| ' +
      (text || '内容').replace(/\|/g, '\\|').replace(/\n/g, ' ') +
      ' |  |  |'
    );
  return text;
}
function setBlockStyle(document: string, block: Block, patch: Partial<BlockStyle>): Change {
  if (block.protected || block.from === block.to) throw new Error('请先在正文块中输入内容');
  const style = { align: 'left', color: 'default', background: 'none', ...block.style, ...patch };
  const marker =
    style.align === 'left' && style.color === 'default' && style.background === 'none'
      ? ''
      : styleLine(style) + '\n';
  return { from: block.from, to: block.contentFrom, insert: marker };
}
function convertBlock(block: Block, type: string): Change | null {
  if (!canConvert(block, type)) throw new Error('复杂块请直接编辑源码，避免格式转换损坏内容');
  if (block.type === type) return null;
  let text = block.text;
  if (block.type === 'callout') {
    const info = calloutInfo(block);
    if (!info) throw new Error('无法识别高亮块标记');
    text =
      (info.title ? '> ' + info.title + '\n' : '') +
      text.slice(info.headerLength).replace(/^\n/, '');
  }
  return { from: block.contentFrom, to: block.to, insert: convert(text, type) };
}
function deleteBlock(document: string, block: Block): Change {
  // Consume one adjacent blank separator, keeping surrounding blocks separate.
  let from = block.from,
    to = block.to;
  if (document.slice(to, to + 2) === '\n\n') to += 2;
  else if (document[to] === '\n') to++;
  else if (from > 0 && document.slice(from - 2, from) === '\n\n') from -= 2;
  return { from, to, insert: '' };
}
function moveBlock(document: string, block: Block, direction: number): Change | null {
  const all = blocks(document),
    index = all.findIndex((x) => x.from === block.from);
  const other = all[index + direction];
  if (!other || other.protected || block.protected) return null;
  const [a, b] = direction < 0 ? [other, block] : [block, other];
  return {
    from: a.from,
    to: b.to,
    insert:
      document.slice(b.from, b.to) + document.slice(a.to, b.from) + document.slice(a.from, a.to),
    cursor: direction < 0 ? a.from : a.from + (b.to - b.from) + (b.from - a.to),
  };
}
function slashContext(text: string, offset: number, parsed?: Block[]) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const before = text.slice(lineStart, offset),
    match = /^(\s*)\/([^/\n]*)$/.exec(before);
  if (!match || match[2].length > 40 || text.slice(offset).split('\n')[0].trim()) return null;
  const b = blockAt(text, offset, parsed);
  if (b.protected || ['code', 'math', 'indented-code'].includes(b.type)) return null;
  return { from: lineStart + match[1].length, to: offset, query: match[2] };
}
function wrapInline(text: string, from: number, to: number, mark: string): Change {
  if (from === to) return { from, to, insert: mark + mark, cursor: from + mark.length };
  const value = text.slice(from, to);
  const unwrapped = (a: number, b: number, content: string): Change => ({
    from: a,
    to: b,
    insert: content,
    selectFrom: a,
    selectTo: a + content.length,
  });
  if (mark === '`') {
    const stripPadding = (s: string) =>
      s.startsWith(' ') && s.endsWith(' ') && /\S/.test(s) ? s.slice(1, -1) : s;
    const enclosed = /^(`+)([\s\S]*?)\1$/.exec(value);
    if (enclosed && !enclosed[2].includes(enclosed[1]))
      return unwrapped(from, to, stripPadding(enclosed[2]));
    const left = /(`+)( ?)$/.exec(text.slice(0, from)),
      right = /^( ?)(`+)/.exec(text.slice(to));
    if (left && right && left[1] === right[2] && left[2] === right[1] && !value.includes(left[1])) {
      return unwrapped(from - left[0].length, to + right[0].length, value);
    }
    const fence = '`'.repeat(Math.max(0, ...(value.match(/`+/g) || []).map((x) => x.length)) + 1);
    const pad =
      value.startsWith('`') ||
      value.endsWith('`') ||
      (value.startsWith(' ') && value.endsWith(' ') && /\S/.test(value))
        ? ' '
        : '';
    return {
      from,
      to,
      insert: fence + pad + value + pad + fence,
      selectFrom: from + fence.length + pad.length,
      selectTo: to + fence.length + pad.length,
    };
  }
  const starCount = value.match(/^\*+/)?.[0].length || 0;
  const selectedToggle = mark !== '*' || starCount % 2 === 1;
  if (
    selectedToggle &&
    value.startsWith(mark) &&
    value.endsWith(mark) &&
    value.length >= mark.length * 2
  ) {
    return unwrapped(from, to, value.slice(mark.length, -mark.length));
  }
  const leftStars = text.slice(0, from).match(/\*+$/)?.[0].length || 0;
  if (
    (mark !== '*' || leftStars % 2 === 1) &&
    text.slice(from - mark.length, from) === mark &&
    text.slice(to, to + mark.length) === mark
  ) {
    return unwrapped(from - mark.length, to + mark.length, value);
  }
  return {
    from,
    to,
    insert: mark + value + mark,
    selectFrom: from + mark.length,
    selectTo: to + mark.length,
  };
}
export {
  COLORS,
  BACKGROUNDS,
  ALIGNS,
  CALLOUT_TYPES,
  calloutInfo,
  setCalloutType,
  canConvert,
  retainSelection,
  ITEMS,
  searchItems,
  parseStyle,
  styleLine,
  linesOf,
  kind,
  blocks,
  blockAt,
  convert,
  convertBlock,
  setBlockStyle,
  deleteBlock,
  moveBlock,
  slashContext,
  wrapInline,
};
