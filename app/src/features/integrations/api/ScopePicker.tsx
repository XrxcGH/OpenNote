// Which notebooks an app or a webhook covers: every notebook, or the ones the person ticks. Locked sections are
// never covered, whatever is picked here; the note says so.

import { useId } from 'react';
import { useStore, shallowEqual } from '../../../state/store';
import { t } from '../../../strings/t';
import { treeStore } from '../../tree';
import styles from './AppPermissions.module.css';
import type { Scope } from './types';

/** The notebooks' key in the tree's children (features/tree/store.ts, ROOT). */
const NOTEBOOKS = '';

export interface NotebookChoice {
  id: string;
  title: string;
}

const selectNotebooks = (state: ReturnType<typeof treeStore.get>): NotebookChoice[] =>
  (state.children[NOTEBOOKS] ?? []).map((id) => ({ id, title: state.nodes[id]?.title || id }));

const sameNotebooks = (a: NotebookChoice[], b: NotebookChoice[]) =>
  a.length === b.length && a.every((one, index) => shallowEqual(one, b[index]));

/** The notebooks in the tree, in order. */
export function useNotebookChoices(): NotebookChoice[] {
  return useStore(treeStore, selectNotebooks, sameNotebooks);
}

export function ScopePicker(props: {
  value: Scope;
  onChange(next: Scope): void;
  notebooks: readonly NotebookChoice[];
  /** Shown above the choices, such as "Notebooks". */
  legend: string;
}) {
  const { value, onChange, notebooks, legend } = props;
  const id = useId();
  const picked = value.kind === 'notebooks' ? value.ids : [];
  const toggle = (notebook: string, on: boolean) =>
    onChange({
      kind: 'notebooks',
      ids: on ? [...picked.filter((one) => one !== notebook), notebook] : picked.filter((one) => one !== notebook),
    });
  return (
    <fieldset className={styles.fieldset}>
      <legend>{legend}</legend>
      <label className={styles.choice}>
        <input
          type="radio"
          name={`${id}-scope`}
          checked={value.kind === 'all'}
          onChange={() => onChange({ kind: 'all' })}
        />
        {t('platformApi.apps.notebooks.all')}
      </label>
      <label className={styles.choice}>
        <input
          type="radio"
          name={`${id}-scope`}
          checked={value.kind === 'notebooks'}
          onChange={() => onChange({ kind: 'notebooks', ids: picked })}
        />
        {t('platformApi.apps.notebooks.some')}
      </label>
      {value.kind === 'notebooks' && (
        <div className={styles.notebookList} role="group" aria-label={t('platformApi.apps.notebooks.some')}>
          {notebooks.map((notebook) => (
            <label key={notebook.id} className={styles.choice}>
              <input
                type="checkbox"
                checked={picked.includes(notebook.id)}
                onChange={(event) => toggle(notebook.id, event.target.checked)}
              />
              {notebook.title}
            </label>
          ))}
          {picked.length === 0 && <p className={styles.note}>{t('platformApi.apps.notebooks.none')}</p>}
        </div>
      )}
      <p className={styles.note}>{t('platformApi.apps.lockedNote')}</p>
    </fieldset>
  );
}
