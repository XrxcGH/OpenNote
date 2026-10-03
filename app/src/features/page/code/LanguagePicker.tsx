// The code language picker (ARCHITECTURE.md section 14.2; owner: WP6): a filterable listbox in a popover at the
// language button. Focus stays in the filter, which points at the highlighted language with
// aria-activedescendant. Enter or a click chooses it, and Escape closes the picker without a change.
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { findLanguage, matchLanguages } from '../../../editor/highlight/languages';
import { t } from '../../../strings/t';
import { Popover } from '../../../ui';
import styles from './code.module.css';

export interface LanguagePickerProps {
  anchor: RefObject<HTMLElement | null>;
  /** The block's language now, or null for plain text. */
  current: string | null;
  onPick(language: string | null): void;
  onClose(): void;
}

interface Choice {
  id: string | null;
  name: string;
}

function useChoices(query: string): Choice[] {
  return useMemo(() => {
    const plain = t('code.language.plain');
    const languages = matchLanguages(query).map((one) => ({ id: one.id, name: one.name }));
    const showPlain = !query.trim() || plain.toLowerCase().includes(query.trim().toLowerCase());
    return showPlain ? [{ id: null, name: plain }, ...languages] : languages;
  }, [query]);
}

export function LanguagePicker({ anchor, current, onPick, onClose }: LanguagePickerProps) {
  const [query, setQuery] = useState('');
  const choices = useChoices(query);
  // A block written as ```py is Python here.
  const currentId = current === null ? null : (findLanguage(current)?.id ?? current);
  const startAt = Math.max(
    0,
    choices.findIndex((choice) => choice.id === currentId),
  );
  const [active, setActive] = useState(startAt);
  const index = choices.length === 0 ? -1 : Math.min(active, choices.length - 1);
  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;
  const list = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  // The picker opens on a press or a command, so its filter takes focus, as a menu would.
  useEffect(() => {
    filter.current?.focus();
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, []);
  const moveTo = (next: number) => {
    setActive(next);
    list.current?.querySelector(`[id="${optionId(next)}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = choices.length - 1;
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: last };
    if (event.key in moves && last >= 0) {
      event.preventDefault();
      moveTo(Math.min(last, Math.max(0, moves[event.key])));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (index >= 0) onPick(choices[index].id);
    }
  };
  return (
    <Popover anchor={anchor} label={t('code.language.picker')} open onClose={onClose}>
      <div className={styles.picker}>
        <input
          ref={filter}
          role="combobox"
          className={styles.filter}
          aria-label={t('code.language.filter')}
          aria-expanded={choices.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={index >= 0 ? optionId(index) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div ref={list} role="listbox" id={listId} aria-label={t('code.language.picker')} className={styles.list}>
          {choices.map((choice, i) => (
            <div
              key={choice.id ?? ''}
              id={optionId(i)}
              role="option"
              aria-selected={i === index}
              className={styles.option}
              onPointerMove={() => i !== index && setActive(i)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(choice.id)}
            >
              <span>{choice.name}</span>
              {choice.id === currentId ? <CheckIcon aria-hidden="true" className={styles.check} /> : null}
            </div>
          ))}
        </div>
        {choices.length === 0 ? (
          <p role="status" className={styles.none}>
            {t('code.language.none', { query: query.trim() })}
          </p>
        ) : null}
      </div>
    </Popover>
  );
}
