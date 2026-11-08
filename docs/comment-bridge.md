# Optional comment integration

Flow Edit no longer discovers another plugin through private `app.plugins` or executes private `app.commands`. An integration offers a provider through the public Workspace event API.

Each time a comment action is needed, Flow Edit synchronously triggers:

```js
workspace.trigger('flow-edit:resolve-comment-provider', request);
```

`request` initially has `{ provider: null }`. A companion plugin may set `provider.addComment` to a function accepting `{ editor, file, range }`. `range` contains absolute Markdown `from`/`to` offsets. The function can return `void` or a Promise. Flow Edit preserves/selects the relevant text before calling it, and handles action errors through its normal error/notice path. The provider should recheck the document if it defers a write.

Example in a companion plugin's `onload()`:

```js
this.registerEvent(
  this.app.workspace.on('flow-edit:resolve-comment-provider', (request) => {
    request.provider = {
      addComment: ({ editor, file, range }) => this.addCommentForRange(editor, file, range),
    };
  }),
);
```

The companion owns `addCommentForRange`; it must implement the actual comment UI and storage. Registering with `registerEvent` removes the listener when the companion unloads. Flow Edit does not retain the provider, so the comment entry disappears on the next UI refresh after the companion unloads. If several integrations answer, the last provider assigned is used.

Existing versions of `feishu-comments` that only expose a command need to adopt this protocol. Installing that plugin alone no longer enables the comment entry. No companion plugin is required for Flow Edit's core editing features.
