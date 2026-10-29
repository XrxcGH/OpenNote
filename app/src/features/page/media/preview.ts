// The title and picture of a link, read once when the block is made so the block can show them offline. The host reads
// them from a short list of public hosts with no token (accounts_call fetch.preview); Work offline refuses it, and
// anything that goes wrong just leaves the block with its link and no picture.
import type { AccountsHost } from '../../accounts';
import type { Recognized } from './recognize';

export interface Preview {
  title?: string;
  picture?: { bytes: Uint8Array; mime: string; name: string };
}

const TITLE_MAX = 200;

const IMAGE = /^image\/(png|jpeg|webp|gif)$/;
const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

async function readJson(host: AccountsHost, url: string): Promise<Record<string, unknown> | null> {
  const answer = await host.fetchPreview(url);
  if (answer.status !== 200) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(answer.bytes));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The preview of a recognized link. Never throws. */
export async function loadPreview(host: AccountsHost, found: Recognized): Promise<Preview> {
  const preview: Preview = {};
  let pictureUrl = found.pictureUrl;
  try {
    if (found.previewUrl) {
      const info = await readJson(host, found.previewUrl);
      if (typeof info?.title === 'string' && info.title.trim() !== '') {
        preview.title = info.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
      }
      if (typeof info?.thumbnail_url === 'string') pictureUrl = info.thumbnail_url;
    }
  } catch {
    // Offline, or the site said no: the block keeps its link.
  }
  try {
    if (pictureUrl) {
      const answer = await host.fetchPreview(pictureUrl);
      const mime = (answer.contentType ?? '').split(';')[0]?.trim() ?? '';
      if (answer.status === 200 && IMAGE.test(mime) && answer.bytes.length > 0) {
        preview.picture = {
          bytes: answer.bytes,
          mime,
          name: `${found.provider}-${found.id.replace(/\W+/g, '')}.${EXTENSION[mime]}`,
        };
      }
    }
  } catch {
    // No picture; the card shows the name of the site instead.
  }
  return preview;
}
