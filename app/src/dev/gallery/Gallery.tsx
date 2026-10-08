// The component gallery page: a list of entries, and one entry shown on its own. The page is controlled by the
// address, so a screenshot test opens an entry by its link and gets the same page every time. It uses literal
// text, as app/src/dev may (the lint rule for interface text skips this folder).

import type { GalleryEntry } from './registry';
import { groupEntries } from './registry';
import styles from './Gallery.module.css';

export type GalleryTheme = 'light' | 'dark';
export type GalleryDensity = 'mouse' | 'touch';

export interface GalleryProps {
  entries: readonly GalleryEntry[];
  /** The id of the entry to show, or null for the list. */
  entryId: string | null;
  theme: GalleryTheme;
  density: GalleryDensity;
}

/** The address of an entry, or of the list, in a theme and density. */
export function galleryHref(entryId: string | null, theme: GalleryTheme, density: GalleryDensity): string {
  const params = new URLSearchParams();
  if (entryId) params.set('entry', entryId);
  if (theme !== 'light') params.set('theme', theme);
  if (density !== 'mouse') params.set('density', density);
  const query = params.toString();
  return query ? `?${query}` : '?';
}

/** Renders an entry as a component of its own, so an entry may use hooks. */
function Stage({ entry }: { entry: GalleryEntry }) {
  return <>{entry.render()}</>;
}

function EntryList({ entries, theme, density }: Omit<GalleryProps, 'entryId'>) {
  if (entries.length === 0) {
    return (
      <p className={styles.empty}>
        No entries yet. A package adds one in app/src/dev/gallery/entries, in a file named for its area and ending in
        .gallery.tsx.
      </p>
    );
  }
  return (
    <>
      {groupEntries(entries).map(({ group, entries: inGroup }) => (
        <section key={group} aria-labelledby={`group-${group}`}>
          <h2 id={`group-${group}`} className={styles.group}>
            {group}
          </h2>
          <ul className={styles.list}>
            {inGroup.map((entry) => (
              <li key={entry.id}>
                <a href={galleryHref(entry.id, theme, density)}>{entry.title}</a>
                {entry.description ? <span className={styles.description}> {entry.description}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function Gallery({ entries, entryId, theme, density }: GalleryProps) {
  const entry = entryId ? entries.find((e) => e.id === entryId) : undefined;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <a href={galleryHref(null, theme, density)}>Component gallery</a>
        </h1>
        <nav aria-label="Appearance" className={styles.options}>
          <a href={galleryHref(entryId, theme === 'light' ? 'dark' : 'light', density)}>
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </a>
          <a href={galleryHref(entryId, theme, density === 'mouse' ? 'touch' : 'mouse')}>
            {density === 'mouse' ? 'Touch density' : 'Mouse density'}
          </a>
        </nav>
      </header>
      <main className={styles.main}>
        {entryId && !entry ? <p className={styles.empty}>There is no entry named {entryId}.</p> : null}
        {entry ? (
          <section aria-labelledby="entry-title" data-gallery-entry={entry.id} className={styles.entry}>
            <h2 id="entry-title" className={styles.entryTitle}>
              {entry.title}
            </h2>
            {entry.description ? <p className={styles.description}>{entry.description}</p> : null}
            <div className={styles.stage}>
              <Stage key={entry.id} entry={entry} />
            </div>
          </section>
        ) : (
          !entryId && <EntryList entries={entries} theme={theme} density={density} />
        )}
      </main>
    </div>
  );
}
