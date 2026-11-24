// Copy and paste of lassoed ink (walk 9, T1-D03-5). Ctrl+C on a lasso selection puts its strokes on the clipboard in
// OpenNote's own format, with their colors, widths, and tools. Ctrl+V on any page adds them back where they were, and
// a little lower and to the right when the same strokes are still on that page. Typed text keeps its own copy and
// paste: a press in a text field, or a text selection, is left alone.
import { newId } from '../../../editor/ids';
import { bakeTransform } from '../geometry/transform';
import type { InkStroke } from '../model/types';
import type { InkHost } from './host';
import type { InkSurface } from './surface';

/** The clipboard type of copied ink: a JSON list of strokes. */
export const INK_CLIPBOARD_TYPE = 'application/x-opennote-ink';
/** How far, in page units, a paste onto the page it came from moves the copy, so it does not hide the original. */
export const PASTE_NUDGE = 16;

type Copied = Omit<InkStroke, 'id' | 'block'> & { id: string };

/** Whether the person is copying or pasting text, which ink leaves to the text. */
function inText(event: ClipboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea')) return true;
  const selection = target?.ownerDocument.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== '';
}

/** The strokes as clipboard text: each drawn where it shows, so a copy needs no transform. */
export function inkToClipboard(strokes: readonly InkStroke[]): string {
  const copied: Copied[] = strokes.map((stroke) => {
    const { block: _block, ...rest } = bakeTransform(stroke);
    return rest;
  });
  return JSON.stringify(copied);
}

/** The copied strokes in clipboard text, or null when it is not copied ink. */
export function readCopied(text: string): Copied[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const valid = (item: Partial<Copied> | null) =>
    !!item && Array.isArray(item.points) && typeof item.width === 'number' && !!item.color;
  return (parsed as (Partial<Copied> | null)[]).every(valid) ? (parsed as Copied[]) : null;
}

/** Copied strokes as new strokes in `block`, moved `nudge` page units down and to the right. */
export function pastedStrokes(copied: readonly Copied[], block: string, nudge: number): InkStroke[] {
  return copied.map((item) => ({
    ...item,
    id: newId(),
    block,
    points: item.points.map((p) => ({ ...p, x: p.x + nudge, y: p.y + nudge })),
  }));
}

/** Listens for copy and paste on the page while the ink layer is installed. */
export function installInkClipboard(host: InkHost, surface: () => InkSurface | null, doc = document): () => void {
  const onCopy = (event: ClipboardEvent) => {
    const current = surface();
    const ids = host.selection.get().strokes;
    if (!current || ids.length === 0 || !event.clipboardData || inText(event)) return;
    const strokes = current.strokes(ids);
    if (strokes.length === 0) return;
    event.clipboardData.setData(INK_CLIPBOARD_TYPE, inkToClipboard(strokes));
    event.preventDefault();
  };
  const onPaste = (event: ClipboardEvent) => {
    const current = surface();
    const text = event.clipboardData?.getData(INK_CLIPBOARD_TYPE) ?? '';
    if (!current || current.readOnly || text === '' || inText(event)) return;
    const copied = readCopied(text);
    if (!copied) return;
    const here = current.strokes(copied.map((item) => item.id)).length > 0;
    const strokes = pastedStrokes(copied, current.layerFor(), here ? PASTE_NUDGE : 0);
    event.preventDefault();
    event.stopImmediatePropagation();
    void current.add(strokes).then((ok) => {
      if (ok) host.select({ strokes: strokes.map((stroke) => stroke.id), blocks: [] });
    });
  };
  doc.addEventListener('copy', onCopy, { capture: true });
  doc.addEventListener('paste', onPaste, { capture: true });
  return () => {
    doc.removeEventListener('copy', onCopy, { capture: true });
    doc.removeEventListener('paste', onPaste, { capture: true });
  };
}
