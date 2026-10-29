// The editor for a choice column's options (Further features, Phase 7): add, rename, recolor, reorder, and delete.
// It is a dialog of plain rows, so the keyboard, a pen, and a screen reader reach every control the way they reach
// any form: a name field, a color list, and Move up, Move down, and Delete buttons that name their option.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Button, Dialog, Switch, TextField, announce } from '../../../ui';
import { MAX_CHOICES } from '../engine';
import { CHOICE_COLORS } from './data';
import type { ChoiceColor } from './data';
import { draftProblem, nextColor } from './choice';
import type { Draft } from './choice';
import styles from './smart.module.css';

export interface ChoiceEdit {
  drafts: Draft[];
  multi: boolean;
}

interface Row extends Draft {
  key: number;
}

export const colorName = (color: ChoiceColor): string => t(`smart.choice.colors.${color}`);

function problemText(drafts: readonly Draft[]): string | null {
  const problem = draftProblem(drafts);
  if (!problem) return null;
  if (problem.kind === 'empty') return t('smart.choice.problemEmpty');
  if (problem.kind === 'taken') return t('smart.choice.problemTaken', { name: problem.name });
  return t('smart.choice.problemMany', { max: MAX_CHOICES });
}

/** The rows being edited and the changes a person can make to them. */
function useRows(start: ChoiceEdit) {
  const [rows, setRows] = useState<Row[]>(() => start.drafts.map((draft, key) => ({ ...draft, key })));
  const [next, setNext] = useState(start.drafts.length);
  const label = (row: Row, at: number) => row.name || String(at + 1);
  return {
    rows,
    change: (key: number, patch: Partial<Draft>) =>
      setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row))),
    move(at: number, by: -1 | 1) {
      const to = at + by;
      if (to < 0 || to >= rows.length) return;
      const moved = [...rows];
      [moved[at], moved[to]] = [moved[to], moved[at]];
      setRows(moved);
      announce(t('smart.choice.moved', { name: label(moved[to], to), place: to + 1, count: moved.length }));
    },
    remove(at: number) {
      announce(t('smart.choice.removed', { name: label(rows[at], at) }));
      setRows(rows.filter((_, index) => index !== at));
    },
    add() {
      setRows([...rows, { key: next, name: '', color: nextColor(rows.map((row) => row.color)) }]);
      setNext(next + 1);
    },
  };
}

interface RowProps {
  row: Row;
  at: number;
  count: number;
  change(key: number, patch: Partial<Draft>): void;
  move(at: number, by: -1 | 1): void;
  remove(at: number): void;
}

/** One option: a swatch, its name, its color, and the buttons that move and delete it. */
function OptionRow({ row, at, count, change, move, remove }: RowProps) {
  const name = row.name || String(at + 1);
  return (
    <li className={styles.choiceRow}>
      <span className={styles.choiceSwatch} data-color={row.color} aria-hidden="true" />
      <TextField
        label={t('smart.choice.nameLabel', { number: at + 1 })}
        value={row.name}
        onChange={(value) => change(row.key, { name: value })}
      />
      <label className={styles.choiceColor}>
        <span>{t('smart.choice.colorLabel', { name })}</span>
        <select value={row.color} onChange={(event) => change(row.key, { color: event.target.value as ChoiceColor })}>
          {CHOICE_COLORS.map((color) => (
            <option key={color} value={color}>
              {colorName(color)}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="quiet"
        aria-label={t('smart.choice.moveUp', { name })}
        disabled={at === 0}
        onClick={() => move(at, -1)}
      >
        {t('smart.choice.up')}
      </Button>
      <Button
        variant="quiet"
        aria-label={t('smart.choice.moveDown', { name })}
        disabled={at === count - 1}
        onClick={() => move(at, 1)}
      >
        {t('smart.choice.down')}
      </Button>
      <Button variant="quiet" aria-label={t('smart.choice.remove', { name })} onClick={() => remove(at)}>
        {t('smart.choice.delete')}
      </Button>
    </li>
  );
}

function Editor(props: { column: string; start: ChoiceEdit; finish(result: ChoiceEdit | null): void }) {
  const { column, start, finish } = props;
  const edit = useRows(start);
  const { rows } = edit;
  const [multi, setMulti] = useState(start.multi);
  const [problem, setProblem] = useState<string | null>(null);
  const save = () => {
    const found = problemText(rows);
    if (found) setProblem(found);
    else {
      const drafts = rows.map(({ name, color, was }) => ({ name, color, ...(was !== undefined ? { was } : {}) }));
      finish({ drafts, multi });
    }
  };
  return (
    <Dialog
      title={t('smart.choice.editTitle', { column })}
      description={t('smart.choice.editHelp')}
      size="medium"
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: () => finish(null) },
        { id: 'save', label: t('smart.choice.save'), variant: 'primary', onPress: save },
      ]}
      onDismiss={() => finish(null)}
    >
      <div className={styles.choiceEditor} onChange={() => setProblem(null)}>
        <Switch label={t('smart.choice.several')} checked={multi} onChange={setMulti} />
        <ol className={styles.choiceRows} aria-label={t('smart.choice.listLabel')}>
          {rows.map((row, at) => (
            <OptionRow key={row.key} row={row} at={at} count={rows.length} {...edit} />
          ))}
        </ol>
        <Button variant="secondary" onClick={edit.add} disabled={rows.length >= MAX_CHOICES}>
          {t('smart.choice.add')}
        </Button>
        <p className={styles.choiceNote}>{t('smart.choice.removedNote')}</p>
        {problem && (
          <p role="alert" className={styles.choiceProblem}>
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Opens the editor. Resolves with the edited options, or null when canceled. */
export function editChoicesDialog(column: string, start: ChoiceEdit): Promise<ChoiceEdit | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: ChoiceEdit | null) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(result);
    };
    root.render(<Editor column={column} start={start} finish={finish} />);
  });
}
