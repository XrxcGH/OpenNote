// What the print and export commands do once they load: open the print dialog, or save a Markdown or web page file.
import type { CommandContext } from '../../../commands/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { exportHtmlFile, exportMarkdownFile } from '../host/exporter';
import { collectSource } from '../host/source';
import { openDialog } from './openDialog';
import { PrintDialog } from './PrintDialog';

/** Opens the print dialog for the shown page. */
export async function printPage(ctx: CommandContext, mode: 'print' | 'export'): Promise<void> {
  const source = await collectSource(ctx.notes);
  if (!source) {
    showToast({ message: t('pageViews.files.nothing') });
    return;
  }
  await openDialog((close) => <PrintDialog source={source} platform={ctx.platform} mode={mode} close={close} />);
}

/** Saves the shown page as a Markdown file or as a web page. */
export async function exportText(ctx: CommandContext, kind: 'markdown' | 'html'): Promise<void> {
  const source = await collectSource(ctx.notes);
  if (!source) {
    showToast({ message: t('pageViews.files.nothing') });
    return;
  }
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
