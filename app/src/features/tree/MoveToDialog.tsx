// The Move to dialog (ARCHITECTURE.md section 13.6): the keyboard and one-pointer way to move anything. A filter
// field (a combobox) sits above a list of the valid destinations. Up and Down choose, Enter moves, and Escape
// closes. Focus goes back to where it was.

import { useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../strings/t';
import { Dialog } from '../../ui';
import type { Destination } from './destinations';
import { matchDestinations } from './destinations';
import styles from './MoveTo.module.css';

interface MoveToProps {
  readonly title: string;
  readonly places: readonly Destination[];
  onChoose(place: Destination | null): void;
}

function MoveToContent({ title, places, onChoose }: MoveToProps) {
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const shown = useMemo(() => matchDestinations(places, filter), [places, filter]);
  const current = shown[Math.min(active, shown.length - 1)];
  const choose = () => onChoose(current ?? null);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step) {
      event.preventDefault();
      setActive((at) => Math.max(0, Math.min(shown.length - 1, at + step)));
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      choose();
    }
  };
  return (
    <Dialog
      title={t('tree.moveTo.title', { title })}
      initialFocus={input}
      onDismiss={() => onChoose(null)}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: () => onChoose(null) },
        { id: 'move', label: t('tree.moveTo.move'), variant: 'primary', onPress: choose },
      ]}
    >
      <input
        ref={input}
        role="combobox"
        className={styles.filter}
        aria-label={t('tree.moveTo.filter')}
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
        aria-autocomplete="list"
        value={filter}
        spellCheck={false}
        onChange={(event) => {
          setFilter(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {places.length === 0 && <p className={styles.message}>{t('tree.moveTo.none')}</p>}
      {places.length > 0 && shown.length === 0 && <p className={styles.message}>{t('tree.moveTo.noMatches')}</p>}
      <ul id={listId} role="listbox" aria-label={t('tree.moveTo.destinations')} className={styles.list}>
        {shown.map((place) => (
          <li
            key={place.id}
            id={`${listId}-${place.id}`}
            role="option"
            aria-selected={place === current}
            className={styles.option}
            style={{ '--depth': place.depth } as CSSProperties}
            onClick={() => onChoose(place)}
          >
            <span>{place.title}</span>
            {place.depth > 0 && <span className={styles.path}>{place.path}</span>}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Shows the dialog. Resolves with the chosen destination, or null when it was canceled. */
export function chooseDestination(title: string, places: readonly Destination[]): Promise<Destination | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const finish = (place: Destination | null) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(place);
    };
    root.render(<MoveToContent title={title} places={places} onChoose={finish} />);
  });
}
