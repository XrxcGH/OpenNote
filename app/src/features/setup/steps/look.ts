// Step 2's commit. The theme is saved when a card is chosen, so this makes sure the last choice is in settings.json.

import type { SetupContext, SetupDraft } from '../../../registries';
import { updateSettings } from '../../../state/settings';

export async function commitLook(_ctx: SetupContext, draft: SetupDraft): Promise<void> {
  const theme = draft.look?.theme;
  if (theme) await updateSettings({ appearance: { theme } });
}
