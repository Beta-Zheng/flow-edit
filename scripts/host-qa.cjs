'use strict';
// Development verifier only. build.js excludes this command from release.
const { MarkdownView, MarkdownRenderer, Component } = require('obsidian');
const { wrapInline, blockAt, setCalloutType } = require('./core');
const { refresh } = require('./editor');
const ui = require('./ui');
const sha = (text) => require('crypto').createHash('sha256').update(text).digest('hex');
module.exports = async function verify(plugin) {
  const app = plugin.app,
    dir = plugin.manifest.dir,
    report = { version: plugin.manifest.version, checks: [], passed: false };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 100));
  const check = (name, valid, details) => {
    report.checks.push({ name, passed: !!valid, details });
    if (!valid) throw Error(name);
  };
  let editor,
    file,
    note,
    original,
    expected,
    selection,
    cm,
    component,
    fixtureHost,
    fixture,
    sheet,
    sheetWasDisabled,
    suspended = false;
  const knownSnapshots = new Set();
  const sample =
    '\n\n## Flow Edit 解耦验收\n\n> [!note|compact]\n> 验收提示\n\n> [!tip|compact]+ Flow 自定义标题\n> 类型验收正文 **加粗**\n> 第二行\n\n> 我是无序\n\n普通验收正文\n';
  try {
    const leaf = app.workspace
      .getLeavesOfType('markdown')
      .find((l) => l.view instanceof MarkdownView && l.view.file?.path === '测试插件.md');
    if (!leaf) throw Error('Open 测试插件.md before verification');
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await tick();
    note = leaf.view;
    file = note.file;
    editor = note.editor;
    try {
      const prior = JSON.parse(
        await app.vault.adapter.read(dir + '/verification-' + plugin.manifest.version + '.json'),
      );
      if (prior.documentRestored === false) {
        const saved = await app.vault.adapter.read(
          dir + '/verification-original-' + plugin.manifest.version + '.md',
        );
        if (
          sha(saved) === prior.originalSha256 &&
          ['tip', 'warning', 'important'].some(
            (type) =>
              editor.getValue() ===
              saved + sample.replace('[!tip|compact]+ Flow', '[!' + type + '|compact]+ Flow'),
          )
        ) {
          plugin.change(editor, { from: 0, to: editor.getValue().length, insert: saved });
          app.commands.executeCommandById('editor:save-file');
          report.recoveredKnownFixture = true;
        }
      }
    } catch {
      /* A previous verification report is optional. */
    }
    original = expected = editor.getValue();
    knownSnapshots.add(original);
    selection = { from: editor.getCursor('from'), to: editor.getCursor('to') };
    report.originalSha256 = sha(original);
    await app.vault.adapter.write(
      dir + '/verification-original-' + plugin.manifest.version + '.md',
      original,
    );
    expected = original + sample;
    plugin.change(editor, { from: original.length, to: original.length, insert: sample });
    knownSnapshots.add(expected);
    app.commands.executeCommandById('editor:save-file');
    for (let n = 0; n < 35 && (await app.vault.cachedRead(file)) !== expected; n++) await tick();
    cm = plugin.editorView(editor);
    if (!cm) throw Error('CodeMirror missing');
    const heading = expected.lastIndexOf('## Flow Edit 解耦验收');
    cm.dispatch({ selection: { anchor: heading }, scrollIntoView: true });
    await tick();
    await tick();
    const doc = cm.dom.ownerDocument,
      css = (el, pseudo) => doc.defaultView.getComputedStyle(el, pseudo);
    const guard = () => {
      if (note.file !== file || editor.getValue() !== expected)
        throw Error('Concurrent document edit; verification stopped');
      knownSnapshots.add(expected);
    };
    const calloutOffset = expected.lastIndexOf('> [!tip|compact]+ Flow 自定义标题');
    for (
      let n = 0;
      n < 30 &&
      !cm.dom.querySelector(
        `.flow-callout-type-trigger[data-flow-callout-from="${calloutOffset}"]`,
      );
      n++
    )
      await tick();
    const trigger = cm.dom.querySelector(
      `.flow-callout-type-trigger[data-flow-callout-from="${calloutOffset}"]`,
    );
    report.calloutIcons = [...cm.dom.querySelectorAll('.callout-icon')].map((node) => {
      let pos;
      try {
        pos = cm.posAtDOM(node.closest('.callout'));
      } catch (e) {
        pos = e.message;
      }
      return {
        class: node.className,
        assigned: node.dataset.flowCalloutFrom,
        pos,
        type: typeof pos === 'number' ? blockAt(expected, pos).type : null,
      };
    });
    check(
      '原生高亮块图标可编辑类型',
      !!trigger && trigger.getAttribute('role') === 'button' && trigger.tabIndex === 0,
      { expectedOffset: calloutOffset, icons: report.calloutIcons },
    );
    trigger.click();
    await tick();
    check(
      '点击图标直接打开平面类型面板',
      doc.querySelectorAll('.flow-callout-picker [role="menuitemradio"]').length === 10,
    );
    check(
      '当前高亮块类型清晰标记',
      doc.querySelector('.flow-callout-picker [aria-label="提示"]').getAttribute('aria-checked') ===
        'true',
    );
    guard();
    let header = setCalloutType(blockAt(expected, calloutOffset), 'warning');
    expected = expected.slice(0, header.from) + header.insert + expected.slice(header.to);
    doc.querySelector('.flow-callout-picker [aria-label="警告"]').click();
    await tick();
    await tick();
    check('图标入口仅替换标注类型', editor.getValue() === expected);
    check(
      '切换后标题折叠元数据保留',
      editor
        .getValue()
        .includes('> [!warning|compact]+ Flow 自定义标题\n> 类型验收正文 **加粗**\n> 第二行'),
    );
    let from = expected.lastIndexOf('类型验收正文');
    editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(from + 6));
    editor.focus();
    await tick();
    check('完成选区时工具栏可用', !!cm.dom.querySelector('.flow-toolbar'));
    cm.contentDOM.dispatchEvent(
      new doc.defaultView.PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    check('开始重新拖选立即隐藏工具栏', !cm.dom.querySelector('.flow-toolbar'));
    for (const length of [2, 4, 6]) {
      editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(from + length));
      await tick();
      check('拖选停顿仍隐藏工具栏' + length, !cm.dom.querySelector('.flow-toolbar'));
    }
    doc.body.dispatchEvent(
      new doc.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0 }),
    );
    await tick();
    check(
      '正文外松开后显示最终选区工具栏',
      !!cm.dom.querySelector('.flow-toolbar') &&
        cm.state.doc.sliceString(cm.state.selection.main.from, cm.state.selection.main.to) ===
          '类型验收正文',
    );
    cm.contentDOM.dispatchEvent(
      new doc.defaultView.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );
    editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(from + 6));
    await tick();
    check('键盘选择过程中工具栏隐藏', !cm.dom.querySelector('.flow-toolbar'));
    doc.dispatchEvent(
      new doc.defaultView.KeyboardEvent('keyup', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await tick();
    check('键盘完成选择后显示工具栏', !!cm.dom.querySelector('.flow-toolbar'));
    const rich = cm.dom.querySelector('.flow-toolbar');
    const bounds = () => ui.editorBounds(doc, cm.scrollDOM);
    const contained = (node) => {
      const r = node.getBoundingClientRect(),
        b = bounds();
      return (
        r.left >= b.left + 6 &&
        r.right <= b.right - 6 &&
        r.top >= b.top + 6 &&
        r.bottom <= b.bottom - 6
      );
    };
    check('工具栏限制在当前笔记窗格', contained(rich), {
      toolbar: rich.getBoundingClientRect().toJSON(),
      pane: bounds(),
    });
    check(
      '块图标匹配高亮块',
      rich.querySelector('[data-flow-action="type"]').dataset.flowIcon === 'panel-top',
    );
    check(
      '块类型和标注类型区分',
      rich.querySelector('[data-flow-action="type"] .flow-tool-prefix').textContent === '块' &&
        rich.querySelector('[data-flow-action="callout"] .flow-tool-prefix').textContent === '标注',
    );
    const visible = () => [...rich.querySelectorAll('button')].filter((b) => !b.hidden);
    report.toolbarActions = visible().map((b) => b.getAttribute('aria-label'));
    check(
      '常用操作直接可见',
      visible().length >= 14 && !rich.querySelector('[data-flow-action="more"]'),
      report.toolbarActions,
    );
    for (const label of [
      '转换块类型',
      '高亮块类型',
      '块颜色',
      '块对齐',
      '无序列表',
      '有序列表',
      '任务列表',
      '引用',
    ])
      check(label + '直接展示', !!rich.querySelector(`[aria-label="${label}"]`));
    const originalOpen = plugin.openCalloutTypes;
    report.toolbarOpenCalls = 0;
    plugin.openCalloutTypes = function (...args) {
      report.toolbarOpenCalls++;
      return originalOpen.apply(this, args);
    };
    try {
      rich.querySelector('[data-flow-action="callout"]').click();
    } finally {
      plugin.openCalloutTypes = originalOpen;
    }
    const heldPanel = plugin.popup;
    report.panelImmediate = !!doc.querySelector('.flow-callout-picker');
    await tick();
    report.panelAfterTick = !!doc.querySelector('.flow-callout-picker');
    check('工具栏类型面板保持打开', report.panelAfterTick, {
      calls: report.toolbarOpenCalls,
      immediate: report.panelImmediate,
      afterTick: report.panelAfterTick,
      reason: heldPanel?.closeReason,
      range: { from: cm.state.selection.main.from, to: cm.state.selection.main.to },
    });
    check('类型面板限制在当前笔记窗格', contained(heldPanel.root), {
      menu: heldPanel.root.getBoundingClientRect().toJSON(),
      pane: bounds(),
    });
    const menuRect = heldPanel.root.getBoundingClientRect(),
      anchorRect = rich.querySelector('[data-flow-action="callout"]').getBoundingClientRect();
    check(
      '类型面板紧邻触发按钮',
      menuRect.left <= anchorRect.right &&
        menuRect.right >= anchorRect.left &&
        Math.min(
          Math.abs(menuRect.top - anchorRect.bottom),
          Math.abs(menuRect.bottom - anchorRect.top),
        ) <= 9,
      { menu: menuRect.toJSON(), button: anchorRect.toJSON() },
    );
    check('打开块面板标记作用范围', !!cm.dom.querySelector('.flow-format-target'));
    guard();
    header = setCalloutType(blockAt(expected, calloutOffset), 'important');
    expected = expected.slice(0, header.from) + header.insert + expected.slice(header.to);
    doc.querySelector('.flow-callout-picker [aria-label="重要"]').click();
    await tick();
    check('工具栏高亮块类型切换正确', editor.getValue() === expected);
    check(
      '切换类型后保持正文选区',
      cm.state.doc.sliceString(cm.state.selection.main.from, cm.state.selection.main.to) ===
        '类型验收正文',
    );
    check('关闭面板清除范围提示', !cm.dom.querySelector('.flow-format-target'));
    const currentToolbar = cm.dom.querySelector('.flow-toolbar');
    currentToolbar.querySelector('[data-flow-action="type"]').click();
    await tick();
    check('块类型面板限制在窗格', contained(plugin.popup.root));
    check(
      '标题连续分组',
      plugin.popup.root.querySelector('[data-flow-type-group="标题"]').querySelectorAll('button')
        .length === 6,
    );
    check('当前块类型获得焦点', doc.activeElement?.getAttribute('aria-label') === '高亮块');
    const groupedPanel = plugin.popup,
      stableLeft = groupedPanel.root.getBoundingClientRect().left;
    const firstButton = currentToolbar.querySelector('[data-flow-action="type"]'),
      priorDisplay = firstButton.style.display;
    try {
      firstButton.style.display = 'none';
      groupedPanel.position();
      check(
        '触发按钮临时隐藏时菜单不跳转',
        Math.abs(groupedPanel.root.getBoundingClientRect().left - stableLeft) < 1,
      );
    } finally {
      firstButton.style.display = priorDisplay;
    }
    plugin.closePopup();
    await tick();
    currentToolbar.style.maxWidth = '320px';
    await tick();
    const narrow = currentToolbar.getBoundingClientRect();
    check(
      '窄屏工具栏全部操作换行可达',
      narrow.width <= 321 &&
        [...currentToolbar.querySelectorAll('button')]
          .filter((b) => !b.hidden)
          .every((b) => {
            const r = b.getBoundingClientRect();
            return r.left >= narrow.left - 1 && r.right <= narrow.right + 1;
          }),
      { width: narrow.width, height: narrow.height },
    );
    currentToolbar.style.maxWidth = '';
    await tick();
    check('独立主题已启用', css(doc.body).getPropertyValue('--lumen-docs-theme').trim() === '1');
    check(
      '插件没有全局排版类',
      !cm.dom.classList.contains('flow-page') && !doc.querySelector('.flow-preview'),
    );
    check(
      '插件没有注入正文宽度或字号',
      !cm.dom.style.getPropertyValue('--flow-width') &&
        !cm.dom.style.getPropertyValue('--flow-font-size'),
    );
    check(
      '插件只保留编辑功能设置',
      Object.keys(plugin.settings).sort().join(',') === 'blockHandles,selectionToolbar,slashMenu',
    );
    const nativeHeading = [...cm.dom.querySelectorAll('.HyperMD-header')].find((el) =>
      el.textContent.includes('解耦验收'),
    );
    check(
      '独立主题编辑标题无横线',
      !!nativeHeading && css(nativeHeading).borderBottomWidth === '0px',
    );
    check(
      '紧凑高亮块使用原生元数据',
      css(cm.dom.querySelector('.callout[data-callout-metadata="compact"]')).display === 'grid',
    );
    fixtureHost = doc.createElement('div');
    fixture = doc.createElement('div');
    fixture.className = 'markdown-preview-view markdown-rendered';
    fixture.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;font-size:16px;';
    fixtureHost.append(fixture);
    doc.body.append(fixtureHost);
    component = new Component();
    component.load();
    await MarkdownRenderer.render(
      app,
      '# 一级标题\n\n## 二级标题\n\n> 引用与 *斜体*\n\n> [!note|compact]\n> 提示内容 **加粗**\n\n> [!note] 自定义标题\n> 保留标题\n\n> [!warning]- 折叠警告\n> 警告内容\n\n==文字高亮==\n\n| 名称 | 内容 |\n| --- | --- |\n| 测试 | 表格 |',
      fixture,
      file.path,
      component,
    );
    const h2 = fixture.querySelector('h2'),
      quote = fixture.querySelector('blockquote'),
      compact = fixture.querySelector('[data-callout-metadata="compact"]'),
      regular = fixture.querySelector(
        '.callout[data-callout="note"]:not([data-callout-metadata="compact"])',
      ),
      warning = fixture.querySelector('[data-callout="warning"]');
    function verifyTheme(suffix) {
      check(
        '无插件类也有标题层级' + suffix,
        css(h2).fontSize === '24px' && css(h2).borderBottomWidth === '0px',
      );
      check('标题间距' + suffix, css(h2).marginTop === '28px' && css(h2).marginBottom === '10px');
      check(
        '中性引用' + suffix,
        css(quote).fontStyle === 'normal' && css(quote).borderLeftWidth === '2px',
      );
      check('显式斜体保留' + suffix, css(quote.querySelector('em')).fontStyle === 'italic');
      check(
        '主题独立紧凑高亮块' + suffix,
        css(compact).display === 'grid' && css(compact).borderRadius === '8px',
      );
      check(
        '普通加粗跟随正文' + suffix,
        css(compact.querySelector('strong')).color ===
          css(compact.querySelector('.callout-content')).color,
      );
      check(
        '自定义标题保留' + suffix,
        css(regular).display !== 'grid' &&
          css(regular.querySelector('.callout-title-inner')).clipPath !== 'inset(50%)',
      );
      check(
        '警告折叠保留' + suffix,
        warning.classList.contains('is-collapsed') &&
          css(warning.querySelector('.callout-content')).display === 'none',
      );
      check('语义色保留' + suffix, css(warning).borderLeftColor !== css(compact).borderLeftColor);
      check('表格留白' + suffix, css(fixture.querySelector('td')).padding === '8px 12px');
    }
    verifyTheme('（插件开启）');
    check('浅色高亮', css(fixture.querySelector('mark')).backgroundColor === 'rgb(255, 240, 179)');
    fixtureHost.classList.add('theme-dark');
    const highlightProbe = doc.createElement('span');
    highlightProbe.style.backgroundColor = css(fixture).getPropertyValue('--lumen-highlight');
    fixture.append(highlightProbe);
    check(
      '深色高亮',
      css(fixture.querySelector('mark')).backgroundColor === css(highlightProbe).backgroundColor,
    );
    highlightProbe.remove();
    check('深色引用边线', css(quote).borderLeftColor === 'rgb(85, 94, 107)');
    fixtureHost.classList.remove('theme-dark');
    for (const [label, mark] of [
      ['加粗', '**'],
      ['斜体', '*'],
      ['删除线', '~~'],
      ['高亮', '=='],
      ['行内代码', '`'],
    ]) {
      guard();
      const baseline = expected,
        from = expected.lastIndexOf('我是无序');
      editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(from + 4));
      editor.focus();
      await tick();
      const button = cm.dom.querySelector(`.flow-toolbar [aria-label="${label}"]`);
      check(label + '工具栏可用', !!button);
      for (let i = 0; i < 2; i++) {
        guard();
        const s = cm.state.selection.main,
          change = wrapInline(expected, s.from, s.to, mark);
        expected = expected.slice(0, change.from) + change.insert + expected.slice(change.to);
        button.click();
        await tick();
        check(label + '切换' + i, editor.getValue() === expected && editor.somethingSelected());
      }
      check(label + '二次切换还原', editor.getValue() === baseline);
    }
    plugin.openBlock(editor, file, heading, { left: 50, bottom: 120 }, doc);
    const popup = doc.querySelector('.flow-popup'),
      columns = [];
    for (const label of [
      '剪切',
      '复制',
      '创建副本',
      '向上移动',
      '向下移动',
      '删除',
      '复制块链接',
      '清除块样式',
    ]) {
      const b = popup.querySelector(`[aria-label="${label}"]`);
      check(label + '左对齐', css(b).justifyContent === 'flex-start');
      columns.push(b.querySelector('.flow-icon').getBoundingClientRect().left);
    }
    check('菜单图标对齐', Math.max(...columns) - Math.min(...columns) < 1);
    plugin.closePopup();
    await tick();
    const overlay = cm.dom.querySelector(':scope > .flow-block-overlay'),
      buttons = [...overlay.querySelectorAll('button')];
    const columnLeft = () =>
      cm.contentDOM.getBoundingClientRect().left +
      (parseFloat(css(cm.contentDOM).paddingLeft) || 0);
    check(
      '块手柄在正文外',
      buttons.length > 0 &&
        buttons.every((b) => b.getBoundingClientRect().right <= columnLeft() - 3),
    );
    cm.contentDOM.blur();
    cm.dom.dispatchEvent(new doc.defaultView.PointerEvent('pointerleave'));
    await tick();
    check(
      '手柄按需隐藏',
      buttons.every((b) => css(b).opacity === '0'),
    );
    cm.dom.dispatchEvent(
      new doc.defaultView.PointerEvent('pointermove', {
        clientY: cm.coordsAtPos(Number(buttons[0].dataset.flowFrom)).top + 3,
        clientX: columnLeft() + 20,
        bubbles: true,
      }),
    );
    check('悬停只显示当前手柄', buttons.filter((b) => css(b).opacity !== '0').length === 1);
    cm.dom.dispatchEvent(new doc.defaultView.PointerEvent('pointerleave'));
    const layout = () => {
      const r = cm.contentDOM.getBoundingClientRect();
      return { left: r.left, width: r.width, height: r.height };
    };
    const enabled = layout(),
      savedHandles = plugin.settings.blockHandles;
    try {
      plugin.settings.blockHandles = false;
      cm.dispatch({ effects: refresh.of(null) });
      await tick();
      const disabled = layout();
      report.layout = { enabled, disabled };
      check(
        '手柄不改变正文布局',
        Object.keys(enabled).every((k) => Math.abs(enabled[k] - disabled[k]) < 0.5),
      );
    } finally {
      plugin.settings.blockHandles = savedHandles;
      cm.dispatch({ effects: refresh.of(null) });
      await tick();
    }
    // Remove only the theme stylesheet temporarily, leaving the native Obsidian
    // stylesheet and plugin stylesheet intact. This verifies the reverse boundary.
    sheet = [...doc.styleSheets].find((s) => {
      try {
        return [...s.cssRules].some((r) => r.style?.getPropertyValue('--lumen-docs-theme'));
      } catch {
        return false;
      }
    });
    check('主题独立样式表可定位', !!sheet);
    sheetWasDisabled = sheet.disabled;
    try {
      sheet.disabled = true;
      await tick();
      check(
        '主题停用后无主题标记',
        css(doc.body).getPropertyValue('--lumen-docs-theme').trim() !== '1',
      );
      plugin.openBlock(editor, file, heading, { left: 50, bottom: 120 }, doc);
      check(
        '默认外观下块菜单可用',
        !!doc.querySelector('.flow-popup') &&
          css(doc.querySelector('.flow-popup [aria-label="复制"]')).justifyContent === 'flex-start',
      );
      guard();
      const baseline = expected,
        from = expected.lastIndexOf('我是无序');
      editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(from + 4));
      for (let i = 0; i < 2; i++) {
        const s = cm.state.selection.main,
          change = wrapInline(expected, s.from, s.to, '**');
        expected = expected.slice(0, change.from) + change.insert + expected.slice(change.to);
        plugin.inline(editor, file, 'bold', { from: s.from, to: s.to }, doc);
      }
      check('默认外观下格式切换可用', editor.getValue() === baseline);
    } finally {
      sheet.disabled = sheetWasDisabled;
      plugin.closePopup();
      await tick();
    }
    guard();
    plugin.change(editor, { from: 0, to: expected.length, insert: original });
    expected = original;
    app.commands.executeCommandById('editor:save-file');
    // Runtime-only unload/reload, without changing the user's enabled-plugin list.
    suspended = true;
    await app.plugins.disablePlugin('flow-edit');
    await tick();
    await tick();
    check(
      '编辑插件确已停用',
      !app.plugins.getPlugin('flow-edit') && !cm.dom.classList.contains('flow-editor'),
    );
    check('停用插件后移除类型图标增强', !cm.dom.querySelector('.flow-callout-type-trigger'));
    verifyTheme('（插件关闭）');
    await app.plugins.enablePlugin('flow-edit');
    suspended = false;
    await tick();
    check('编辑插件已恢复', !!app.plugins.getPlugin('flow-edit'));
    check('验收后正文一致', editor.getValue() === original);
    report.theme = 'Lumen Docs';
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    report.stack = error.stack;
  } finally {
    if (sheet && sheetWasDisabled != null) sheet.disabled = sheetWasDisabled;
    if (suspended && !app.plugins.getPlugin('flow-edit')) {
      try {
        await app.plugins.enablePlugin('flow-edit');
      } catch (e) {
        report.restoreError = e.message;
        report.passed = false;
      }
    }
    app.plugins.getPlugin('flow-edit')?.closePopup();
    if (
      editor &&
      original != null &&
      editor.getValue() !== original &&
      (editor.getValue() === expected || knownSnapshots.has(editor.getValue()))
    ) {
      plugin.change(editor, { from: 0, to: editor.getValue().length, insert: original });
      app.commands.executeCommandById('editor:save-file');
    }
    if (editor && original != null) {
      report.documentRestored = editor.getValue() === original;
      report.finalSha256 = sha(editor.getValue());
      if (!report.documentRestored) report.passed = false;
      if (report.documentRestored && selection) editor.setSelection(selection.from, selection.to);
    }
    component?.unload();
    fixtureHost?.remove();
    await app.vault.adapter.write(
      dir + '/verification-' + plugin.manifest.version + '.json',
      JSON.stringify(report, null, 2),
    );
  }
};
