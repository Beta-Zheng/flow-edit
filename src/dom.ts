/** A document's own window is essential when a note lives in a pop-out window. */
export type AppWindow = NonNullable<Document['defaultView']>;
export function windowFor(doc: Document): AppWindow {
  const win = doc.defaultView;
  if (!win) throw new Error('文档窗口已关闭');
  return win;
}

export function eventElement(target: EventTarget | null): Element | null {
  return target &&
    'nodeType' in target &&
    target.nodeType === 1 &&
    'closest' in target &&
    typeof target.closest === 'function'
    ? (target as Element)
    : null;
}

export function errorMessage(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
    ? error.message
    : '操作失败';
}
