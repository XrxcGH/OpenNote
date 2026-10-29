// When a model download last started, for the Privacy panel's list of network use. It loads the models code only when
// the panel shows, so the panel adds nothing to start-up.
import { useEffect, useState } from 'react';

/** An ISO time, or null when no model has been downloaded on this device. */
export function useModelDownloadsLastRan(): string | null {
  const [iso, setIso] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void import('./store')
      .then((store) => store.refreshModels())
      .then((list) => {
        if (current) setIso(list?.lastRanUnix ? new Date(list.lastRanUnix * 1000).toISOString() : null);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return iso;
}
