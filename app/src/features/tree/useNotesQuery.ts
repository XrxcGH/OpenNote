// A small loader for WP0's placeholder panes: runs a notes query and re-runs it when its key changes.
// WP6 replaces it with the tree store.

import { useEffect, useState } from 'react';
import { useNotes } from '../../services/notes';
import type { NotesService } from '../../services/notes';

export function useNotesQuery<T>(key: string | null, query: (notes: NotesService) => Promise<T>): T | null {
  const notes = useNotes();
  const [result, setResult] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let current = true;
    query(notes)
      .then((value) => current && setResult({ key, value }))
      .catch(() => current && setResult(null));
    return () => {
      current = false;
    };
    // The key names the query, so a new function for the same key doesn't run it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, notes]);
  return key !== null && result?.key === key ? result.value : null;
}
