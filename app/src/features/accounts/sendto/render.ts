// Making the file that is sent, in the transfer folder: a PDF or a picture of the page, a Word file of the page, section,
// or notebook (the same export that Export makes), or a Word file of the lasso's selection. Nothing leaves the PC here.
import { commandContext } from '../../../commands/registry';
import type { NodeId } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { collectRequest, pageCount, resolveTarget } from '../../interop';
import { renderShownPage } from '../../pages';
import type { AccountsHost } from '../host';
import { bytesPart } from '../host';
import { DOCX } from './types';
import type { LocalFile, SendFormat, SendScope } from './types';

/** A file name made from a title. */
export function fileNameOf(title: string, extension: string): string {
  const base = title
    .replace(/[^\p{L}\p{N} _.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return `${base || t('accounts.sendTo.untitled')}.${extension}`;
}

/** The width and height in a PNG's header, or zeros. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24) return { width: 0, height: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function stage(host: AccountsHost, name: string, bytes: Uint8Array, mime: string): Promise<LocalFile> {
  await host.tempWrite(name, bytesPart(bytes));
  return { file: name, name, mime };
}

/**
 * The file for what is sent. `node` is the page, section, or notebook; null for the lasso's selection. Answers null when
 * there is nothing to send (an empty section).
 */
export async function prepare(
  host: AccountsHost,
  scope: SendScope,
  format: SendFormat,
  node: NodeId | null,
  title: string,
): Promise<LocalFile | null> {
  const context = commandContext('palette');
  if (scope === 'selection') {
    const picture = await renderShownPage(context, 'png', true);
    if (!picture) return null;
    if (format === 'png') return stage(host, picture.name, picture.bytes, picture.mime);
    const word = await context.platform.exports.selectionDocx(picture.bytes, {
      title,
      alt: title,
      ...pngSize(picture.bytes),
    });
    return stage(host, fileNameOf(title, 'docx'), word, DOCX);
  }
  if (scope === 'page' && format === 'pdf') {
    const pdf = await renderShownPage(context, 'pdf');
    return pdf ? stage(host, pdf.name, pdf.bytes, pdf.mime) : null;
  }
  if (!node) return null;
  const target = await resolveTarget(context.notes, node);
  if (!target) return null;
  const request = await collectRequest(context.notes, target, scope);
  if (pageCount(request) === 0) return null;
  const folder = await host.tempDir();
  const outcome = await context.platform.interop.exportTo(`send-${Date.now()}`, { ...request, format: 'docx', folder });
  if (outcome.status !== 'done') return null;
  const path = outcome.result.reveal;
  return { file: path, name: fileNameOf(title, 'docx'), mime: DOCX };
}
