// The Home page (docs/FEATURES.md, "Home page"): recent pages, pinned pages, today's note, saved searches, and the
// Upcoming list, in plain sections the person can reorder or hide. It shows only the person's own notes, with no
// feeds or tips.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { navigate } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import { commands } from '../../registries';
import { useNotes } from '../../services/notes';
import { sessionStore } from '../../state/session';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import { locationOf, nodeIndex } from '../palette';
import type { NodeEntry } from '../palette';
import { readPrefs, writePrefs } from '../qol';
import { openSearchPanel } from '../search';
import type { HomeChoice, HomeSectionId } from './layout';
import { arrange, moved } from './layout';
import styles from './Home.module.css';

const RECENT_SHOWN = 8;

/** The title today's note would have. */
export function todayTitle(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, { dateStyle: 'long' });
}

function PageLinks({ entries, empty }: { entries: readonly NodeEntry[]; empty: string }) {
  if (entries.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <ul className={styles.list}>
      {entries.map((entry) => (
        <li key={entry.node.id}>
          <button type="button" className={styles.link} onClick={() => navigate(locationOf(entry))}>
            <span>{entry.node.title.trim() || t('tree.untitled.page')}</span>
            {entry.path.length > 0 && <span className={styles.path}>{entry.path.join(', ')}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Today({ entries, onStart }: { entries: readonly NodeEntry[]; onStart(): void }) {
  const title = todayTitle();
  const today = entries.find((entry) => entry.node.kind === 'page' && entry.node.title.trim() === title);
  if (today) return <PageLinks entries={[today]} empty="" />;
  return (
    <div className={styles.row}>
      <p className={styles.empty}>{t('qol.home.todayNone', { date: title })}</p>
      <Button onClick={onStart}>{t('qol.home.todayStart')}</Button>
    </div>
  );
}

interface SavedSearch {
  readonly name: string;
  readonly text: string;
}

/** The searches saved in the search panel, which keeps them on this device under this key. */
function loadSaved(): SavedSearch[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('opennote.savedSearches') ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is SavedSearch => typeof item?.name === 'string' && typeof item?.text === 'string')
      : [];
  } catch {
    return [];
  }
}

function Saved() {
  const saved = loadSaved();
  if (saved.length === 0) return <p className={styles.empty}>{t('qol.home.savedNone')}</p>;
  return (
    <ul className={styles.list}>
      {saved.map((search) => (
        <li key={search.name}>
          <button type="button" className={styles.link} onClick={() => openSearchPanel(search.text)}>
            <span>{search.name}</span>
            {search.text && <span className={styles.path}>{search.text}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function useEntries(): NodeEntry[] {
  const notes = useNotes();
  const [entries, setEntries] = useState<NodeEntry[]>([]);
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

async function startToday(entries: readonly NodeEntry[]): Promise<void> {
  const notes = (await import('../../services/notes')).currentNotesService();
  if (!notes) return;
  const section = entries.find((entry) => entry.node.kind === 'section' && !entry.node.archived);
  if (!section) return;
  const page = await notes.create({
    kind: 'page',
    placement: { parentId: section.node.id, beforeId: null },
    title: todayTitle(),
  });
  navigate({ view: 'workspace', notebookId: section.notebookId, sectionId: section.node.id, pageId: page.id });
}

export default function HomeView() {
  const entries = useEntries();
  const recentIds = useStore(sessionStore, (state) => state.recentPages);
  const [choice, setChoice] = useState<HomeChoice | undefined>(undefined);
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => {
    let current = true;
    void readPrefs().then((prefs) => current && setChoice(prefs.home));
    return () => {
      current = false;
    };
  }, []);
  const { shown, hidden } = useMemo(() => arrange(choice), [choice]);
  const save = useCallback((next: HomeChoice) => {
    setChoice(next);
    void writePrefs({ home: next });
  }, []);
  const visible = entries.filter((entry) => !entry.node.archived);
  const byId = new Map(visible.map((entry) => [entry.node.id as string, entry]));
  const recent = recentIds
    .map((id) => byId.get(id))
    .filter((entry): entry is NodeEntry => entry !== undefined && entry.node.kind === 'page')
    .slice(0, RECENT_SHOWN);
  const pinned = visible.filter((entry) => entry.node.kind === 'page' && entry.node.pinned);
  const hasUpcoming = commands.get('smart.tools.openUpcoming') !== undefined;
  const body: Record<HomeSectionId, React.ReactNode> = {
    recent: <PageLinks entries={recent} empty={t('qol.home.recentNone')} />,
    pinned: <PageLinks entries={pinned} empty={t('qol.home.pinnedNone')} />,
    today: <Today entries={visible} onStart={() => void startToday(visible)} />,
    saved: <Saved />,
    upcoming: hasUpcoming ? (
      <Button onClick={() => void executeCommand('smart.tools.openUpcoming', undefined, 'commandBar')}>
        {t('qol.home.upcomingOpen')}
      </Button>
    ) : (
      <p className={styles.empty}>{t('qol.home.upcomingNone')}</p>
    ),
  };
  return (
    <div className={styles.home}>
      <header className={styles.header}>
        <h1 tabIndex={-1}>{t('qol.home.title')}</h1>
        <Button variant="quiet" onClick={() => setCustomizing(!customizing)} aria-pressed={customizing}>
          {t(customizing ? 'qol.home.done' : 'qol.home.customize')}
        </Button>
      </header>
      {shown.map((id, index) => (
        <section key={id} className={styles.section} aria-labelledby={`home-${id}`}>
          <div className={styles.sectionHead}>
            <h2 id={`home-${id}`}>{t(`qol.home.sections.${id}`)}</h2>
            {customizing && (
              <div className={styles.controls}>
                <Button
                  variant="quiet"
                  disabled={index === 0}
                  onClick={() => save({ order: moved(shown, id, -1), hidden })}
                >
                  {t('qol.home.moveUp')}
                </Button>
                <Button
                  variant="quiet"
                  disabled={index === shown.length - 1}
                  onClick={() => save({ order: moved(shown, id, 1), hidden })}
                >
                  {t('qol.home.moveDown')}
                </Button>
                <Button variant="quiet" onClick={() => save({ order: shown, hidden: [...hidden, id] })}>
                  {t('qol.home.hide')}
                </Button>
              </div>
            )}
          </div>
          {body[id]}
        </section>
      ))}
      {customizing && hidden.length > 0 && (
        <section className={styles.section} aria-labelledby="home-hidden">
          <h2 id="home-hidden">{t('qol.home.hiddenTitle')}</h2>
          <div className={styles.controls}>
            {hidden.map((id) => (
              <Button
                key={id}
                variant="secondary"
                onClick={() => save({ order: [...shown, id], hidden: hidden.filter((other) => other !== id) })}
              >
                {t('qol.home.show', { section: t(`qol.home.sections.${id}`) })}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
