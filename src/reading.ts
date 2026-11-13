import { blocks } from './core';
import { ImageLayouts, galleryTarget } from './images';
import type { Block } from './core';
import type { GalleryTarget } from './images';
import type FlowEdit from './plugin';
import type * as O from 'obsidian';
import { errorMessage } from './dom';
interface ReadingCapture {
  file: O.TFile;
  snapshot: string;
  target: GalleryTarget;
}
function isFile(file: O.TAbstractFile | null): file is O.TFile {
  return !!file && 'extension' in file && typeof file.extension === 'string';
}

// Style only renderer sections with one unambiguous source block.
// No text matching: duplicate paragraphs must never inherit a neighbor's style.
function applyReadingStyle(
  root: HTMLElement,
  info: O.MarkdownSectionInformation | null,
  fullText: string,
  parsed?: Block[],
) {
  for (const node of [root, ...root.querySelectorAll('.flow-styled')]) {
    for (const c of [...node.classList])
      if (/^flow-(?:styled$|align-|color-|background-)/.test(c)) node.classList.remove(c);
  }
  if (!info) return;
  const all = parsed || blocks(fullText),
    candidates = all.filter(
      (b) => !b.protected && b.contentLine >= info.lineStart && b.contentLine <= info.lineEnd,
    );
  if (candidates.length !== 1 || !candidates[0].style) return;
  const b = candidates[0];
  if (b.endLine > info.lineEnd) return;
  const s = b.style;
  if (!s) return;
  root.classList.add(
    'flow-styled',
    `flow-align-${s.align}`,
    `flow-color-${s.color}`,
    `flow-background-${s.background}`,
  );
}
function readingSupport(
  plugin: FlowEdit,
  { MarkdownRenderChild }: Pick<typeof O, 'MarkdownRenderChild'>,
) {
  const cache = new Map<string, { text: string; blocks: Block[] }>();
  return class extends MarkdownRenderChild {
    root: HTMLElement;
    ctx: O.MarkdownPostProcessorContext;
    images?: ImageLayouts<ReadingCapture>;
    revision = 0;
    dead = false;
    constructor(root: HTMLElement, ctx: O.MarkdownPostProcessorContext) {
      super(root);
      this.root = root;
      this.ctx = ctx;
    }
    onload() {
      plugin.readers.add(this);
      this.images = new ImageLayouts(
        this.root,
        async (node) => {
          const file = plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
          if (!isFile(file)) throw new Error('图片所在笔记已移动或删除');
          const snapshot = await plugin.app.vault.cachedRead(file),
            info = this.ctx.getSectionInfo(node);
          if (!info) throw new Error('无法定位图片源文，请在编辑视图中调整');
          const candidates = blocks(snapshot).filter(
            (b) =>
              b.contentLine >= info.lineStart &&
              b.endLine <= info.lineEnd &&
              /^> \[!flow-gallery-/.test(b.text),
          );
          if (candidates.length !== 1) throw new Error('图片组定位不明确，请在编辑视图中调整');
          const offset = candidates[0].contentFrom;
          return { file, snapshot, target: galleryTarget(snapshot, offset, offset) };
        },
        async (captured, change) => {
          if (this.dead) throw new Error('笔记视图已关闭');
          await plugin.app.vault.process(captured.file, (text) => {
            if (text !== captured.snapshot) throw new Error('文档已更改，已取消图片调整');
            return text.slice(0, change.from) + change.insert + text.slice(change.to);
          });
        },
        (err) => {
          console.error('Flow Edit:', err);
          plugin.imageNotice(errorMessage(err));
        },
      );
      this.repaint().catch((e) => console.error('Flow Edit:', e));
    }
    async repaint() {
      const revision = (this.revision || 0) + 1;
      this.revision = revision;
      this.root.classList.add('flow-reading');
      const file = plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
      if (!isFile(file)) return;
      const text = await plugin.app.vault.cachedRead(file);
      if (this.dead || revision !== this.revision) return;
      let entry = cache.get(this.ctx.sourcePath);
      if (!entry || entry.text !== text) {
        entry = { text, blocks: blocks(text) };
        cache.set(this.ctx.sourcePath, entry);
      }
      applyReadingStyle(this.root, this.ctx.getSectionInfo(this.root), text, entry.blocks);
    }
    onunload() {
      this.dead = true;
      this.images?.destroy();
      plugin.readers.delete(this);
      applyReadingStyle(this.root, null, '');
      if (![...plugin.readers].some((r) => r.ctx.sourcePath === this.ctx.sourcePath))
        cache.delete(this.ctx.sourcePath);
      this.root.classList.remove('flow-reading');
    }
  };
}
export { applyReadingStyle, readingSupport };
