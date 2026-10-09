// Finishing the smart features step: saves the chosen features, and starts the chosen speech model's download. Not now
// does nothing. A failed save is shown and does not stop setup, because every feature can be turned on in Settings.
import type { SetupContext, SetupDraft } from '../../../registries';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { setFeature } from '../runtime';
import { chooseSpeechModel, startModel } from '../models/store';
import { isEnabled } from '../../../app/flags';
import { loadCloud, usesCloud } from '../cloud/store';
import { CHOOSABLE, featuresOn, speechModelToDownload } from './choices';
import type { SmartDraft } from './choices';

export function smartDraftOf(draft: SetupDraft): SmartDraft | null {
  const smart = draft['smart'];
  return typeof smart === 'object' && smart !== null ? (smart as SmartDraft) : null;
}

export async function commitSmartFeatures(_ctx: SetupContext, draft: SetupDraft): Promise<void> {
  const smart = smartDraftOf(draft);
  if (!smart || smart.mode === 'notNow') return;
  const on = new Set(featuresOn(smart));
  let failed = false;
  for (const feature of CHOOSABLE) {
    if (!on.has(feature)) continue;
    try {
      await setFeature(feature, true);
    } catch {
      failed = true;
    }
  }
  // Transcription with the person's own cloud key needs no model on this device.
  const cloud = isEnabled('intel.cloudKeys') ? await loadCloud().catch(() => null) : null;
  const model = cloud && usesCloud('transcription', cloud) ? null : speechModelToDownload(smart);
  if (model) {
    try {
      await chooseSpeechModel(model);
    } catch {
      failed = true;
    }
    // The person saw the size and chose this model, so it starts without another question. A refusal is shown.
    void startModel(model);
  }
  if (failed) showToast({ message: t('intel.settings.status.saveFailed'), tone: 'danger' });
}
