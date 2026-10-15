// Saving a mind map as a picture: SVG stays sharp at any size, PNG is for slides and chat, and PDF is for printing.
import { commandContext } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { saveBytes } from '../../study';
import { mapSvg, toPng } from './exportMap';
import type { MapNode } from './tree';
import { toOutline } from './tree';

export type MapFormat = 'svg' | 'png' | 'pdf';

const FILE_TYPES: Record<Exclude<MapFormat, 'pdf'>, string> = { svg: 'image/svg+xml', png: 'image/png' };

/** A file name from the main idea: letters and digits, with words joined by hyphens. */
export function mapFileName(root: MapNode, format: MapFormat): string {
  const stem = root.text
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${stem || t('study.mindmap.fileStem')}.${format}`;
}

/** Saves the map. Says what happened in a message, and never throws. */
export async function saveMap(root: MapNode, format: MapFormat): Promise<void> {
  const title = root.text.trim() || t('study.mindmap.mainIdea');
  const name = mapFileName(root, format);
  try {
    const picture = mapSvg(root, title);
    let saved: boolean;
    if (format === 'pdf') {
      const { exportPictureAsPdf } = await import('../../pages');
      const outcome = await exportPictureAsPdf(
        commandContext('menu').platform.exports,
        title,
        toOutline(root),
        picture.svg,
      );
      saved = outcome.status === 'saved';
    } else {
      const bytes = format === 'png' ? await toPng(picture) : new TextEncoder().encode(picture.svg);
      saved = await saveBytes(name, t(`study.mindmap.${format}Label`), bytes, FILE_TYPES[format]);
    }
    if (saved) {
      const message = t('study.mindmap.saved', { name });
      showToast({ message });
      announce(message);
    }
  } catch {
    showToast({ message: t('study.mindmap.saveFailed'), tone: 'danger' });
  }
}
