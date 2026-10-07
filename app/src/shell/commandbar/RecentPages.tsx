// The recent pages in the compact bottom bar's More panel (docs/FEATURES.md, "Compact layout"). It lists the last few
// pages opened, newest first, read from the session's recent list. It shows nothing when there are none, and has no
// counters or prompts.

import { useEffect, useState } from 'react';
import { navigate } from '../../app/location';
import { locationOf, nodeIndex } from '../../features/palette';
import type { NodeEntry } from '../../features/palette';
import { useNotes } from '../../services/notes';
import { sessionStore } from '../../state/session';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import styles from './CommandBar.module.css';

/** How many recent pages the panel lists. */
export const RECENT_SHOWN = 4;

function useEntries(): readonly NodeEntry[] {
  const notes = useNotes();
  const [entries, setEntries] = useState<readonly NodeEntry[]>([]);
  useEffect(() => {
    let current = true;
    const load = () =>
      void nodeIndex(notes).then(
        (list) => current && setEntries(list),
        () => undefined,
      );
    load();
    const stop = notes.watch(() => setTimeout(load, 0));
    return () => {
      current = false;
      stop();
    };
  }, [notes]);
  return entries;
}

export function RecentPages({ onDone }: { onDone(): void }) {
  const entries = useEntries();
  const ids = useStore(sessionStore, (state) => state.recentPages);
  const byId = new Map(entries.map((entry) => [entry.node.id as string, entry]));
  const recent = ids
    .map((id) => byId.get(id))
    .filter((entry): entry is NodeEntry => entry !== undefined && entry.node.kind === 'page' && !entry.node.archived)
    .slice(0, RECENT_SHOWN);
  if (recent.length === 0) return null;
  const heading = t('commands.bar.recent');
  return (
    <li>
      <ul className={styles.moreList} aria-label={heading}>
        <li className={styles.moreHeading} aria-hidden>
          {heading}
        </li>
        {recent.map((entry) => (
          <li key={entry.node.id}>
            <button
              type="button"
              className={styles.moreItem}
              onClick={() => {
                onDone();
                navigate(locationOf(entry));
              }}
            >
              {entry.node.title.trim() || t('tree.untitled.page')}
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}
