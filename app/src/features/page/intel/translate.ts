// Translate on this device (A3-25): a selection, the page, or a transcript, translated beside the original. The
// translation is a new block below what was translated, so the original is never changed, and Undo takes it away.
// Loads on first use.
import { newId } from '../../../editor/ids';
import { escapeParagraphText } from '../../../editor/markdown';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { dataOf, fallbackOf, transcriptBlocks } from '../audio/transcripts/store';
import { targetEditor } from '../formattingBar/target';
import { shownMedia } from '../images/shown';
import { shownLayer } from '../mount';

const MAX_CHARS = 200_000;

interface Gathered {
  scope: 'selection' | 'page' | 'transcript';
  markdown: string;
  from: string | null;
}

/** What can be translated here: the selected text, the page's text, and its transcripts. */
export function gather(): Gathered[] {
  const found: Gathered[] = [];
  const editor = targetEditor();
  if (editor && !editor.state.selection.empty) {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, '\n', ' ').trim();
    if (text) found.push({ scope: 'selection', markdown: text.slice(0, MAX_CHARS), from: null });
  }
  const mounted = shownMedia.get();
  const page = (shownLayer.get()?.blocks() ?? mounted?.layer.blocks() ?? [])
    .flatMap((block) => (block.type === 'text' && typeof block.data.markdown === 'string' ? [block.data.markdown] : []))
    .join('\n\n')
    .trim();
  if (page) found.push({ scope: 'page', markdown: page.slice(0, MAX_CHARS), from: null });
  const speech = transcriptBlocks().flatMap((block) => {
    const data = dataOf(block);
    return data ? [{ text: fallbackOf(data).markdown, language: data.language }] : [];
  });
  if (speech.length > 0) {
    found.push({
      scope: 'transcript',
      markdown: speech
        .map((one) => one.text)
        .join('\n\n')
        .slice(0, MAX_CHARS),
      from: speech[0]?.language ?? null,
    });
  }
  return found;
}

/** Puts the shell's language-pack engine in place when the build can translate and nothing else is installed. */
async function ensureEngine(dialog: typeof import('../../translate')): Promise<void> {
  if (dialog.translationEngine()) return;
  const { intelExt } = await import('../../intel').then((module) => module.loadApi());
  if (await dialog.canTranslate(intelExt)) dialog.useTranslationEngine(dialog.createLocalTranslationEngine(intelExt));
}

/** Opens the Translate dialog for what is on the page, and adds the translation below the original. */
export async function translateHere(): Promise<void> {
  const sources = gather();
  if (sources.length === 0) {
    showToast({ message: t('intelMore.translate.nothing') });
    return;
  }
  const dialog = await import('../../translate');
  await ensureEngine(dialog);
  dialog.openTranslate(sources, (result) => {
    if (!result) return;
    void place(result.markdown, result.language, result.kept);
  });
}

async function place(markdown: string, language: string, kept: number): Promise<void> {
  const dialog = await import('../../translate');
  const mounted = shownMedia.get();
  if (!mounted) return;
  const blocks = [...mounted.viewport.world.querySelectorAll<HTMLElement>('[data-block-id]')];
  const after = blocks.filter((one) => !one.parentElement?.closest('[data-block-id]')).at(-1)?.dataset.blockId;
  const heading = escapeParagraphText(t('intelMore.translate.heading', { language: dialog.nameOf(language) }));
  const block = { id: newId(), type: 'text', data: { markdown: `*${heading}*\n\n${markdown}` } };
  await mounted.sync.send({ edits: [{ edit: 'insertBlock', block, ...(after ? { after } : {}) }] });
  showToast({
    message: kept > 0 ? t('intelMore.translate.kept', { count: kept }) : t('intelMore.translate.done'),
    action: { label: t('intelMore.translate.undo'), run: () => mounted.sync.undo() },
  });
}
