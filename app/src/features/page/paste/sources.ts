// The paste sources OpenNote knows (Phase 4 ARCHITECTURE.md section 15.3), as entries of the `pasteSources`
// registry, so later phases add their own beside them. They register when the pipeline first loads, which keeps
// the normalizers out of the start-up bundle. The source with the highest confidence normalizes the paste.
import type { PasteInput as RegistryInput, PasteSourceDef } from '../registries';
import { pasteSources } from '../registries';
import { classifyHtml } from './classify';
import { mapColors } from './normalize/colors';
import { dropFormattingAttributes, dropUnwanted } from './normalize/common';
import { normalizeGoogleDocs } from './normalize/gdocs';
import { normalizeOneNote } from './normalize/onenote';
import { normalizeWeb } from './normalize/web';
import { normalizeWord } from './normalize/word';
import { looksLikeMarkdown } from '../../../editor/markdown/paste';

/** The classifier's answer for the HTML, as a confidence for one source. */
const classified = (id: string) => (input: RegistryInput) => (input.html && classifyHtml(input.html) === id ? 0.9 : 0);

export const BUILT_IN_SOURCES: readonly PasteSourceDef[] = [
  {
    id: 'gdocs',
    order: 10,
    detect: classified('gdocs'),
    normalize: (doc) => normalizeGoogleDocs(doc.body),
  },
  {
    id: 'onenote',
    order: 20,
    // OneNote's own clipboard formats settle it when the facts belong to this paste.
    detect: (input) => (input.facts?.hasOneNote && input.html ? 1 : classified('onenote')(input)),
    normalize: (doc) => normalizeOneNote(doc.body),
  },
  {
    id: 'excel',
    order: 30,
    detect: classified('excel'),
    normalize(doc) {
      dropUnwanted(doc.body);
      mapColors(doc.body);
      dropFormattingAttributes(doc.body);
    },
  },
  {
    id: 'word',
    order: 40,
    detect: classified('word'),
    normalize: (doc) => normalizeWord(doc.body),
  },
  {
    id: 'vscode',
    order: 50,
    detect: classified('vscode'),
    // The pipeline reads the plain text instead.
    normalize: () => undefined,
  },
  {
    id: 'web',
    order: 90,
    detect: (input) => (input.html ? 0.1 : 0),
    normalize: (doc, input) => normalizeWeb(doc.body, { sourceUrl: input.facts?.sourceUrl ?? null }),
  },
  {
    id: 'markdown',
    order: 100,
    detect: (input) => (!input.html && input.text && looksLikeMarkdown(input.text) ? 0.5 : 0),
    normalize: () => undefined,
  },
  {
    id: 'plain',
    order: 110,
    detect: (input) => (!input.html && input.text ? 0.1 : 0),
    normalize: () => undefined,
  },
];

let registered = false;

/** Registers the built-in sources once. */
export function ensureBuiltInSources(): void {
  if (registered) return;
  registered = true;
  for (const source of BUILT_IN_SOURCES) if (!pasteSources.get(source.id)) pasteSources.register(source);
}

/** The source that is surest of this paste; ties go to the lower order. */
export function detectSource(input: RegistryInput, doc: Document | null): PasteSourceDef | null {
  ensureBuiltInSources();
  let best: { def: PasteSourceDef; score: number } | null = null;
  for (const def of [...pasteSources.list()].sort((a, b) => a.order - b.order)) {
    const score = def.detect(input, doc);
    if (score > 0 && (!best || score > best.score)) best = { def, score };
  }
  return best?.def ?? null;
}
