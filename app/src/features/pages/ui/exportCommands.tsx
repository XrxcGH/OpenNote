// What the print and export commands do once they load: open the print dialog, or save a Markdown or web page file.
import type { CommandContext } from '../../../commands/types';
import { t } from '../../../strings/t';
import { isEnabled } from '../../../app/flags';
import { confirm, showToast } from '../../../ui';
import { checkBeforeOutput, reviewPages } from '../../a11yCheck';
import { exportHtmlFile, exportMarkdownFile } from '../host/exporter';
import { collectSource, type PageSource } from '../host/source';
import { openDialog } from './openDialog';
import { PrintDialog } from './PrintDialog';

/** Offers to turn study tape into blanks with an answer key, when the page has tape. Returns the source to export. */
async function withTapeChoice(source: PageSource): Promise<PageSource> {
  // Where the print dialog's own switch turns tape into blanks (study.tapeBlanks, read in host/source.ts), it decides,
  // so the page is never asked about twice.
  if (!isEnabled('study.tape') || isEnabled('study.tapeBlanks')) return source;
  const study = await import('../../study');
  const tapes = study.tapeIds(source.page);
  if (tapes.length === 0) return source;
  const yes = await confirm({
    title: t('study.tape.exportTitle'),
    body: t('study.tape.exportBody'),
    confirmLabel: t('study.tape.exportConfirm'),
    cancelLabel: t('study.tape.exportKeep'),
  });
  if (!yes) return source;
  const { covered, order } = study.measureTape(document, tapes);
  const labels = {
    answerKey: t('study.tape.answerKey'),
    picture: t('study.tape.keyPicture'),
    handwriting: t('study.tape.keyHandwriting'),
    table: t('study.tape.keyTable'),
    attachment: t('study.tape.keyAttachment'),
    covered: t('study.tape.covered'),
  };
  return { ...source, page: study.blankTape(source.page, covered, labels, order) };
}

/** Opens the print dialog for the shown page. */
export async function printPage(ctx: CommandContext, mode: 'print' | 'export'): Promise<void> {
  const found = await collectSource(ctx.notes);
  if (!found) {
    showToast({ message: t('pageViews.files.nothing') });
    return;
  }
  const source = await withTapeChoice(found);
  await openDialog((close) => <PrintDialog source={source} platform={ctx.platform} mode={mode} close={close} />);
}

/** Saves the shown page as a Markdown file or as a web page. */
export async function exportText(ctx: CommandContext, kind: 'markdown' | 'html'): Promise<void> {
  const found = await collectSource(ctx.notes);
  if (!found) {
    showToast({ message: t('pageViews.files.nothing') });
    return;
  }
  if (!(await checkBeforeOutput([found.pageId], () => reviewPages([found.pageId])))) return;
  const source = await withTapeChoice(found);
  try {
    const client = ctx.platform.exports;
    const outcome = await (kind === 'markdown' ? exportMarkdownFile(client, source) : exportHtmlFile(client, source));
    if (outcome.status === 'canceled') return;
    showToast({
      message: t('pageViews.files.saved', { name: outcome.name }),
      action: { label: t('pageViews.print.openFile'), run: () => client.open(outcome.path, true) },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    ctx.platform.log('error', `Export failed: ${String(error)}`);
    showToast({
      message: t(code === 'notImplemented' ? 'pageViews.files.unavailable' : 'pageViews.files.failed'),
      tone: 'danger',
    });
  }
}
