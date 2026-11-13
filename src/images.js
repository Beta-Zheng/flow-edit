'use strict';
const { blocks, blockAt } = require('./core');
const headerPattern = /^> \[!flow-gallery-([1-4])(?:\|widths=([\d.,-]+))?\]$/;

// Parse whole image-only selections; never consume surrounding prose or note embeds.
function imageTokens(text) {
  const result = [];
  let rest = text.trim();
  while (rest) {
    let end = 0;
    if (rest.startsWith('![[')) {
      end = rest.indexOf(']]') + 2;
      if (
        end < 4 ||
        !/\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?)$/i.test(
          rest.slice(3, end - 2).split(/[|#]/)[0],
        )
      )
        return null;
    } else if (rest.startsWith('![')) {
      let i = 2,
        depth = 1;
      for (; i < rest.length && depth; i++) {
        if (rest[i] === '\\') i++;
        else if (rest[i] === '[') depth++;
        else if (rest[i] === ']') depth--;
      }
      if (depth || rest[i] !== '(') return null;
      depth = 1;
      let quote = '',
        angle = false;
      for (i++; i < rest.length && depth; i++) {
        const c = rest[i];
        if (c === '\\') {
          i++;
          continue;
        }
        if (quote) {
          if (c === quote) quote = '';
          continue;
        }
        if (angle) {
          if (c === '>') angle = false;
          continue;
        }
        if (c === '<') angle = true;
        else if ((c === '"' || c === "'") && /\s/.test(rest[i - 1])) quote = c;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
      }
      if (depth || quote || angle) return null;
      end = i;
    } else return null;
    result.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  return result.length ? result : null;
}
function safeWidths(value, count, columns) {
  const parsed = typeof value === 'string' ? value.split(',').map(Number) : value;
  return Array.isArray(parsed) &&
    parsed.length === count &&
    parsed.every((n) => Number.isFinite(n) && n >= 10 && n <= 100)
    ? parsed
    : Array(count).fill(Number((100 / columns).toFixed(2)));
}
function galleryTarget(text, from, to) {
  const all = blocks(text),
    current = blockAt(text, from, all);
  const header = headerPattern.exec(current.text.split('\n')[0]);
  if (header && to <= current.to) {
    const body = current.text
      .split('\n')
      .slice(1)
      .map((line) => line.replace(/^> ?/, ''))
      .join('\n');
    const images = imageTokens(body);
    if (!images) throw new Error('图片组包含非图片内容，请先在源码中整理');
    const columns = Number(header[1]);
    return {
      from: current.contentFrom,
      to: current.to,
      text: current.text,
      images,
      columns,
      widths: safeWidths(header[2], images.length, columns),
      gallery: true,
    };
  }
  if (from === to) {
    let index = all.indexOf(current),
      end = index;
    if (index < 0 || current.type !== 'text' || !imageTokens(current.text))
      throw new Error('请选中多张图片，或将光标放入图片组');
    while (
      index > 0 &&
      all[index - 1].type === 'text' &&
      !all[index - 1].style &&
      imageTokens(all[index - 1].text)
    )
      index--;
    while (
      end + 1 < all.length &&
      all[end + 1].type === 'text' &&
      !all[end + 1].style &&
      imageTokens(all[end + 1].text)
    )
      end++;
    from = all[index].contentFrom;
    to = all[end].to;
  }
  const candidates = all.filter((b) => b.to > from && b.from < to);
  if (
    candidates.some((b) => b.type !== 'text' || b.style) ||
    candidates.some((b) => b.contentFrom < from || b.to > to)
  )
    throw new Error('请完整选择图片，不要包含文字、代码或其他块');
  // Leave selected blank-line separators outside the replacement range.
  if (candidates.length) {
    from = candidates[0].contentFrom;
    to = candidates.at(-1).to;
  }
  const selected = text.slice(from, to),
    images = imageTokens(selected);
  if (!images || images.length < 2) throw new Error('请至少选择两张图片，不要包含其他文字');
  return {
    from,
    to,
    text: selected,
    images,
    columns: 2,
    widths: safeWidths(null, images.length, 2),
    gallery: false,
  };
}
function galleryHeader(columns, widths) {
  return (
    '> [!flow-gallery-' +
    columns +
    '|widths=' +
    widths.map((n) => Number(n.toFixed(2))).join(',') +
    ']'
  );
}
function layoutChange(target, columns) {
  if (![0, 1, 2, 3, 4].includes(columns)) throw new Error('不支持的图片列数');
  const body = target.images.join('\n\n');
  return {
    from: target.from,
    to: target.to,
    insert:
      columns === 0
        ? body
        : galleryHeader(columns, safeWidths(null, target.images.length, columns)) +
          '\n' +
          body
            .split('\n')
            .map((line) => (line ? '> ' + line : '>'))
            .join('\n'),
  };
}
function widthChange(target, widths) {
  return {
    from: target.from,
    to: target.from + target.text.split('\n')[0].length,
    insert: galleryHeader(target.columns, safeWidths(widths, target.images.length, target.columns)),
  };
}
function resizeWidths(widths, columns, index, delta) {
  const result = [...widths],
    start = Math.floor(index / columns) * columns;
  const peer =
    index + 1 < Math.min(start + columns, widths.length)
      ? index + 1
      : index > start
        ? index - 1
        : -1;
  const total = peer < 0 ? 100 : widths[index] + widths[peer];
  result[index] = Math.max(10, Math.min(total - (peer < 0 ? 0 : 10), widths[index] + delta));
  if (peer >= 0) result[peer] = total - result[index];
  return result;
}

// Own the controls without moving or replacing Obsidian's rendered image nodes.
const imageOwners = new WeakMap();
class ImageLayouts {
  constructor(root, resolve, save, report, editable = false) {
    this.root = root;
    this.resolve = resolve;
    this.save = save;
    this.report = report;
    this.editable = editable;
    this.entries = new Map();
    this.win = root.ownerDocument.defaultView;
    this.observer = new this.win.MutationObserver(() => this.schedule());
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-callout', 'data-callout-metadata'],
    });
    this.schedule();
  }
  schedule() {
    if (this.dead || this.frame) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  }
  refresh() {
    for (const [node, entry] of this.entries) {
      if (
        !this.root.contains(node) ||
        entry.signature !== node.dataset.callout + ':' + node.dataset.calloutMetadata ||
        entry.cards.some((card) => !node.contains(card)) ||
        entry.controls.some((control) => !node.contains(control))
      ) {
        this.release(node);
      }
    }
    const nodes = [...this.root.querySelectorAll('[data-callout^="flow-gallery-"]')];
    if (this.root.matches('[data-callout^="flow-gallery-"]')) nodes.unshift(this.root);
    for (const node of nodes) {
      if (this.entries.has(node)) continue;
      const owner = imageOwners.get(node);
      if (owner && owner !== this) {
        if (!this.editable || owner.editable) continue;
        owner.release(node);
      }
      const columns = Number(node.dataset.callout.slice('flow-gallery-'.length));
      if (![1, 2, 3, 4].includes(columns)) continue;
      const content = node.querySelector(':scope > .callout-content');
      const cards = [...(content?.children || [])].filter(
        (n) => n.tagName === 'P' && n.querySelector('img, .image-embed'),
      );
      if (!cards.length) continue;
      const widths = safeWidths(
        (node.dataset.calloutMetadata || '').replace(/^widths=/, ''),
        cards.length,
        columns,
      );
      const paint = (values) =>
        cards.forEach((card, i) =>
          card.style.setProperty('--flow-image-share', String(values[i] / 100)),
        );
      paint(widths);
      cards.forEach((card) => card.classList.add('flow-image-card'));
      const controls = [],
        removers = [];
      let cancelled = null;
      for (const [index, card] of cards.entries()) {
        // One divider between neighbors; a row's outer edge stays stationary.
        if (
          columns > 1 &&
          index % columns > 0 &&
          (index % columns === columns - 1 || index === cards.length - 1)
        )
          continue;
        const handle = node.ownerDocument.createElement('button');
        handle.type = 'button';
        handle.className = 'flow-image-resizer';
        handle.title = '拖拽调整宽度 · 方向键微调';
        handle.setAttribute('aria-label', '调整第 ' + (index + 1) + ' 张图片宽度');
        handle.textContent = '⋮';
        card.classList.add('flow-image-card');
        card.append(handle);
        controls.push(handle);
        const begin = async (event) => {
          if (event.type === 'pointerdown' && event.button !== 0) return;
          if (event.type === 'keydown' && !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (cancelled) return;
          try {
            const captured = await this.resolve(node);
            if (this.dead || !node.isConnected) return;
            if (captured.target.images.length !== cards.length)
              throw new Error('图片尚未渲染完成，请稍后重试');
            if (event.type === 'keydown') {
              const values = resizeWidths(
                captured.target.widths,
                columns,
                index,
                event.key === 'ArrowRight' ? 2 : -2,
              );
              await this.save(captured, widthChange(captured.target, values));
              return;
            }
            const original = captured.target.widths,
              startX = event.clientX;
            const box = content.getBoundingClientRect();
            const scale = box.width / (content.offsetWidth || box.width || 1);
            const gap = parseFloat(this.win.getComputedStyle(content).columnGap) || 12;
            const available = box.width - gap * scale * (columns - 1);
            if (available <= 0) return;
            let values = original;
            const move = (e) => {
              if (e.pointerId !== event.pointerId) return;
              values = resizeWidths(
                original,
                columns,
                index,
                ((e.clientX - startX) / available) * 100,
              );
              paint(values);
            };
            const cleanup = () => {
              for (const [type, fn] of [
                ['pointermove', move],
                ['pointerup', end],
                ['pointercancel', cancel],
                ['keydown', escape],
              ])
                this.win.removeEventListener(type, fn, true);
              this.win.removeEventListener('blur', cancel);
              handle.removeEventListener('lostpointercapture', cancel);
              if (handle.hasPointerCapture?.(event.pointerId))
                handle.releasePointerCapture(event.pointerId);
              node.classList.remove('flow-image-dragging');
              cancelled = null;
            };
            const cancel = () => {
              cleanup();
              paint(original);
            };
            const end = (e) => {
              if (e.pointerId !== event.pointerId) return;
              move(e);
              cleanup();
              if (values.every((value, i) => Math.abs(value - original[i]) < 0.01)) {
                paint(original);
                return;
              }
              Promise.resolve()
                .then(() => this.save(captured, widthChange(captured.target, values)))
                .catch((err) => {
                  paint(original);
                  this.report(err);
                });
            };
            const escape = (e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              }
            };
            cancelled = cancel;
            try {
              handle.setPointerCapture?.(event.pointerId);
            } catch {
              cancel();
              return;
            }
            node.classList.add('flow-image-dragging');
            handle.addEventListener('lostpointercapture', cancel);
            this.win.addEventListener('pointermove', move, true);
            this.win.addEventListener('pointerup', end, true);
            this.win.addEventListener('pointercancel', cancel, true);
            this.win.addEventListener('keydown', escape, true);
            this.win.addEventListener('blur', cancel);
          } catch (err) {
            this.report(err);
          }
        };
        handle.addEventListener('pointerdown', begin);
        handle.addEventListener('keydown', begin);
        // Clicks after a drag must not open Obsidian's image viewer.
        const click = (e) => {
          e.preventDefault();
          e.stopPropagation();
        };
        handle.addEventListener('click', click);
        removers.push(() => {
          handle.removeEventListener('pointerdown', begin);
          handle.removeEventListener('keydown', begin);
          handle.removeEventListener('click', click);
        });
      }
      this.entries.set(node, {
        signature: node.dataset.callout + ':' + node.dataset.calloutMetadata,
        cards,
        controls,
        dispose: () => {
          cancelled?.();
          removers.forEach((remove) => remove());
          controls.forEach((control) => control.remove());
          cards.forEach((card) => {
            card.classList.remove('flow-image-card');
            card.style.removeProperty('--flow-image-share');
          });
        },
      });
      imageOwners.set(node, this);
    }
  }
  release(node) {
    this.entries.get(node)?.dispose();
    this.entries.delete(node);
    if (imageOwners.get(node) === this) imageOwners.delete(node);
  }
  destroy() {
    this.dead = true;
    this.observer.disconnect();
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    for (const node of this.entries.keys()) this.release(node);
  }
}
module.exports = {
  imageTokens,
  galleryTarget,
  layoutChange,
  widthChange,
  resizeWidths,
  safeWidths,
  ImageLayouts,
};
