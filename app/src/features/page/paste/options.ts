// Paste Options (ADR 0084): which of Keep source formatting, Merge formatting, and Keep text only a paste uses.
// The choice comes from Settings per source and can change after the paste. Pure: nothing here touches the page.
import { PARA_DATA } from '../../../editor/clipboard/paraData';
import { unwrap } from './dom';
import type { PasteChoice, PasteDefaults } from './types';

/** The id the pipeline gives a paste that came from OpenNote's own copy. */
export const OPENNOTE_SOURCE = 'opennote';

/** ProseMirror writes this attribute on the first element of every copy from an editor, OpenNote's included. */
export const isOpenNoteHtml = (html: string): boolean => /\sdata-pm-slice\s*=/.test(html);

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

/** Merge formatting for a paste from OpenNote: runs lose fonts, sizes, and colors, and paragraphs their format. */
export function mergeOpenNote(body: HTMLElement): void {
  body.querySelectorAll('span, mark').forEach(unwrap);
  body.querySelectorAll(`[${PARA_DATA}]`).forEach((element) => element.removeAttribute(PARA_DATA));
}
