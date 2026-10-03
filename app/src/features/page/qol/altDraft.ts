// Alt text first draft: the words recognized in an image, offered as a draft the person
// edits. Recognition runs on this device and asks first, through the intelligence feature, so nothing starts on its
// own. Loads when the Alt text dialog's button is pressed.
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import type { ImageHandle } from '../blocks/imageBlock';

const intel = () => import('../../intel').then((module) => module.loadApi());

/** Whether the dialog should offer a draft for this image: the feature and text recognition are both available. */
export function canDraftAlt(handle: ImageHandle): boolean {
  return (
    handle.ctx.host.flag('page.altDraft') && isEnabled('intel.ocr') && typeof handle.block().data.asset === 'string'
  );
}

/** One line of alt text from recognized words: their lines joined, spaces tidied, and cut to `max` characters. */
export function draftFromText(text: string, max: number): string {
  const joined = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  return joined.length <= max ? joined : `${joined.slice(0, max - 1).trimEnd()}…`;
}

/** The words in the image, or null when there are none or the person declined text recognition. */
export async function recognizedText(handle: ImageHandle): Promise<string | null> {
  const asset = handle.block().data.asset;
  if (typeof asset !== 'string') return null;
  const { askToTurnOn, readTextInImage, textOfResult, reportProblem } = await intel();
  if (!(await askToTurnOn('ocr'))) return null;
  let blob: Blob;
  try {
    const response = await fetch(handle.ctx.page.assetUrl(asset));
    if (!response.ok) throw new Error(`The image answered ${response.status}.`);
    blob = await response.blob();
  } catch {
    showToast({ message: t('intel.imageText.noImage'), tone: 'danger' });
    return null;
  }
  announce(t('intel.imageText.working'));
  try {
    const text = textOfResult(await readTextInImage(blob));
    if (!text) {
      showToast({ message: t('intel.imageText.none') });
      return null;
    }
    return text;
  } catch (error) {
    reportProblem(error, 'image');
    return null;
  }
}
