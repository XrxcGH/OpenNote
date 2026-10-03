// The search panel (Ctrl+Shift+F): full-text search over every page, with filters, a preview of the page that is
// highlighted, and searches saved on this device. It is a dialog with an ARIA 1.2 combobox, as the command palette
// is: focus stays in the box, Up and Down move through the results, and Enter opens the page. Matches are bold as
// well as colored.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { isEnabled } from '../../app/flags';
import { commandContext } from '../../commands/registry';
import type { SearchHit, SearchResponse, TagNode } from '../../services/search/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { formatDate } from '../../strings/format';
import { t } from '../../strings/t';
import { Button, Dialog, Switch, TextField, announce } from '../../ui';
import { maybeSearchClient } from './client';
import { Highlighted } from './Highlighted';
import { openPage } from './locate';
import { openReplace } from './replace/open';
import { deleteSaved, loadSaved, saveSearch } from './saved';
import type { SavedSearch } from './saved';
import styles from './search.module.css';
import { NO_FILTERS, useSearchResults } from './useSearchResults';
import type { PanelFilters } from './useSearchResults';

export interface SearchPanelProps extends OverlayProps {
  query?: string;
}

const DATES: PanelFilters['date'][] = ['any', 'today', 'week', 'month'];
const TYPES: PanelFilters['type'][] = ['all', 'text', 'table', 'image', 'ink'];

function useTags(): TagNode[] {
  const [tags, setTags] = useState<TagNode[]>([]);
  useEffect(() => {
    let current = true;
    maybeSearchClient()
      ?.tagTree()
      .then((list) => current && setTags(list))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return tags;
}

interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; text: string }[];
  onChange(value: T): void;
}

function Select<T extends string>({ label, value, options, onChange }: SelectProps<T>) {
  const id = useId();
  return (
    <div className={styles.filter}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
    </div>
  );
}

function SavedBar({ current, onPick }: { current: SavedSearch; onPick(search: SavedSearch): void }) {
  const [saved, setSaved] = useState<SavedSearch[]>(loadSaved);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState('');
  const pick = (value: string) => {
    setPicked(value);
    const found = saved.find((item) => item.name === value);
    if (found) onPick(found);
  };
  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaved(saveSearch({ ...current, name: trimmed }));
    setPicked(trimmed);
    setNaming(false);
    setName('');
    announce(t('search.panel.savedAs', { name: trimmed }));
  };
  const forget = () => {
    setSaved(deleteSaved(picked));
    setPicked('');
  };
  const choices = [
    { value: '', text: t('search.panel.savedPick') },
    ...saved.map((s) => ({ value: s.name, text: s.name })),
  ];
  return (
    <div className={styles.saved}>
      {saved.length > 0 && <Select label={t('search.panel.saved')} value={picked} options={choices} onChange={pick} />}
      {naming ? (
        <div className={styles.naming}>
          <TextField
            label={t('search.panel.saveName')}
            value={name}
            onChange={setName}
            onCommit={commit}
            onCancel={() => setNaming(false)}
          />
          <Button variant="primary" onClick={commit} disabled={!name.trim()}>
            {t('search.panel.saveConfirm')}
          </Button>
        </div>
      ) : (
        <Button variant="quiet" onClick={() => setNaming(true)} disabled={!current.text.trim()}>
          {t('search.panel.save')}
        </Button>
      )}
      {picked !== '' && (
        <Button variant="quiet" onClick={forget}>
          {t('search.panel.forget')}
        </Button>
      )}
    </div>
  );
}

function Preview({ hit }: { hit: SearchHit | undefined }) {
  if (!hit) return <p className={styles.previewEmpty}>{t('search.panel.previewEmpty')}</p>;
  return (
    <div className={styles.preview} aria-label={t('search.panel.preview')} role="region">
      <h3 className={styles.previewTitle}>
        <Highlighted text={hit.title || t('tree.page.noneTitle')} ranges={hit.title ? hit.titleHighlights : []} />
      </h3>
      <p className={styles.previewDate}>{t('search.panel.changed', { date: formatDate(hit.modified) })}</p>
      {hit.snippet && (
        <p className={styles.previewText}>
          <Highlighted text={hit.snippet.text} ranges={hit.snippet.highlights} />
        </p>
      )}
    </div>
  );
}

/** What the search could not use, and when it stopped early. */
function Notes({ response }: { response: SearchResponse | null }) {
  if (!response) return null;
  return (
    <>
      {response.patternError && (
        <p role="alert" className={styles.problem}>
          {response.patternError}
        </p>
      )}
      {response.notes.map((note) => (
        <p key={note.message} className={styles.note}>
          {note.message}
        </p>
      ))}
      {!response.complete && <p className={styles.note}>{t('search.panel.partial')}</p>}
    </>
  );
}

interface FilterBarProps {
  filters: PanelFilters;
  tags: TagNode[];
  set(patch: Partial<PanelFilters>): void;
}

function FilterBar({ filters, tags, set }: FilterBarProps) {
  const tagOptions = [
    { value: '', text: t('search.panel.anyTag') },
    ...tags.map((n) => ({ value: n.tag, text: n.tag })),
  ];
  return (
    <div className={styles.filters} role="group" aria-label={t('search.panel.filters')}>
      <Switch label={t('search.panel.regex')} checked={filters.regex} onChange={(regex) => set({ regex })} />
      <Switch
        label={t('search.panel.titleOnly')}
        checked={filters.titleOnly}
        onChange={(titleOnly) => set({ titleOnly })}
      />
      <Select label={t('search.panel.tag')} value={filters.tag} options={tagOptions} onChange={(tag) => set({ tag })} />
      <Select
        label={t('search.panel.date')}
        value={filters.date}
        options={DATES.map((value) => ({ value, text: t(`search.panel.dates.${value}`) }))}
        onChange={(date) => set({ date })}
      />
      <Select
        label={t('search.panel.type')}
        value={filters.type}
        options={TYPES.map((value) => ({ value, text: t(`search.panel.types.${value}`) }))}
        onChange={(type) => set({ type })}
      />
    </div>
  );
}

interface ResultsProps {
  id: string;
  hits: SearchHit[];
  index: number;
  status: 'loading' | 'failed' | 'done';
  empty: boolean;
  onHover(page: string): void;
  onOpen(hit: SearchHit): void;
}

function Results({ id, hits, index, status, empty, onHover, onOpen }: ResultsProps) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label={t('search.panel.results')}
      aria-busy={status === 'loading' || undefined}
      className={styles.results}
    >
      {hits.map((hit, at) => (
        <div
          key={hit.page}
          id={`${id}-option-${at}`}
          role="option"
          aria-selected={at === index}
          className={styles.option}
          onPointerMove={() => onHover(hit.page)}
          onClick={() => onOpen(hit)}
        >
          <span className={styles.optionTitle}>
            <Highlighted text={hit.title || t('tree.page.noneTitle')} ranges={hit.title ? hit.titleHighlights : []} />
          </span>
          {hit.snippet && (
            <span className={styles.optionSnippet}>
              <Highlighted text={hit.snippet.text} ranges={hit.snippet.highlights} />
            </span>
          )}
        </div>
      ))}
      {empty && status !== 'loading' && (
        <p className={styles.none}>{status === 'failed' ? t('search.panel.failed') : t('search.panel.none')}</p>
      )}
    </div>
  );
}

/** The highlighted result, the keys that move it, and opening one. */
function useResultKeys(hits: SearchHit[], onClose: () => void) {
  const [chosen, setChosen] = useState<string | null>(null);
  const found = hits.findIndex((hit) => hit.page === chosen);
  const index = hits.length === 0 ? -1 : Math.max(found, 0);
  const move = (step: number) => {
    if (hits.length) setChosen(hits[(index + step + hits.length) % hits.length].page);
  };
  const open = (hit: SearchHit | undefined) => {
    if (!hit) return;
    const { notes } = commandContext('palette');
    onClose();
    void openPage(notes, hit.page);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.altKey) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Enter: () => open(hits[index]),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };
  return { index, setChosen, open, onKeyDown };
}

/** Says how many results there are, once typing pauses. */
function useCountAnnouncement(response: SearchResponse | null, loading: boolean): void {
  useEffect(() => {
    if (!response || loading) return;
    const timer = setTimeout(() => announce(t('search.panel.count', { count: response.hits.length })), 500);
    return () => clearTimeout(timer);
  }, [response, loading]);
}

interface SearchInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  listId: string;
  active: number;
  open: boolean;
  onChange(value: string): void;
  onKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
}

/** The ARIA 1.2 combobox: focus stays here, and the results are the listbox it controls. */
function SearchInput({ inputRef, value, listId, active, open, onChange, onKeyDown }: SearchInputProps) {
  return (
    <input
      ref={inputRef}
      role="combobox"
      type="search"
      className={styles.input}
      aria-label={t('search.panel.input')}
      placeholder={t('search.panel.placeholder')}
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={active >= 0 ? `${listId}-option-${active}` : undefined}
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

export default function SearchPanel({ query: initial = '', onClose }: SearchPanelProps) {
  const [text, setText] = useState(initial);
  const [filters, setFilters] = useState<PanelFilters>(NO_FILTERS);
  const { response, loading, failed } = useSearchResults(text, filters);
  const hits = useMemo(() => response?.hits ?? [], [response]);
  const { index, setChosen, open, onKeyDown } = useResultKeys(hits, onClose);
  const input = useRef<HTMLInputElement>(null);
  const tags = useTags();
  const listId = `${useId().replace(/:/g, '')}-results`;
  useCountAnnouncement(response, loading);
  const set = (patch: Partial<PanelFilters>) => setFilters((before) => ({ ...before, ...patch }));
  const fromSaved = (saved: SavedSearch) => {
    setText(saved.text);
    setFilters({ regex: saved.regex, titleOnly: saved.titleOnly, tag: saved.tag, date: saved.date, type: saved.type });
  };
  return (
    <Dialog
      title={t('search.panel.title')}
      description={t('search.panel.description')}
      size="large"
      placement="top"
      initialFocus={input}
      onDismiss={onClose}
    >
      <div className={styles.panel} data-scope="palette">
        <SearchInput
          inputRef={input}
          value={text}
          listId={listId}
          active={index}
          open={hits.length > 0}
          onChange={setText}
          onKeyDown={onKeyDown}
        />
        <p className={styles.help}>{t('search.panel.help')}</p>
        <Notes response={response} />
        <FilterBar filters={filters} tags={tags} set={set} />
        <SavedBar current={{ name: '', text, ...filters }} onPick={fromSaved} />
        {isEnabled('search.replace') && (
          <div className={styles.saved}>
            <Button variant="quiet" onClick={() => openReplace(text)}>
              {t('qolSearch.replace.open')}
            </Button>
          </div>
        )}
        <div className={styles.body}>
          <Results
            id={listId}
            hits={hits}
            index={index}
            status={loading ? 'loading' : failed ? 'failed' : 'done'}
            empty={response !== null && hits.length === 0}
            onHover={setChosen}
            onOpen={open}
          />
          <Preview hit={hits[index]} />
        </div>
      </div>
    </Dialog>
  );
}
