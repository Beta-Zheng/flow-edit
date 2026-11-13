import {
  StateField,
  StateEffect,
  type EditorState,
  type Text,
  type Range,
} from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, showTooltip } from '@codemirror/view';
import * as core from './core';
import * as ui from './ui';
import { ImageLayouts, galleryTarget } from './images';
import type { GalleryTarget } from './images';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type * as O from 'obsidian';
import type FlowEdit from './plugin';
import { windowFor, eventElement, errorMessage, type AppWindow } from './dom';
interface HitArea {
  from: number;
  top: number;
  bottom: number;
}
interface HandleItem {
  from: number;
  type: string;
  compact: boolean;
  left: number;
  top: number;
}
interface Measurement {
  file: O.TFile | null | undefined;
  snapshot: Text;
  items: HandleItem[];
  hitAreas: HitArea[];
}
interface EditorImageCapture {
  snapshot: string;
  editor: O.Editor;
  file: O.TFile;
  target: GalleryTarget;
}
const refresh = StateEffect.define<null>();

function editorExtension(
  plugin: FlowEdit,
  { editorInfoField, setIcon }: Pick<typeof O, 'editorInfoField' | 'setIcon'>,
) {
  function info(view: EditorView) {
    const ctx = view.state.field(editorInfoField, false);
    return ctx?.editor && ctx.file ? { editor: ctx.editor, file: ctx.file } : undefined;
  }
  const parsed = new WeakMap<Text, core.Block[]>();
  function scan(doc: Text): core.Block[] {
    if (!parsed.has(doc)) parsed.set(doc, core.blocks(doc.toString()));
    return parsed.get(doc) || [];
  }
  const styles = StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      return tr.docChanged || tr.effects.some((e) => e.is(refresh)) ? build(tr.state) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  function build(state: EditorState) {
    const ranges: Range<Decoration>[] = [];
    for (const b of scan(state.doc)) {
      if (!b.style) continue;
      ranges.push(
        Decoration.line({ class: 'flow-meta-line' }).range(state.doc.line(b.startLine + 1).from),
      );
      for (let n = b.contentLine; n <= b.endLine; n++) {
        ranges.push(
          Decoration.line({
            class: `flow-styled flow-align-${b.style.align} flow-color-${b.style.color} flow-background-${b.style.background}`,
          }).range(state.doc.line(n + 1).from),
        );
      }
    }
    return Decoration.set(ranges, true);
  }
  // Absolute controls outside the content column. A gutter participates in
  // CodeMirror's flex layout and shifts the text and its wrapping width.
  const handles = ViewPlugin.fromClass(
    class {
      view: EditorView;
      buttons: Map<number, HTMLButtonElement>;
      triggers: Map<HTMLElement, Record<string, string | null>>;
      root: HTMLDivElement;
      observer: MutationObserver;
      dead = false;
      pointerY?: number;
      hoveredFrom?: number;
      hitAreas: HitArea[] = [];
      drawnDoc?: Text;
      drawnFile?: O.TFile | null;
      onScroll: () => void;
      onPointerMove: (event: PointerEvent) => void;
      onPointerLeave: () => void;
      onCalloutAction: (event: MouseEvent | KeyboardEvent) => void;
      onCalloutPointer: (event: PointerEvent) => void;
      constructor(view: EditorView) {
        this.view = view;
        this.buttons = new Map();
        this.triggers = new Map();
        this.root = ui.el(view.dom.ownerDocument, 'div', 'flow-block-overlay');
        view.dom.append(this.root);
        this.onScroll = () => this.measure();
        this.onPointerMove = (e) => {
          this.pointerY = e.clientY;
          const hit = this.hitAreas?.find((a) => e.clientY >= a.top && e.clientY <= a.bottom);
          const next = hit?.from;
          if (next !== this.hoveredFrom) {
            this.hoveredFrom = next;
            this.reveal();
          }
        };
        this.onPointerLeave = () => {
          this.pointerY = undefined;
          this.hoveredFrom = undefined;
          this.reveal();
        };
        view.dom.ownerDocument.addEventListener('scroll', this.onScroll, true);
        view.dom.addEventListener('pointermove', this.onPointerMove);
        view.dom.addEventListener('pointerleave', this.onPointerLeave);
        this.onCalloutAction = (e) => {
          if ('key' in e && !['Enter', ' '].includes(e.key)) return;
          const target = eventElement(e.target)?.closest<HTMLElement>('.flow-callout-type-trigger');
          if (!target || !view.dom.contains(target)) return;
          e.preventDefault();
          e.stopPropagation();
          const ctx = info(view);
          if (!ctx?.file || view.state.doc !== this.drawnDoc || ctx.file !== this.drawnFile) {
            this.measure();
            return;
          }
          const r = target.getBoundingClientRect();
          plugin.openCalloutTypes(
            ctx.editor,
            ctx.file,
            Number(target.dataset.flowCalloutFrom),
            { left: r.left, bottom: r.bottom, element: target },
            view.dom.ownerDocument,
          );
        };
        view.dom.addEventListener('click', this.onCalloutAction, true);
        view.dom.addEventListener('keydown', this.onCalloutAction, true);
        this.onCalloutPointer = (e) => {
          if (
            e.button === 0 &&
            eventElement(e.target)?.closest<HTMLElement>('.flow-callout-type-trigger')
          ) {
            e.preventDefault();
            e.stopPropagation();
          }
        };
        view.dom.addEventListener('pointerdown', this.onCalloutPointer, true);
        this.observer = new (windowFor(view.dom.ownerDocument).MutationObserver)((records) => {
          if (
            records.some(
              (r) =>
                eventElement(r.target)?.closest('.callout, .cm-fold-indicator') ||
                [...r.addedNodes, ...r.removedNodes].some(
                  (n) =>
                    eventElement(n)?.matches('.callout, .cm-fold-indicator') ||
                    eventElement(n)?.querySelector('.callout, .cm-fold-indicator'),
                ),
            )
          )
            this.measure();
        });
        this.observer.observe(view.contentDOM, { childList: true, subtree: true });
        this.measure();
      }
      createButton() {
        const view = this.view,
          doc = view.dom.ownerDocument,
          button = ui.el(doc, 'button', 'flow-block-handle');
        button.type = 'button';
        button.title = '块操作 · 点击打开菜单';
        button.setAttribute('aria-label', '打开块操作');
        button.tabIndex = -1;
        button.append(
          ui.el(doc, 'span', 'flow-block-type'),
          ui.icon(doc, 'grip-vertical', setIcon),
        );
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const ctx = info(view);
          if (
            !ctx?.editor ||
            !ctx.file ||
            ctx.file !== this.drawnFile ||
            view.state.doc !== this.drawnDoc
          ) {
            this.measure();
            return;
          }
          const r = button.getBoundingClientRect();
          plugin.openBlock(
            ctx.editor,
            ctx.file,
            Number(button.dataset.flowFrom),
            { left: r.left, bottom: r.bottom, element: button },
            doc,
          );
        });
        return button;
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.geometryChanged ||
          info(this.view)?.file !== this.drawnFile ||
          update.transactions.some((t) => t.effects.some((e) => e.is(refresh)))
        )
          this.measure();
        if (update.docChanged) this.hoveredFrom = undefined;
        if (update.selectionSet || update.focusChanged || update.docChanged) this.reveal();
      }
      reveal() {
        const view = this.view;
        const active =
          this.hoveredFrom ??
          (view.hasFocus
            ? core.blockAt(
                view.state.doc.toString(),
                view.state.selection.main.head,
                scan(view.state.doc),
              ).from
            : undefined);
        for (const [from, button] of this.buttons)
          button.classList.toggle('flow-handle-revealed', from === active);
      }
      restoreTrigger(node: HTMLElement, attrs: Record<string, string | null>) {
        node.classList.remove('flow-callout-type-trigger');
        for (const [key, value] of Object.entries(attrs))
          if (value == null) node.removeAttribute(key);
          else node.setAttribute(key, value);
      }
      updateCalloutTriggers() {
        const seen = new Set<HTMLElement>(),
          view = this.view,
          text = view.state.doc.toString();
        for (const node of view.contentDOM.querySelectorAll<HTMLElement>(
          '.callout > .callout-title > .callout-icon',
        )) {
          const callout = node.closest<HTMLElement>('.callout');
          if (!callout || callout.parentElement?.closest('.callout')) continue;
          if (/^flow-gallery-/.test(callout.dataset.callout || '')) continue;
          let block;
          try {
            block = core.blockAt(text, view.posAtDOM(callout), scan(view.state.doc));
          } catch {
            continue;
          }
          if (!core.calloutInfo(block)) continue;
          seen.add(node);
          if (!this.triggers.has(node))
            this.triggers.set(
              node,
              Object.fromEntries(
                ['role', 'tabindex', 'title', 'aria-label', 'data-flow-callout-from'].map((key) => [
                  key,
                  node.getAttribute(key),
                ]),
              ),
            );
          if (!node.classList.contains('flow-callout-type-trigger'))
            node.classList.add('flow-callout-type-trigger');
          for (const [key, value] of Object.entries({
            role: 'button',
            tabindex: '0',
            title: '更改高亮块类型',
            'aria-label': '更改高亮块类型',
            'data-flow-callout-from': String(block.from),
          }))
            if (node.getAttribute(key) !== value) node.setAttribute(key, value);
        }
        for (const [node, attrs] of this.triggers)
          if (!seen.has(node)) {
            this.restoreTrigger(node, attrs);
            this.triggers.delete(node);
          }
      }
      measure() {
        if (this.dead) return;
        this.view.requestMeasure({
          key: this,
          read: (view): Measurement => {
            const file = info(view)?.file,
              snapshot = view.state.doc;
            const result: Measurement = { file, snapshot, items: [], hitAreas: [] };
            if (!file || !plugin.settings.blockHandles) return result;
            const host = view.dom.getBoundingClientRect(),
              content = view.contentDOM.getBoundingClientRect(),
              scroller = view.scrollDOM.getBoundingClientRect();
            const scale = host.width / (view.dom.offsetWidth || host.width || 1) || 1;
            const columnLeft =
              content.left +
              (parseFloat(
                windowFor(view.dom.ownerDocument).getComputedStyle(view.contentDOM).paddingLeft,
              ) || 0) *
                scale;
            const space = (columnLeft - Math.max(host.left, scroller.left)) / scale;
            const width = space >= 52 ? 40 : 18,
              gap = space >= 52 ? 12 : 4;
            // Compact in a narrow margin. Never add padding to make room.
            if (space < width + gap) return result;
            for (const block of scan(snapshot)) {
              if (
                block.protected ||
                !view.visibleRanges.some(
                  (r) => block.contentFrom >= r.from && block.contentFrom < r.to,
                )
              )
                continue;
              const coords = view.coordsAtPos(block.contentFrom);
              if (!coords) continue;
              if (coords.bottom < scroller.top || coords.top > scroller.bottom) continue;
              const end = view.coordsAtPos(block.to);
              // Headings keep a folding lane even before Obsidian renders the arrow.
              let handleRight = columnLeft - (/^h[1-6]$/.test(block.type) ? 40 : gap) * scale;
              const { node } = view.domAtPos(block.contentFrom);
              const line = (eventElement(node) || node.parentElement)?.closest('.cm-line');
              for (const arrow of line?.querySelectorAll(
                '.cm-fold-indicator .collapse-indicator',
              ) || []) {
                const rect = arrow.getBoundingClientRect();
                if (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  rect.left < columnLeft &&
                  rect.bottom >= coords.top &&
                  rect.top <= coords.bottom
                )
                  handleRight = Math.min(handleRight, rect.left - 12 * scale);
              }
              const available = (handleRight - Math.max(host.left, scroller.left)) / scale;
              const handleWidth = available >= width ? width : 18;
              if (available < handleWidth) continue;
              result.hitAreas.push({
                from: block.from,
                top: coords.top - 3,
                bottom: Math.max(coords.bottom, end?.bottom || scroller.bottom) + 3,
              });
              result.items.push({
                from: block.from,
                type: block.type,
                compact: handleWidth === 18,
                left: (handleRight - host.left) / scale - handleWidth,
                top:
                  (coords.top - host.top) / scale +
                  Math.max(0, ((coords.bottom - coords.top) / scale - 25) / 2),
              });
            }
            return result;
          },
          write: (result) => {
            if (
              this.dead ||
              this.view.state.doc !== result.snapshot ||
              info(this.view)?.file !== result.file
            )
              return;
            this.drawnDoc = result.snapshot;
            this.drawnFile = result.file;
            this.updateCalloutTriggers();
            this.hitAreas = result.hitAreas;
            this.hoveredFrom = this.hitAreas.find(
              (a) =>
                this.pointerY !== undefined && this.pointerY >= a.top && this.pointerY <= a.bottom,
            )?.from;
            const kept = new Set();
            for (const item of result.items) {
              let button = this.buttons.get(item.from);
              if (!button) {
                button = this.createButton();
                this.buttons.set(item.from, button);
                this.root.append(button);
              }
              kept.add(item.from);
              button.dataset.flowFrom = String(item.from);
              button.classList.toggle('flow-handle-compact', item.compact);
              const label = button.querySelector('.flow-block-type');
              if (label)
                label.textContent = /^h\d$/.test(item.type)
                  ? item.type.toUpperCase()
                  : (
                      {
                        text: 'T',
                        bullet: '•',
                        ordered: '1.',
                        task: '☑',
                        code: '{}',
                        quote: '❝',
                        callout: '▣',
                        table: '▦',
                        math: '∑',
                        divider: '—',
                      } as Record<string, string>
                    )[item.type] || 'T';
              button.style.left = item.left + 'px';
              button.style.top = item.top + 'px';
            }
            for (const [from, button] of this.buttons)
              if (!kept.has(from)) {
                button.remove();
                this.buttons.delete(from);
              }
            this.reveal();
          },
        });
      }
      destroy() {
        this.dead = true;
        this.view.dom.ownerDocument.removeEventListener('scroll', this.onScroll, true);
        this.view.dom.removeEventListener('pointermove', this.onPointerMove);
        this.view.dom.removeEventListener('pointerleave', this.onPointerLeave);
        this.view.dom.removeEventListener('click', this.onCalloutAction, true);
        this.view.dom.removeEventListener('keydown', this.onCalloutAction, true);
        this.view.dom.removeEventListener('pointerdown', this.onCalloutPointer, true);
        this.observer.disconnect();
        for (const [node, attrs] of this.triggers) this.restoreTrigger(node, attrs);
        this.triggers.clear();
        this.root.remove();
        this.buttons.clear();
      }
    },
  );
  // CodeMirror owns editor DOM attributes; direct classList edits are overwritten on updates.
  const attributes = EditorView.editorAttributes.of({ class: 'flow-editor' });
  const lifecycle = ViewPlugin.fromClass(
    class {
      view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        plugin.editors.add(view);
      }
      destroy() {
        plugin.editors.delete(this.view);
      }
    },
  );
  const selectionGesture = StateEffect.define<boolean>();
  const selecting = StateField.define({
    create: () => false,
    update(value, tr) {
      for (const effect of tr.effects) if (effect.is(selectionGesture)) value = effect.value;
      return value;
    },
  });
  const selectionCompletion = ViewPlugin.fromClass(
    class {
      view: EditorView;
      mode: 'pointer' | 'keyboard' | null;
      frame: number;
      dead: boolean;
      doc: Document;
      win: AppWindow;
      start: (mode: 'pointer' | 'keyboard') => void;
      finish: () => void;
      down: (event: MouseEvent) => void;
      up: () => void;
      keydown: (event: KeyboardEvent) => void;
      keyup: () => void;
      constructor(view: EditorView) {
        this.view = view;
        this.mode = null;
        this.frame = 0;
        this.dead = false;
        const doc = view.dom.ownerDocument,
          win = windowFor(doc);
        this.doc = doc;
        this.win = win;
        this.start = (mode) => {
          if (this.frame) {
            win.cancelAnimationFrame(this.frame);
            this.frame = 0;
          }
          this.mode = mode;
          if (!view.state.field(selecting)) view.dispatch({ effects: selectionGesture.of(true) });
        };
        this.finish = () => {
          if (!this.mode || this.frame) return;
          // pointerup precedes mouseup. Let native selection handling commit first.
          this.frame = win.requestAnimationFrame(() => {
            this.frame = 0;
            this.mode = null;
            if (!this.dead) view.dispatch({ effects: selectionGesture.of(false) });
          });
        };
        this.down = (e) => {
          if (
            e.button !== 0 ||
            !view.contentDOM.contains(eventElement(e.target)) ||
            eventElement(e.target)?.closest('.flow-callout-type-trigger')
          )
            return;
          this.start('pointer');
        };
        this.up = () => {
          if (this.mode === 'pointer') this.finish();
        };
        const selectionKey = (e: KeyboardEvent) =>
          (e.shiftKey &&
            /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(e.key)) ||
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a');
        this.keydown = (e) => {
          if (view.contentDOM.contains(eventElement(e.target)) && selectionKey(e))
            this.start('keyboard');
        };
        this.keyup = () => {
          if (this.mode === 'keyboard') this.finish();
        };
        for (const name of ['pointerdown', 'mousedown'] as const)
          doc.addEventListener(name, this.down, true);
        for (const name of ['pointerup', 'mouseup', 'pointercancel', 'dragend'] as const)
          doc.addEventListener(name, this.up, true);
        doc.addEventListener('keydown', this.keydown, true);
        doc.addEventListener('keyup', this.keyup, true);
        win.addEventListener('blur', this.finish);
      }
      destroy() {
        this.dead = true;
        if (this.frame) this.win.cancelAnimationFrame(this.frame);
        for (const name of ['pointerdown', 'mousedown'] as const)
          this.doc.removeEventListener(name, this.down, true);
        for (const name of ['pointerup', 'mouseup', 'pointercancel', 'dragend'])
          this.doc.removeEventListener(name, this.up, true);
        this.doc.removeEventListener('keydown', this.keydown, true);
        this.doc.removeEventListener('keyup', this.keyup, true);
        this.win.removeEventListener('blur', this.finish);
      }
    },
  );
  const selection = showTooltip.compute(['selection', 'doc', styles, selecting], (state) => {
    const s = state.selection.main,
      ctx = state.field(editorInfoField, false);
    if (
      state.field(selecting) ||
      !plugin.settings.selectionToolbar ||
      s.empty ||
      !ctx?.editor ||
      !ctx.file ||
      state.selection.ranges.length !== 1
    )
      return null;
    const b = core.blockAt(state.doc.toString(), s.from, scan(state.doc));
    if (b.protected || s.to > b.to || ['code', 'math', 'indented-code'].includes(b.type))
      return null;
    const editor = ctx.editor;
    return {
      pos: s.from,
      end: s.to,
      above: true,
      strictSide: false,
      create(view) {
        const file = ctx.file;
        const dom = ui.toolbar(
          view.dom.ownerDocument,
          (id, button) => {
            // CodeMirror may retain a tooltip DOM after edits. Read the current selection,
            // never the document / offsets captured when this toolbar was first created.
            const current = view.state.selection.main,
              currentInfo = info(view),
              text = view.state.doc.toString();
            if (
              current.empty ||
              view.state.selection.ranges.length !== 1 ||
              currentInfo?.file !== file ||
              currentInfo.editor !== editor ||
              editor.getValue() !== text
            )
              return;
            const block = core.blockAt(text, current.from, scan(view.state.doc));
            if (
              block.protected ||
              current.to > block.to ||
              ['code', 'math', 'indented-code'].includes(block.type)
            )
              return;
            const rect = button.getBoundingClientRect(),
              anchor = {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                element: button,
                boundary: view.scrollDOM,
              };
            if (id === 'type')
              plugin.openBlockTypes(editor, file, current.from, anchor, view.dom.ownerDocument);
            else if (id === 'callout')
              plugin.openCalloutTypes(editor, file, current.from, anchor, view.dom.ownerDocument);
            else if (id === 'color' || id === 'align')
              plugin.openBlockStyle(editor, file, current.from, id, anchor, view.dom.ownerDocument);
            else if (['bullet', 'ordered', 'task', 'quote'].includes(id))
              plugin.convertSelectedBlock(editor, file, current.from, id);
            else if (id === 'indent' || id === 'outdent')
              plugin.indentSelectedBlock(editor, file, current.from, id === 'indent' ? 1 : -1);
            else if (id === 'comment')
              plugin.commentSelection(editor, file, { from: current.from, to: current.to });
            else
              plugin.inline(
                editor,
                file,
                id,
                { from: current.from, to: current.to },
                view.dom.ownerDocument,
              );
          },
          setIcon,
          [],
          { block: b, comment: !!plugin.commentProvider() },
        );
        const tooltip = ui.el(view.dom.ownerDocument, 'div', 'flow-toolbar-tooltip');
        tooltip.append(dom);
        function sync() {
          const text = view.state.doc.toString(),
            selected = view.state.selection.main,
            active = [];
          if (!selected.empty)
            for (const [id, mark] of [
              ['bold', '**'],
              ['italic', '*'],
              ['strike', '~~'],
              ['highlight', '=='],
              ['inline-code', '`'],
            ]) {
              const change = core.wrapInline(text, selected.from, selected.to, mark);
              if (change.insert.length < change.to - change.from) active.push(id);
            }
          ui.updateToolbar(dom, active, {
            block: core.blockAt(text, selected.from, scan(view.state.doc)),
          });
        }
        let lastPoint: { left: number; right: number; top: number; bottom: number } | null = null;
        sync();
        return {
          dom: tooltip,
          update: sync,
          resize: false,
          getCoords(pos: number) {
            const bounds = ui.editorBounds(view.dom.ownerDocument, view.scrollDOM),
              host = view.dom.getBoundingClientRect();
            const scale = host.width / (view.dom.offsetWidth || host.width || 1) || 1;
            dom.style.setProperty(
              '--flow-toolbar-space',
              Math.max(24, bounds.right - bounds.left - 16) / scale + 'px',
            );
            dom.style.setProperty(
              '--flow-toolbar-height',
              Math.max(24, bounds.bottom - bounds.top - 16) / scale + 'px',
            );
            const point = view.coordsAtPos(pos) || lastPoint;
            if (!point) return view.dom.getBoundingClientRect();
            lastPoint = point;
            const width = dom.getBoundingClientRect().width;
            const left = Math.max(bounds.left + 8, Math.min(point.left, bounds.right - width - 8));
            return { left, right: left, top: point.top, bottom: point.bottom };
          },
          positioned() {
            const bounds = ui.editorBounds(view.dom.ownerDocument, view.scrollDOM),
              rect = tooltip.getBoundingClientRect();
            if (rect.top < -5000) return;
            const sx = rect.width / (tooltip.offsetWidth || rect.width || 1) || 1,
              sy = rect.height / (tooltip.offsetHeight || rect.height || 1) || 1;
            const left = Math.max(
              bounds.left + 8,
              Math.min(rect.left, bounds.right - rect.width - 8),
            );
            let top = rect.top;
            if (top < bounds.top + 8 && lastPoint) top = lastPoint.bottom + 6;
            top = Math.max(bounds.top + 8, Math.min(top, bounds.bottom - rect.height - 8));
            if (left !== rect.left)
              tooltip.style.left =
                (parseFloat(tooltip.style.left) || 0) + (left - rect.left) / sx + 'px';
            if (top !== rect.top)
              tooltip.style.top =
                (parseFloat(tooltip.style.top) || 0) + (top - rect.top) / sy + 'px';
          },
        };
      },
    };
  });
  const imageLayouts = ViewPlugin.fromClass(
    class {
      controller: ImageLayouts<EditorImageCapture>;
      constructor(view: EditorView) {
        this.controller = new ImageLayouts(
          view.contentDOM,
          (node) => {
            const ctx = info(view),
              snapshot = view.state.doc.toString();
            if (!ctx?.editor || !ctx.file) throw new Error('请先打开 Markdown 笔记');
            const offset = view.posAtDOM(node);
            return {
              snapshot,
              editor: ctx.editor,
              file: ctx.file,
              target: galleryTarget(snapshot, offset, offset),
            };
          },
          (captured, change) => {
            const ctx = info(view);
            if (
              ctx?.editor !== captured.editor ||
              ctx.file !== captured.file ||
              view.state.doc.toString() !== captured.snapshot
            )
              throw new Error('文档已更改，已取消图片调整');
            const selection = view.state.selection.main;
            const mapped = core.retainSelection(change, captured.snapshot, {
              from: selection.anchor,
              to: selection.head,
            });
            if (mapped)
              view.dispatch({
                changes: { from: mapped.from, to: mapped.to, insert: mapped.insert },
                selection: {
                  anchor: mapped.selectFrom ?? selection.anchor,
                  head: mapped.selectTo ?? selection.head,
                },
                userEvent: 'input.flow-image-resize',
              });
          },
          (err) => {
            const ctx = info(view);
            if (ctx)
              plugin.perform(ctx.editor, ctx.file, () => {
                throw err;
              });
            else plugin.imageNotice(errorMessage(err));
          },
          true,
        );
      }
      update() {
        this.controller.schedule();
      }
      destroy() {
        this.controller.destroy();
      }
    },
  );
  return [
    styles,
    handles,
    lifecycle,
    selecting,
    selectionCompletion,
    selection,
    attributes,
    imageLayouts,
  ];
}
export { editorExtension, refresh };
