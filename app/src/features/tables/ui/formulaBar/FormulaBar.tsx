// The formula bar (DESIGN 10.2): docked under the table toolbar while a table is current. The name box shows the
// active cell, the range, or its defined name, and selects what is typed in it. The entry shows the active cell's
// formula with colors. It completes functions and names, hints the arguments, and cycles "$" marks with F4. It takes
// references from clicks on the grid. Enter writes the entry to the cell, and Esc puts the cell back as it was.
import { CalculatorIcon } from '@phosphor-icons/react/dist/csr/Calculator';
import { FunctionIcon } from '@phosphor-icons/react/dist/csr/Function';
import { TagIcon } from '@phosphor-icons/react/dist/csr/Tag';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, ReactElement, RefObject } from 'react';
import { useSettings } from '../../../../state/settings';
import { t } from '../../../../strings/t';
import { IconButton } from '../../../../ui';
import type { TableExtraHost } from '../../../page';
import { hostOfBlock, hostsVersion, subscribeHosts } from '../toolbar/hosts';
import { ErrorButton } from './ErrorButton';
import { addBar } from './insertCommand';
import { Mirror } from './Mirror';
import { nameBoxText, readNameBox } from './nameBox';
import { HintLine, SuggestList } from './Popups';
import { readActive, selectBox, useActive } from './sync';
import type { Active } from './sync';
import { useEntry } from './useEntry';
import type { Entry } from './useEntry';
import styles from './formulaBar.module.css';

const DIALOGS = {
  insert: () => import('../insertFunction/InsertFunction'),
  names: () => import('../names/NameManager'),
  evaluate: () => import('../evaluate/EvaluateDialog'),
};

type DialogName = keyof typeof DIALOGS;

/** What every dialog the bar opens is given. */
export interface DialogProps {
  host: TableExtraHost;
  active: Active | null;
  /** The entry's text and caret, where Insert function inserts. */
  text: string;
  caret: number;
  onInsert(next: { text: string; caret: number }): void;
  onClose(): void;
}

export interface FormulaBarProps {
  /** The table block's ID. */
  block: string;
}

export function FormulaBar({ block }: FormulaBarProps) {
  const on = useSettings((settings) => settings.tables.formulaBar);
  useSyncExternalStore(subscribeHosts, hostsVersion);
  const host = hostOfBlock(block);
  if (!on || !host || !host.flag('tables.sheetWrites')) return null;
  return <Bar host={host} />;
}

/** The name box: Enter selects the cell, range, or name typed; Esc goes back to the table. */
function NameBox({ host, active }: { host: TableExtraHost; active: Active | null }) {
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const list = useId();
  const view = host.editor.view;
  const shown = typed ?? (active ? nameBoxText(active.box, active.header, active.names) : '');
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setTyped(null);
      view.focus();
    }
    if (event.key !== 'Enter' || !active) return;
    event.preventDefault();
    const found = readNameBox(shown, active.header, active.size, active.names);
    setProblem(found ? null : t('sheetFormula.bar.notFound', { text: shown }));
    if (!found) return host.announce(t('sheetFormula.bar.notFound', { text: shown }));
    setTyped(null);
    selectBox(view, found);
  };
  return (
    <>
      <input
        className={styles.nameBox}
        aria-label={t('sheetFormula.bar.nameBox')}
        aria-invalid={problem !== null}
        title={problem ?? undefined}
        list={list}
        value={shown}
        onFocus={(event) => {
          setTyped(shown);
          event.currentTarget.select();
        }}
        onChange={(event) => setTyped(event.currentTarget.value)}
        onBlur={() => {
          setTyped(null);
          setProblem(null);
        }}
        onKeyDown={onKeyDown}
      />
      <datalist id={list}>
        {(active?.names ?? []).map((n) => (
          <option key={n.name} value={n.name} />
        ))}
      </datalist>
    </>
  );
}

interface ToolsProps {
  host: TableExtraHost;
  active: Active | null;
  drafting: boolean;
  open(name: DialogName): void;
}

function Tools({ host, active, drafting, open }: ToolsProps) {
  const button = (name: DialogName, label: string, icon: typeof FunctionIcon) => (
    <IconButton label={label} icon={icon} hasPopup="dialog" onPress={() => open(name)} />
  );
  return (
    <span className={styles.tools}>
      {button('insert', t('sheetFormula.bar.insertFunction'), FunctionIcon)}
      {button('names', t('sheetFormula.bar.names'), TagIcon)}
      {active?.text.startsWith('=') ? button('evaluate', t('sheetFormula.bar.evaluate'), CalculatorIcon) : null}
      {active?.error && !drafting ? <ErrorButton host={host} active={active} /> : null}
    </span>
  );
}

interface EntryFieldProps {
  entry: Entry;
  active: Active | null;
  field: RefObject<HTMLTextAreaElement | null>;
  /** True while a dialog of the bar is open, so the entry keeps its draft when focus moves into it. */
  held: boolean;
}

function EntryField({ entry, active, field, held }: EntryFieldProps) {
  const ids = { list: useId(), hint: useId() };
  const { text, caret, completion, hint } = entry;
  return (
    <div className={styles.entryWrap}>
      <Mirror text={text} caret={caret} />
      <textarea
        ref={field}
        className={styles.entry}
        aria-label={t('sheetFormula.bar.entry')}
        aria-autocomplete="list"
        aria-controls={completion ? ids.list : undefined}
        aria-activedescendant={completion ? `${ids.list}-${entry.selected}` : undefined}
        aria-describedby={hint ? ids.hint : undefined}
        rows={Math.min(6, text.split('\n').length)}
        spellCheck={false}
        value={text}
        disabled={!active}
        onFocus={entry.begin}
        onBlur={() => {
          if (!held && entry.draft) entry.finish('stay');
        }}
        onChange={(event) => {
          const cell = entry.draft?.cell ?? active;
          if (cell)
            entry.update({ cell, text: event.currentTarget.value, caret: event.currentTarget.selectionStart }, true);
        }}
        onSelect={(event) => entry.moveCaret(event.currentTarget.selectionStart)}
        onKeyDown={entry.onKeyDown}
      />
      {completion ? (
        <SuggestList id={ids.list} completion={completion} selected={entry.selected} choose={entry.choose} />
      ) : hint ? (
        <HintLine id={ids.hint} hint={hint} />
      ) : null}
    </div>
  );
}

type DialogView = (props: DialogProps) => ReactElement | null;

function Bar({ host }: { host: TableExtraHost }) {
  const active = useActive(host);
  const field = useRef<HTMLTextAreaElement>(null);
  const [dialog, setDialog] = useState<null | { View: DialogView }>(null);
  const open = useCallback((name: DialogName) => {
    void DIALOGS[name]().then((module) => setDialog({ View: module.default as DialogView }));
  }, []);
  const entry = useEntry(host, active, field, () => open('insert'));
  // Shift+F3 in a cell of this table (the table.insertFunction command) opens Insert function here.
  useEffect(() => addBar({ host, insert: () => open('insert') }), [host, open]);
  const refocus = () => requestAnimationFrame(() => field.current?.focus());
  return (
    <div className={styles.bar} role="group" aria-label={t('sheetFormula.bar.label')} data-formula-bar="">
      <NameBox host={host} active={active} />
      <Tools host={host} active={active} drafting={entry.draft !== null} open={open} />
      <EntryField entry={entry} active={active} field={field} held={dialog !== null} />
      {dialog ? (
        <dialog.View
          host={host}
          active={entry.draft?.cell ?? active ?? readActive(host)}
          text={entry.text}
          caret={entry.caret}
          onInsert={(next) => {
            setDialog(null);
            const cell = entry.draft?.cell ?? active;
            if (cell) entry.update({ cell, ...next });
            refocus();
          }}
          onClose={() => {
            setDialog(null);
            if (entry.draft) refocus();
          }}
        />
      ) : null}
    </div>
  );
}
