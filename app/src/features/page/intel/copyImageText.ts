// Copy text from image (Phase 12): reads the words in the selected image on this device and copies them. The page's
// own parts stay on this side; the recognizer, the offer to turn text recognition on, and the messages are in
// features/intel. Loads on first use.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { selectedImage } from '../blocks/imageBlock';

const intel = () => import('../../intel').then((module) => module.loadApi());

/** Copies the words recognized in the selected image. */
export async function copyImageText(): Promise<void> {
  const handle = selectedImage();
  const asset = handle?.block().data.asset;
  if (!handle || typeof asset !== 'string') return;
  const { askToTurnOn, readTextInImage, textOfResult, reportProblem } = await intel();
  if (!(await askToTurnOn('ocr'))) return;
  let blob: Blob;
  try {
    const response = await fetch(handle.ctx.page.assetUrl(asset));
    if (!response.ok) throw new Error(`The image answered ${response.status}.`);
    blob = await response.blob();
  } catch {
    showToast({ message: t('intel.imageText.noImage'), tone: 'danger' });
    return;
  }
  announce(t('intel.imageText.working'));
  try {
    const text = textOfResult(await readTextInImage(blob));
    if (!text) {
      showToast({ message: t('intel.imageText.none') });
      return;
    }
    await navigator.clipboard.writeText(text);
    showToast({ message: t('intel.imageText.copied') });
  } catch (error) {
    reportProblem(error, 'image');
  }
}
