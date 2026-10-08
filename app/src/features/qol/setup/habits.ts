// The setup step for shortcut sets: what the draft holds and what the commit saves.

import type { KeymapPresetId } from '../../../platform/types';
import type { SetupContext, SetupDraft } from '../../../registries';
import { setShortcutSet } from '../../../state/keymap';

/** The shortcut set the draft chose, else the one in use. */
export function shortcutSet(draft: SetupDraft, current: KeymapPresetId = 'default'): KeymapPresetId {
  const chosen = (draft.habits as { preset?: KeymapPresetId } | undefined)?.preset;
  return chosen === 'onenote' || chosen === 'default' ? chosen : current;
}

export async function commitHabits(ctx: SetupContext, draft: SetupDraft): Promise<void> {
  const chosen = (draft.habits as { preset?: KeymapPresetId } | undefined)?.preset;
  if (chosen && chosen !== ctx.settings.keymap.preset) await setShortcutSet(chosen);
}
