// The font box: an ARIA combobox over a virtualized listbox (design section 5). Type-ahead moves to the first
// font that starts with the text, Enter chooses it, and a name the device lacks is allowed (the page keeps it).
import { useEffect, useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { announce } from '../../ui';
import { t } from '../../strings/t';
import { FontList } from './FontList';
import { MissingFontNotice } from './MissingFontNotice';
import { buildRows, matchCount, typeAheadIndex } from './rows';
import type { Row } from './rows';
import { prepareFont, resolveFont, validFontName } from './service';
import type { FontCatalog } from './service';
import styles from './fonts.module.css';

export interface FontPickerProps {
  catalog: FontCatalog;
  /** The font of the selection (a name or a theme token), or null when the selection mixes fonts. */
  value: string | null;
  onPick(name: string): void;
}

/** The next option row from `from` in a direction, skipping headers; the same row when there is none. */
function stepTo(rows: readonly Row[], from: number, step: 1 | -1): number {
  let next = from + step;
  while (next >= 0 && next < rows.length && rows[next].kind === 'header') next += step;
  return next >= 0 && next < rows.length ? next : from;
}

function useFontBox({ catalog, value, onPick }: FontPickerProps) {
  const rows = useMemo(() => buildRows(catalog), [catalog]);
  const current = value === null ? null : resolveFont(value, catalog);
  const [text, setText] = useState<string | null>(null); // null: not editing, so the box shows the font.
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState(false);
  const css = current?.css;
  useEffect(() => {
    if (current !== null) prepareFont(current);
  }, [css]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    setOpen(false);
    setText(null);
    setError(false);
  };
  const choose = (name: string) => {
    onPick(name);
    close();
  };
  const edit = (next: string) => {
    setText(next);
    setError(false);
    setOpen(true);
    setActive(typeAheadIndex(rows, next));
    announce(t('textFonts.resultCount', { count: matchCount(rows, next) }));
  };
  const enter = () => {
    const row = open && active >= 0 ? rows[active] : undefined;
    if (row?.kind === 'option') return choose(row.name);
    if (text === null) return;
    const name = validFontName(text);
    if (name === null) setError(true);
    else choose(name);
  };
  const arrow = (step: 1 | -1) => {
    if (open) return setActive(stepTo(rows, active, step));
    setOpen(true);
    const shown = current?.target ?? '';
    setActive(rows.findIndex((row) => row.kind === 'option' && row.id.startsWith('a-') && row.label === shown));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const { key } = event;
    const edge = key === 'Home' || key === 'End';
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(key) && !(edge && open)) return;
    if (key === 'Escape' && !open && text === null) return;
    event.preventDefault();
    if (key === 'Escape') event.stopPropagation();
    if (key === 'Enter') enter();
    else if (key === 'Escape') close();
    else if (edge) setActive(stepTo(rows, key === 'Home' ? -1 : rows.length, key === 'Home' ? 1 : -1));
    else arrow(key === 'ArrowDown' ? 1 : -1);
  };
  return { rows, current, text, open, active, error, setActive, close, choose, edit, onKeyDown };
}

export function FontPicker(props: FontPickerProps) {
  const box = useFontBox(props);
  const { rows, current, open, active, error } = box;
  const listId = useId();
  const noticeId = useId();
  const errorId = useId();
  const activeRow = active >= 0 ? rows[active] : undefined;
  const missing = current !== null && !current.installed;
  const described = [missing ? noticeId : '', error ? errorId : ''].filter(Boolean).join(' ');
  return (
    <div
      className={styles.box}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) box.close();
      }}
    >
      <input
        role="combobox"
        className={`${styles.field} ${styles.fontField} ${missing ? styles.missing : ''}`}
        aria-label={t('textFonts.pickerLabel')}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeRow?.kind === 'option' ? `${listId}-${activeRow.id}` : undefined}
        aria-invalid={error}
        aria-describedby={described || undefined}
        autoComplete="off"
        spellCheck={false}
        value={box.text ?? current?.target ?? ''}
        style={current === null ? undefined : { fontFamily: current.css }}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => box.edit(event.target.value)}
        onKeyDown={box.onKeyDown}
      />
      {current === null ? null : <MissingFontNotice font={current} id={noticeId} />}
      {error ? (
        <span id={errorId} role="alert" className={styles.error}>
          {t('textFonts.invalidName')}
        </span>
      ) : null}
      {open ? (
        <FontList
          id={listId}
          rows={rows}
          catalog={props.catalog}
          active={active}
          onActive={box.setActive}
          onChoose={box.choose}
        />
      ) : null}
    </div>
  );
}
