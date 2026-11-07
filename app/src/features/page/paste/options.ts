// Paste Options (ADR 0084): which of Keep source formatting, Merge formatting, and Keep text only a paste uses.
// The choice comes from Settings per source and can change after the paste. Pure: nothing here touches the page.
import { COPY_MARKER, PARA_DATA } from '../../../editor/clipboard/paraData';
import { unwrap } from './dom';
import type { PasteChoice, PasteDefaults } from './types';

/** The id the pipeline gives a paste that came from OpenNote's own copy. */
export const OPENNOTE_SOURCE = 'opennote';

/**
 * Whether a parsed paste is OpenNote's own copy: the first element, or an element wrapped around it by the
 * clipboard, carries both ProseMirror's slice attribute and OpenNote's marker. Read on the parsed tree, so text and
 * attribute values that merely contain those names never count.
 */
export function isOpenNoteCopy(body: HTMLElement): boolean {
  let slice = false;
  let marker = false;
  let at: Element | null = body.firstElementChild;
  for (let depth = 0; at && depth < 8; depth++) {
    slice ||= at.hasAttribute('data-pm-slice');
    marker ||= at.hasAttribute(COPY_MARKER);
    at = at.firstElementChild;
  }
  return slice && marker;
}

/** The choice for a source: the setting of its program, Keep source for OpenNote, and Merge for everything else. */
export function choiceFor(source: string, defaults: PasteDefaults | undefined): PasteChoice {
  if (source === OPENNOTE_SOURCE) return 'keepSource';
  if (!defaults) return 'mergeFormatting';
  const byProgram: Record<string, PasteChoice | undefined> = {
    word: defaults.word,
    gdocs: defaults.docs,
    onenote: defaults.onenote,
    web: defaults.web,
  };
  return byProgram[source] ?? 'mergeFormatting';
}

/** The spans that are run formatting. Math, footnote references, and foreign-language marks are content, not formatting. */
const MARK_SPANS = [
  'data-font',
  'data-size',
  'data-color',
  'data-weight',
  'data-tracking',
  'data-caps',
  'data-shift',
  'lang',
]
  .map((name) => `span[${name}]`)
  .join(', ');

/** Merge formatting for a paste from OpenNote: runs lose fonts, sizes, and colors, and paragraphs their format. */
export function mergeOpenNote(body: HTMLElement): void {
  body.querySelectorAll(`mark, ${MARK_SPANS}`).forEach(unwrap);
  body.querySelectorAll(`[${PARA_DATA}]`).forEach((element) => element.removeAttribute(PARA_DATA));
}
