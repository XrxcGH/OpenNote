// Select the page title (the OneNote set's Ctrl+Shift+T): focus the shown page's title and select its text, so
// typing renames the page. The title band marks its heading with data-page-title (features/page/title).

/** Focuses the shown page's title with its text selected. Returns false when no page title is on screen. */
export function selectPageTitle(doc: Document = document): boolean {
  const box = doc.querySelector<HTMLElement>('[data-page-title] [role="textbox"]');
  if (!box) return false;
  box.focus({ preventScroll: false });
  const range = doc.createRange();
  range.selectNodeContents(box);
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}
