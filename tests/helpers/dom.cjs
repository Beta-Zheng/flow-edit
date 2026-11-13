'use strict';
const { JSDOM: NativeJSDOM } = require('jsdom');
// Match the public Obsidian DOM helper while retaining real DOM objects/events.
class JSDOM extends NativeJSDOM {
  constructor(...args) {
    super(...args);
    this.window.createEl = (tag) => this.window.document.createElement(tag);
  }
}
module.exports = { JSDOM };
