// A vector picture, such as a mind map, as a one-document PDF. The picture goes into a page as a diagram block
// that already has its drawing, and the page goes through the same print window as any page.
import type { ExportsClient } from '../../../platform/types';
import { readExportPage } from '../export';
import { exportPdfFile } from './exporter';
import type { PdfOutcome } from './exporter';
import type { PageSource } from './source';

export function exportPictureAsPdf(
  client: ExportsClient,
  title: string,
  description: string,
  svg: string,
): Promise<PdfOutcome> {
  const read = readExportPage({
    id: 'picture',
    title,
    blocks: [{ id: 'picture', order: 'a', type: 'diagram', data: { source: '', alt: description } }],
  });
  const page = { ...read, blocks: read.blocks.map((block) => (block.type === 'diagram' ? { ...block, svg } : block)) };
  const source: PageSource = { pageId: 'picture', title, notebook: '', section: '', page, assetUrls: {} };
  return exportPdfFile(client, source, { print: { numbering: 'printed' } });
}
