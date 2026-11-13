import {
  ITEMS,
  searchItems,
  COLORS,
  BACKGROUNDS,
  CALLOUT_TYPES,
  calloutInfo,
  canConvert,
} from './core';
import type { Block, BlockStyle, InsertItem } from './core';
import { windowFor, eventElement } from './dom';
export type SetIcon = (element: HTMLElement, name: string) => void;
export interface RectLike {
  left: number;
  bottom: number;
  right?: number;
  top?: number;
  width?: number;
  height?: number;
}
export interface Anchor extends RectLike {
  boundary?: HTMLElement;
  element?: HTMLElement;
  fallback?: RectLike;
}
export interface PopupOptions {
  doc: Document;
  anchor: Anchor;
  setIcon?: SetIcon;
  onClose?: (reason: string) => void;
  onPosition?: () => void;
  label?: string;
  returnFocus?: () => void;
}
interface ButtonOptions {
  next?: boolean;
  disabled?: boolean;
  reason?: string;
  active?: boolean;
  danger?: boolean;
}
export type BlockActionArgs =
  | ['style', Partial<BlockStyle>]
  | ['move' | 'indent', number]
  | ['convert' | 'below', string]
  | ['cut' | 'copy' | 'duplicate' | 'delete' | 'block-link'];
interface BlockMenuOptions extends PopupOptions {
  block: Block;
  act: (...args: BlockActionArgs) => unknown;
  comment?: (() => unknown) | null;
  types?: () => void;
  callouts?: () => void;
}
interface TypeMenuOptions extends PopupOptions {
  block: Block;
  choose: (type: string) => unknown;
}
interface StyleMenuOptions extends PopupOptions {
  block: Block;
  mode: 'align' | 'color';
  choose: (style: Partial<BlockStyle>) => unknown;
}
interface InsertMenuOptions extends PopupOptions {
  choose: (type: string) => unknown;
}
export interface ToolbarContext {
  block?: Block;
  comment?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls?: string,
  text?: string | null,
): HTMLElementTagNameMap[K] {
  const node = windowFor(doc).createEl(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function icon(doc: Document, name: string, setIcon?: SetIcon) {
  const span = el(doc, 'span', 'flow-icon');
  if (setIcon) setIcon(span, name);
  else
    span.textContent =
      (
        {
          type: 'T',
          'heading-1': 'H₁',
          'heading-2': 'H₂',
          'heading-3': 'H₃',
          list: '☷',
          quote: '❝',
          braces: '{}',
          link: '↗',
          minus: '—',
        } as Record<string, string>
      )[name] || '◇';
  return span;
}
function itemRow(doc: Document, item: InsertItem, setIcon?: SetIcon) {
  const row = el(doc, 'div', 'flow-suggestion');
  row.append(icon(doc, item.icon, setIcon), el(doc, 'span', 'flow-item-label', item.label));
  const shortcut = (
    {
      h1: '#',
      h2: '##',
      h3: '###',
      bullet: '-',
      ordered: '1.',
      task: '[]',
      quote: '>',
      code: '```',
    } as Record<string, string>
  )[item.id];
  if (shortcut) row.append(el(doc, 'span', 'flow-shortcut', shortcut));
  return row;
}
const COLOR_NAMES: Record<string, string> = {
  default: '默认',
  none: '无',
  gray: '灰色',
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
  purple: '紫色',
};
const toolbarIconRenderers = new WeakMap<HTMLElement, SetIcon | undefined>();
function editorBounds(doc: Document, boundary?: HTMLElement) {
  const win = windowFor(doc),
    w = win.innerWidth,
    h = win.innerHeight,
    r = boundary?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0
    ? {
        left: Math.max(0, r.left),
        right: Math.min(w, r.right),
        top: Math.max(0, r.top),
        bottom: Math.min(h, r.bottom),
      }
    : { left: 0, right: w, top: 0, bottom: h };
}
function stableRect(r?: RectLike | null) {
  if (!r || !Number.isFinite(r.left) || !Number.isFinite(r.bottom) || r.bottom < 0 || r.left < -1)
    return null;
  if ('width' in r && (!r.width || !r.height)) return null;
  return {
    left: r.left,
    right: r.right ?? r.left + 1,
    top: r.top ?? r.bottom - 20,
    bottom: r.bottom,
  };
}

function openPopup({
  doc,
  anchor,
  setIcon,
  onClose,
  onPosition,
  label = '块操作',
  returnFocus,
}: PopupOptions) {
  const root = el(doc, 'div', 'flow-popup');
  root.setAttribute('role', 'menu');
  root.setAttribute('aria-label', label);
  doc.body.append(root);
  let closed = false,
    closeReason: string | null = null,
    frame = 0;
  const win = windowFor(doc);
  let lastAnchor = stableRect(anchor) || stableRect(anchor.fallback);
  const probe = el(doc, 'div', 'flow-coordinate-probe');
  probe.classList.add('flow-position-probe');
  doc.body.append(probe);
  function position() {
    if (closed) return;
    const bounds = editorBounds(doc, anchor.boundary),
      live = anchor.element?.isConnected
        ? stableRect(anchor.element.getBoundingClientRect())
        : null;
    if (live) lastAnchor = live;
    const at = lastAnchor || {
      left: bounds.left + 8,
      top: bounds.top + 20,
      bottom: bounds.top + 40,
    };
    const origin = probe.getBoundingClientRect(),
      sx = origin.width / 100 || 1,
      sy = origin.height / 100 || 1;
    const below = bounds.bottom - at.bottom - 14,
      above = at.top - bounds.top - 14;
    root.style.maxWidth = Math.max(24, (bounds.right - bounds.left - 16) / sx) + 'px';
    root.style.maxHeight =
      Math.max(24, Math.min(bounds.bottom - bounds.top - 16, Math.max(below, above))) / sy + 'px';
    const rect = root.getBoundingClientRect();
    const left = Math.max(bounds.left + 8, Math.min(at.left, bounds.right - rect.width - 8));
    const preferred =
      below >= rect.height || below >= above ? at.bottom + 6 : at.top - rect.height - 6;
    const top = Math.max(bounds.top + 8, Math.min(preferred, bounds.bottom - rect.height - 8));
    root.style.left = (left - origin.left) / sx + 'px';
    root.style.top = (top - origin.top) / sy + 'px';
    root.dataset.flowPlacement = preferred === at.bottom + 6 ? 'below' : 'above';
    onPosition?.();
  }
  // Native selection tooltips can move after focus changes without a scroll event.
  // Follow their valid geometry while open, including after CodeMirror measures them.
  function schedulePosition() {
    if (!closed && !frame)
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        position();
        if (anchor.element?.isConnected) schedulePosition();
      });
  }
  const observer =
    win.ResizeObserver && anchor.boundary ? new win.ResizeObserver(schedulePosition) : null;
  if (anchor.boundary) observer?.observe(anchor.boundary);
  function close(restore = false, reason = 'action') {
    if (closed) return;
    closed = true;
    closeReason = reason;
    root.remove();
    probe.remove();
    observer?.disconnect();
    if (frame) win.cancelAnimationFrame(frame);
    doc.removeEventListener('pointerdown', outside, true);
    doc.removeEventListener('keydown', keydown, true);
    win.removeEventListener('resize', resized);
    doc.removeEventListener('scroll', scrolled, true);
    onClose?.(reason);
    if (restore) returnFocus?.();
  }
  function outside(e: MouseEvent) {
    if (!root.contains(eventElement(e.target))) close(false, 'outside');
  }
  function scrolled(e: Event) {
    if (root.contains(eventElement(e.target))) return;
    if (anchor.element?.isConnected) schedulePosition();
    else close(false, 'scroll');
  }
  function resized() {
    close(false, 'resize');
  }
  function keydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab'].includes(e.key)) return;
    if (e.key === 'Tab') {
      close();
      return;
    }
    if (!root.contains(doc.activeElement)) return;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!buttons.length) return;
    e.preventDefault();
    e.stopPropagation();
    const index = buttons.findIndex((button) => button === doc.activeElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : (index + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true });
  }
  doc.addEventListener('pointerdown', outside, true);
  doc.addEventListener('keydown', keydown, true);
  doc.addEventListener('scroll', scrolled, true);
  win.addEventListener('resize', resized);
  root.addEventListener('pointerdown', (e) => {
    if (eventElement(e.target)?.closest('button')) e.preventDefault();
  });
  if (anchor.element) schedulePosition();
  function button(
    parent: HTMLElement,
    label: string,
    name: string,
    action?: () => unknown,
    options: ButtonOptions = {},
  ) {
    const b = el(doc, 'button', 'flow-menu-item' + (options.danger ? ' flow-danger' : ''));
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-label', label);
    b.title = label;
    if (options.disabled) {
      b.disabled = true;
      b.title = options.reason || label;
    }
    b.append(icon(doc, name, setIcon), el(doc, 'span', '', label));
    if (options.next) b.append(el(doc, 'span', 'flow-chevron', '›'));
    if (options.active) {
      b.classList.add('is-active');
      b.setAttribute('aria-current', 'true');
    }
    b.addEventListener('click', () => {
      if (!options.next) close();
      action?.();
    });
    parent.append(b);
    return b;
  }
  return {
    root,
    close,
    button,
    position,
    focus() {
      const selected = root.querySelector<HTMLElement>(
        '[aria-checked="true"]:not(:disabled), button[aria-current="true"]:not(:disabled)',
      );
      (selected || root.querySelector<HTMLElement>('button:not(:disabled), input'))?.focus({
        preventScroll: true,
      });
    },
    get closed() {
      return closed;
    },
    get closeReason() {
      return closeReason;
    },
  };
}
function blockMenu(options: BlockMenuOptions) {
  const { doc, block, act, comment } = options;
  const menu = openPopup(options),
    root = menu.root;
  function head(title: string, back = false) {
    root.replaceChildren();
    const h = el(doc, 'div', 'flow-menu-heading');
    if (back)
      menu.button(
        h,
        '返回',
        'chevron-left',
        () => {
          draw();
          menu.focus();
        },
        { next: true },
      );
    h.append(el(doc, 'span', '', title));
    root.append(h);
  }
  function section() {
    const s = el(doc, 'div', 'flow-menu-section');
    root.append(s);
    return s;
  }
  function palette() {
    head('颜色', true);
    for (const [key, values, title] of [
      ['color', COLORS, '文字颜色'],
      ['background', BACKGROUNDS, '背景颜色'],
    ] as const) {
      const s = section();
      s.append(el(doc, 'div', 'flow-section-label', title));
      const grid = el(doc, 'div', 'flow-color-grid');
      for (const c of values) {
        const b = menu.button(grid, COLOR_NAMES[c], 'type', () => act('style', { [key]: c }), {
          active: (block.style?.[key] || (key === 'color' ? 'default' : 'none')) === c,
        });
        b.classList.add('flow-swatch', `flow-${key}-${c}`);
      }
      s.append(grid);
    }
    menu.position();
    menu.focus();
  }
  function alignment() {
    head('缩进和对齐', true);
    const s = section();
    for (const [value, label, icon] of [
      ['left', '左对齐', 'align-left'],
      ['center', '居中', 'align-center'],
      ['right', '右对齐', 'align-right'],
    ]) {
      menu.button(s, label, icon, () => act('style', { align: value }), {
        active: (block.style?.align || 'left') === value,
      });
    }
    menu.button(s, '增加缩进', 'indent-increase', () => act('indent', 1));
    menu.button(s, '减少缩进', 'indent-decrease', () => act('indent', -1));
    menu.position();
    menu.focus();
  }
  function addBelow() {
    head('在下方添加', true);
    const s = section();
    for (const item of ITEMS.slice(0, 15))
      menu.button(s, item.label, item.icon, () => act('below', item.id));
    menu.position();
    menu.focus();
  }
  function draw() {
    head(ITEMS.find((x) => x.id === block.type)?.label || '内容块');
    const formats = section();
    menu.button(
      formats,
      '转换块类型',
      'type',
      () => {
        menu.close();
        options.types?.();
      },
      { next: true },
    );
    if (block.type === 'callout')
      menu.button(
        formats,
        '高亮块类型',
        'panel-top',
        () => {
          menu.close();
          options.callouts?.();
        },
        { next: true },
      );
    const appearance = section();
    menu.button(appearance, '缩进和对齐', 'align-left', alignment, { next: true });
    menu.button(appearance, '颜色', 'palette', palette, { next: true });
    const edit = section();
    if (comment) menu.button(edit, '评论', 'message-square', comment);
    menu.button(edit, '剪切', 'scissors', () => act('cut'));
    menu.button(edit, '复制', 'copy', () => act('copy'));
    menu.button(edit, '创建副本', 'copy-plus', () => act('duplicate'));
    menu.button(edit, '向上移动', 'arrow-up', () => act('move', -1));
    menu.button(edit, '向下移动', 'arrow-down', () => act('move', 1));
    menu.button(edit, '删除', 'trash-2', () => act('delete'), { danger: true });
    const more = section();
    menu.button(more, '复制块链接', 'link', () => act('block-link'));
    menu.button(more, '清除块样式', 'eraser', () =>
      act('style', { align: 'left', color: 'default', background: 'none' }),
    );
    const add = section();
    menu.button(add, '在下方添加', 'square-plus', addBelow, { next: true });
    menu.position();
  }
  draw();
  menu.focus();
  return menu;
}
function typeMenu(options: TypeMenuOptions) {
  const { doc, block, choose } = options,
    menu = openPopup({ ...options, label: '转换块类型' });
  menu.root.classList.add('flow-type-picker');
  menu.root.append(
    el(doc, 'div', 'flow-picker-title', '块类型'),
    el(doc, 'div', 'flow-picker-description', '作用于当前整块内容'),
  );
  for (const [label, ids] of [
    ['正文', ['text']],
    ['标题', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']],
    ['列表', ['bullet', 'ordered', 'task']],
    ['内容块', ['quote', 'callout', 'code', 'table']],
  ] as const) {
    const section = el(doc, 'div', 'flow-type-section');
    section.dataset.flowTypeGroup = label;
    section.append(el(doc, 'div', 'flow-section-label', label));
    menu.root.append(section);
    const list = el(doc, 'div', label === '标题' ? 'flow-heading-options' : 'flow-type-options');
    section.append(list);
    for (const id of ids) {
      const item = ITEMS.find((x) => x.id === id);
      if (!item) continue;
      const b = menu.button(list, item.label, item.icon, () => choose(item.id), {
        active: block.type === item.id,
        disabled: !canConvert(block, item.id),
        reason: '此复杂块请在源码中修改',
      });
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(block.type === item.id));
      if (block.type === item.id) b.append(icon(doc, 'check', options.setIcon));
    }
  }
  menu.position();
  menu.focus();
  return menu;
}
function calloutTypeMenu(options: TypeMenuOptions) {
  const { doc, block, choose } = options,
    menu = openPopup({ ...options, label: '高亮块类型' }),
    info = calloutInfo(block);
  menu.root.classList.add('flow-callout-picker');
  const title = el(doc, 'div', 'flow-picker-title', '标注类型');
  menu.root.append(
    title,
    el(doc, 'div', 'flow-picker-description', info ? '当前：' + info.label : '选择一种高亮块类型'),
  );
  const grid = el(doc, 'div', 'flow-callout-options');
  menu.root.append(grid);
  for (const type of CALLOUT_TYPES) {
    const active = info?.canonical === type.id;
    const b = menu.button(grid, type.label, type.icon, () => choose(type.id), { active });
    b.classList.add('flow-callout-option', 'flow-type-' + type.color);
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(!!active));
    b.dataset.calloutType = type.id;
    const copy = el(doc, 'span', 'flow-callout-copy');
    copy.append(
      el(doc, 'span', 'flow-option-label', type.label),
      el(doc, 'span', 'flow-option-description', type.description),
    );
    b.replaceChildren(
      icon(doc, type.icon, options.setIcon),
      copy,
      icon(doc, active ? 'check' : 'minus', options.setIcon),
    );
    b.lastElementChild?.classList.add('flow-option-check');
    b.lastElementChild?.classList.toggle('flow-option-check-hidden', !active);
  }
  menu.position();
  menu.focus();
  return menu;
}
function styleMenu(options: StyleMenuOptions) {
  const { doc, block, choose, mode } = options,
    menu = openPopup({ ...options, label: mode === 'align' ? '块对齐' : '块颜色' });
  menu.root.append(
    el(doc, 'div', 'flow-picker-title', mode === 'align' ? '块对齐' : '块颜色'),
    el(doc, 'div', 'flow-picker-description', '应用于当前整个内容块'),
  );
  if (mode === 'align') {
    for (const [align, label, name] of [
      ['left', '左对齐', 'align-left'],
      ['center', '居中', 'align-center'],
      ['right', '右对齐', 'align-right'],
    ])
      menu.button(menu.root, label, name, () => choose({ align }), {
        active: (block.style?.align || 'left') === align,
      });
  } else
    for (const [key, values, label] of [
      ['color', COLORS, '文字颜色'],
      ['background', BACKGROUNDS, '背景颜色'],
    ] as const) {
      menu.root.append(el(doc, 'div', 'flow-section-label', label));
      const grid = el(doc, 'div', 'flow-color-grid');
      menu.root.append(grid);
      for (const value of values) {
        const b = menu.button(
          grid,
          (key === 'color' ? '文字' : '背景') + COLOR_NAMES[value],
          'type',
          () => choose({ [key]: value }),
          { active: (block.style?.[key] || (key === 'color' ? 'default' : 'none')) === value },
        );
        b.classList.add('flow-swatch', `flow-${key}-${value}`);
      }
    }
  menu.position();
  menu.focus();
  return menu;
}
function insertMenu(options: InsertMenuOptions) {
  const { doc, setIcon, choose } = options;
  const menu = openPopup({ ...options, label: '插入内容' });
  const search = el(doc, 'input', 'flow-search');
  search.type = 'search';
  search.placeholder = '输入关键词';
  search.setAttribute('aria-label', '搜索内容块');
  const list = el(doc, 'div', 'flow-insert-list');
  menu.root.append(search, list);
  function draw() {
    list.replaceChildren();
    let group = '';
    const matches = searchItems(search.value);
    for (const item of matches) {
      if (group !== item.group) {
        list.append(el(doc, 'div', 'flow-section-label', item.group));
        group = item.group;
      }
      const b = menu.button(list, item.label, item.icon, () => choose(item.id));
      b.replaceChildren(...itemRow(doc, item, setIcon).childNodes);
    }
    if (!matches.length) list.append(el(doc, 'div', 'flow-empty', '没有匹配的内容块'));
    menu.position();
  }
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      list.querySelector('button')?.focus({ preventScroll: true });
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      list.querySelector('button')?.click();
    }
  });
  draw();
  search.focus({ preventScroll: true });
  return menu;
}
function updateToolbar(root: HTMLElement, active: string[] = [], context?: ToolbarContext) {
  for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-flow-format]')) {
    const pressed = active.includes(b.dataset.flowFormat || '');
    b.classList.toggle('is-active', pressed);
    b.setAttribute('aria-pressed', String(pressed));
  }
  if (context?.block) {
    const { block } = context,
      item = ITEMS.find((x) => x.id === block.type),
      info = calloutInfo(block),
      type = root.querySelector<HTMLButtonElement>('[data-flow-action="type"]'),
      callout = root.querySelector<HTMLButtonElement>('[data-flow-action="callout"]');
    function updateSelect(
      button: HTMLButtonElement | null,
      label: string,
      name: string,
      prefix: string,
    ) {
      if (!button) return;
      const text = button.querySelector('.flow-tool-label'),
        tag = button.querySelector('.flow-tool-prefix');
      if (text && text.textContent !== label) text.textContent = label;
      if (tag && tag.textContent !== prefix) tag.textContent = prefix;
      if (button.dataset.flowIcon !== name) {
        button
          .querySelector('.flow-icon')
          ?.replaceWith(icon(root.ownerDocument, name, toolbarIconRenderers.get(root)));
        button.dataset.flowIcon = name;
      }
    }
    updateSelect(type, item?.label || '内容块', item?.icon || 'type', '块');
    updateSelect(
      callout,
      info?.label || '高亮块',
      CALLOUT_TYPES.find((x) => x.id === info?.canonical)?.icon || 'panel-top',
      info ? '标注' : '新建',
    );
    if (type) type.title = '块类型：' + (item?.label || '内容块') + '（作用于整块）';
    if (callout) callout.title = info ? '标注类型：' + info.label : '将当前块转为高亮块';
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-flow-convert]')) {
      const id = button.dataset.flowConvert;
      button.disabled = !canConvert(block, id || '');
      button.classList.toggle('is-active', block.type === id);
      button.setAttribute('aria-pressed', String(block.type === id));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-flow-indent]'))
      button.hidden = !['bullet', 'ordered', 'task'].includes(block.type);
  }
}
function createToolbar(
  doc: Document,
  execute: (id: string, button: HTMLButtonElement) => unknown,
  setIcon?: SetIcon,
  active: string[] = [],
  context?: ToolbarContext,
) {
  const root = el(doc, 'div', 'flow-toolbar');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', '文字格式');
  toolbarIconRenderers.set(root, setIcon);
  function group(items: [string, string, string, string?][]) {
    const row = el(doc, 'div', 'flow-toolbar-group');
    root.append(row);
    for (const [id, label, name, text] of items) {
      const b = el(doc, 'button', 'flow-tool-button');
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.dataset.flowAction = id;
      if (['bold', 'italic', 'strike', 'highlight', 'inline-code'].includes(id))
        b.dataset.flowFormat = id;
      if (['bullet', 'ordered', 'task', 'quote'].includes(id)) b.dataset.flowConvert = id;
      if (id === 'indent' || id === 'outdent') b.dataset.flowIndent = id;
      b.append(icon(doc, name, setIcon));
      for (const event of ['pointerdown', 'mousedown'])
        b.addEventListener(event, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      if (text) {
        b.classList.add('flow-tool-select');
        b.append(
          el(doc, 'span', 'flow-tool-prefix'),
          el(doc, 'span', 'flow-tool-label', text),
          el(doc, 'span', 'flow-tool-chevron', '⌄'),
        );
      }
      if (['type', 'callout', 'color', 'align'].includes(id))
        b.setAttribute('aria-haspopup', 'menu');
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        execute(id, b);
      });
      row.append(b);
    }
  }
  group([
    ['type', '转换块类型', 'type', '正文'],
    ['callout', '高亮块类型', 'panel-top', '高亮块'],
  ]);
  group([
    ['bold', '加粗', 'bold'],
    ['italic', '斜体', 'italic'],
    ['strike', '删除线', 'strikethrough'],
    ['highlight', '高亮', 'highlighter'],
    ['inline-code', '行内代码', 'code'],
  ]);
  group([
    ['link', '链接', 'link'],
    ['color', '块颜色', 'palette'],
    ['align', '块对齐', 'align-left'],
  ]);
  group([
    ['bullet', '无序列表', 'list'],
    ['ordered', '有序列表', 'list-ordered'],
    ['task', '任务列表', 'square-check'],
    ['quote', '引用', 'quote'],
    ['outdent', '减少缩进', 'indent-decrease'],
    ['indent', '增加缩进', 'indent-increase'],
  ]);
  if (context?.comment) group([['comment', '评论', 'message-square']]);
  root.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],
      i = buttons.findIndex((button) => button === doc.activeElement);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    buttons[
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : (i + (e.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length
    ].focus({ preventScroll: true });
  });
  updateToolbar(root, active, context);
  return root;
}
export {
  el,
  icon,
  itemRow,
  editorBounds,
  openPopup,
  blockMenu,
  typeMenu,
  calloutTypeMenu,
  styleMenu,
  insertMenu,
  createToolbar as toolbar,
  updateToolbar,
};
