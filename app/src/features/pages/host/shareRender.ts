// A rendering of the shown page for another feature to send somewhere: a PDF through the hidden print window, or a PNG
// of the page or of the lasso's selection. Nothing is saved or shown; the bytes go back to the caller. The account
// features (share to Slack, send to Drive, submit to a course) use it.
import type { CommandContext } from '../../../commands/types';
import { t } from '../../../strings/t';
import { exportFileName, exportPdf } from '../pdf';
import { createPrintSurface, newJobId, prepareInput } from './exporter';
import { hasChosen } from './chosen';
import { makePicture, selectionFor, svgToPng } from './picture';
import { collectSource } from './source';
import { pageSelection } from '../../page';

export interface RenderedPage {
  /** A file name with the right extension, made from the page title. */
  name: string;
  mime: string;
  bytes: Uint8Array;
  title: string;
}

export type RenderKind = 'pdf' | 'png';

/** The shown page, or the lasso's selection when `selection` is set and something is picked, rendered as a file. */
export async function renderShownPage(
  ctx: Pick<CommandContext, 'notes' | 'platform'>,
  kind: RenderKind,
  selection = false,
): Promise<RenderedPage | null> {
  const source = await collectSource(ctx.notes);
  if (!source) return null;
  const title = source.title || t('pageViews.print.untitled');
  if (kind === 'pdf') {
    const result = await exportPdf(createPrintSurface(ctx.platform.exports, newJobId()), {
      input: prepareInput(source, {}),
      tagged: false,
      outline: false,
    });
    return { name: exportFileName(title, 'pdf'), mime: 'application/pdf', bytes: result.bytes, title };
  }
  const scope = selection && hasChosen() ? 'selection' : 'page';
  const area = selectionFor(source, scope, pageSelection.get());
  if (!area) return null;
  const picture = await makePicture(source, area, title);
  let blob: Blob;
  try {
    blob = await svgToPng(picture, 2);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    blob = await svgToPng(picture, 1);
  }
  return {
    name: exportFileName(title, 'png'),
    mime: 'image/png',
    bytes: new Uint8Array(await blob.arrayBuffer()),
    title,
  };
}
