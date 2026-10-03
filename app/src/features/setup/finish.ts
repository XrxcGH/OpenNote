// Finishing setup (ARCHITECTURE.md section 17.6). In order: each step commits its choices (settings first, then
// the notes folder and the first notebook), both scopes record the steps as done, and the first page opens. If
// the person chose the Start menu, the app then moves itself, and the new process lands on the same page. A
// failure before the record leaves the app where it was, with the draft kept, so the person can try again.

import { navigate } from '../../app/location';
import type { Location } from '../../app/location';
import type { SetupDraft, SetupStepDef } from '../../registries';
import { updateSettings } from '../../state/settings';
import { DEFAULT_LOCATION } from '../../state/session';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { OPEN_AFTER_SETUP, completedBy, withCompleted } from './model';
import { getHost, saveDone, setupContext, setupStore } from './runtime';

const openAfter = (draft: SetupDraft): Location =>
  (draft[OPEN_AFTER_SETUP] as Location | undefined) ?? DEFAULT_LOCATION;

/** Commits every step, records the run as done, and opens the first page. Rejects when a step can't commit. */
export async function finishSetup(steps: readonly SetupStepDef[], draft: SetupDraft): Promise<void> {
  const { platform } = getHost();
  const ctx = setupContext();
  const work: SetupDraft = { ...draft };
  for (const step of steps) await step.commit(ctx, work);
  await updateSettings({
    setup: { completedSteps: withCompleted(ctx.settings.setup.completedSteps, completedBy(steps, 'person')) },
  });
  const { record } = setupStore.get();
  saveDone(withCompleted(record.completedSteps, completedBy(steps, 'device')));
  await platform.state.flush();
  navigate(openAfter(work), { replace: true });
  if (work.storage?.moveApp)
    await platform.install
      .moveToUserPrograms()
      .catch(() => showToast({ message: t('setup.errors.move'), tone: 'danger' }));
}
