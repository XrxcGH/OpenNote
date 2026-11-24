// The notes folder in use: the one chosen in settings, else the default folder the app opens when none is chosen
// (walk 9, T1-D05-7). Settings > General and Settings > Storage both show it.

import { useEffect, useState } from 'react';
import { useSettings } from '../../state/settings';
import { host } from './host';

/** The folder the notebooks open from, or null while the default is still being read. */
export function useNotesFolderInUse(): string | null {
  const chosen = useSettings((settings) => settings.storage.notesFolder);
  const [fallback, setFallback] = useState<string | null>(null);
  useEffect(() => {
    if (chosen) return;
    let current = true;
    void host()
      .install.status()
      .then((status) => current && setFallback(status.proposedNotesFolder || null))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [chosen]);
  return chosen || fallback;
}
