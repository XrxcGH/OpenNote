// Collections: saved views of pages chosen by a search, a tag, a section, or property values, shown as a table, a
// list, a board, a calendar, or a gallery. The rules fold open above the pages. Editing a property in a view changes
// the page.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { commandContext } from '../../commands/registry';
import type { PageFact, TagNode } from '../../services/search/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Button, Dialog, TextField, showToast } from '../../ui';
import { maybeSearchClient, openAndReveal } from '../search';
import styles from './collections.module.css';
import { OPERATORS, VIEW_KINDS, groupRows, matches, propertyNames, sortRows, toRow } from './engine';
import type { CollectionDef, Condition, Row } from './engine';
import { loadCollections, newCollection, saveCollections, setProperty } from './store';
import { BoardView, CalendarView, GalleryView, ListView, TableView } from './views';
import type { ViewProps } from './views';

function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; text: string }[];
  onChange(value: string): void;
}) {
  return (
    <label className={styles.pick}>
      <span>{label}</span>
      <select className={styles.cell} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
    </label>
  );
}

function useFacts(version: number): PageFact[] | null {
  const [facts, setFacts] = useState<PageFact[] | null>(null);
  useEffect(() => {
    let current = true;
    const extras = maybeSearchClient()?.extras;
    if (!extras) {
      setFacts([]);
      return;
    }
    extras
      .pageFacts(null)
      .then((list) => current && setFacts(list))
      .catch(() => current && setFacts([]));
    return () => {
      current = false;
    };
  }, [version]);
  return facts;
}

function useChoices(): { tags: TagNode[]; sections: { id: string; title: string }[] } {
  const [tags, setTags] = useState<TagNode[]>([]);
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    let current = true;
    void maybeSearchClient()?.tagTree().then((list) => current && setTags(list)).catch(() => undefined);
    const { notes } = commandContext('palette');
    void (async () => {
      const found: { id: string; title: string }[] = [];
      for (const notebook of await notes.listNotebooks()) {
        for (const node of await notes.listChildren(notebook.id)) {
          if (node.kind === 'section') found.push({ id: node.id, title: `${notebook.title} / ${node.title}` });
        }
      }
      if (current) setSections(found);
    })().catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return { tags, sections };
}

const VIEWS = { table: TableView, list: ListView, board: BoardView, calendar: CalendarView, gallery: GalleryView };

export default function CollectionsDialog({ onClose }: OverlayProps) {
  const [list, setList] = useState<CollectionDef[]>(loadCollections);
  const [selected, setSelected] = useState<string>(() => list[0]?.id ?? '');
  const [version, setVersion] = useState(0);
  const [found, setFound] = useState<Set<string> | null>(null);
  const [editing, setEditing] = useState(false);
  const facts = useFacts(version);
  const { tags, sections } = useChoices();
  const def = list.find((item) => item.id === selected) ?? null;

  const update = useCallback((patch: Partial<CollectionDef>) => {
    setList((was) => {
      const next = was.map((item) => (item.id === selected ? { ...item, ...patch } : item));
      saveCollections(next);
      return next;
    });
  }, [selected]);

  useEffect(() => {
    const text = def?.text.trim() ?? '';
    const client = maybeSearchClient();
    if (!text || !client) return setFound(null);
    let current = true;
    const timer = setTimeout(() => {
      client
        .search({ text, limit: 100 })
        .then((response) => current && setFound(new Set(response.hits.map((hit) => hit.page))))
        .catch(() => current && setFound(new Set()));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [def?.text]);

  const rows = useMemo(() => (facts ?? []).map(toRow), [facts]);
  const shown = useMemo(() => (def ? sortRows(rows.filter((row) => matches(row, def, found)), def) : []), [rows, def, found]);
  const names = useMemo(() => propertyNames(shown), [shown]);
  const allNames = useMemo(() => propertyNames(rows), [rows]);
  const words = { none: t('qolSearch.collections.noValue'), yes: t('qolSearch.collections.yes'), no: t('qolSearch.collections.no') };
  const groups = useMemo(() => (def ? groupRows(shown, def, words) : []), [shown, def]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => {
    const made = newCollection(t('qolSearch.collections.newName', { number: list.length + 1 }));
    const next = [...list, made];
    saveCollections(next);
    setList(next);
    setSelected(made.id);
    setEditing(true);
  };
  const remove = () => {
    const next = list.filter((item) => item.id !== selected);
    saveCollections(next);
    setList(next);
    setSelected(next[0]?.id ?? '');
  };

  const open = (row: Row) => {
    onClose();
    void openAndReveal(commandContext('palette').notes, row.page, null);
  };
  const edit: ViewProps['onEdit'] = (row, name, field, value, label) => {
    const type = field?.type ?? 'text';
    setProperty(commandContext('palette').platform.pages, row.page, name, type, value, label)
      .then(() => setVersion((was) => was + 1))
      .catch(() => showToast({ message: t('qolSearch.collections.editFailed'), tone: 'danger' }));
  };
  const sort = (name: string) =>
    update(def?.sortBy === name ? { sortDir: def.sortDir === 'asc' ? 'desc' : 'asc' } : { sortBy: name, sortDir: 'asc' });
  const setCondition = (at: number, patch: Partial<Condition>) =>
    update({ conditions: (def?.conditions ?? []).map((condition, index) => (index === at ? { ...condition, ...patch } : condition)) });

  const View = def ? VIEWS[def.view] : null;
  const none = { value: '', text: t('qolSearch.collections.any') };
  const propertyOptions = [none, ...allNames.map((name) => ({ value: name, text: name }))];
  return (
    <Dialog
      title={t('qolSearch.collections.title')}
      description={t('qolSearch.collections.description')}
      size="large"
      actions={[{ id: 'close', label: t('common.close'), variant: 'secondary', onPress: onClose }]}
      onDismiss={onClose}
    >
      <div className={styles.bar}>
        {list.length > 0 && (
          <Pick
            label={t('qolSearch.collections.pick')}
            value={selected}
            options={list.map((item) => ({ value: item.id, text: item.name }))}
            onChange={setSelected}
          />
        )}
        <Button variant="secondary" onClick={create}>
          {t('qolSearch.collections.new')}
        </Button>
        {def && (
          <>
            <Button variant="quiet" aria-expanded={editing} onClick={() => setEditing((was) => !was)}>
              {t('qolSearch.collections.rules')}
            </Button>
            <Button variant="quiet" onClick={remove}>
              {t('qolSearch.collections.delete')}
            </Button>
          </>
        )}
      </div>
      {!def && <p className={styles.note}>{t('qolSearch.collections.empty')}</p>}
      {def && editing && (
        <div className={styles.rules}>
          <TextField label={t('qolSearch.collections.name')} value={def.name} onChange={(name) => update({ name })} />
          <TextField label={t('qolSearch.collections.text')} value={def.text} onChange={(text) => update({ text })} />
          <Pick
            label={t('qolSearch.collections.tag')}
            value={def.tag}
            options={[none, ...tags.map((node) => ({ value: node.tag, text: node.tag }))]}
            onChange={(tag) => update({ tag })}
          />
          <Pick
            label={t('qolSearch.collections.section')}
            value={def.section}
            options={[none, ...sections.map((section) => ({ value: section.id, text: section.title }))]}
            onChange={(section) => update({ section })}
          />
          {def.conditions.map((condition, at) => (
            <div key={at} className={styles.condition}>
              <Pick label={t('qolSearch.collections.property')} value={condition.name} options={propertyOptions} onChange={(name) => setCondition(at, { name })} />
              <Pick
                label={t('qolSearch.collections.operator')}
                value={condition.op}
                options={OPERATORS.map((op) => ({ value: op, text: t(`qolSearch.collections.operators.${op}`) }))}
                onChange={(op) => setCondition(at, { op: op as Condition['op'] })}
              />
              <TextField label={t('qolSearch.collections.value')} value={condition.value} onChange={(value) => setCondition(at, { value })} />
              <Button variant="quiet" onClick={() => update({ conditions: def.conditions.filter((_, index) => index !== at) })}>
                {t('qolSearch.collections.removeRule')}
              </Button>
            </div>
          ))}
          <Button variant="secondary" onClick={() => update({ conditions: [...def.conditions, { name: allNames[0] ?? '', op: 'is', value: '' }] })}>
            {t('qolSearch.collections.addRule')}
          </Button>
          <Pick label={t('qolSearch.collections.groupBy')} value={def.groupBy} options={propertyOptions} onChange={(groupBy) => update({ groupBy })} />
          <Pick
            label={t('qolSearch.collections.groupDate')}
            value={def.groupDate}
            options={(['day', 'week', 'month'] as const).map((value) => ({ value, text: t(`qolSearch.collections.dateGroups.${value}`) }))}
            onChange={(groupDate) => update({ groupDate: groupDate as CollectionDef['groupDate'] })}
          />
          <Pick label={t('qolSearch.collections.dateField')} value={def.dateField} options={propertyOptions} onChange={(dateField) => update({ dateField })} />
        </div>
      )}
      {def && (
        <div className={styles.views} role="group" aria-label={t('qolSearch.collections.showAs')}>
          {VIEW_KINDS.map((kind) => (
            <Button key={kind} variant={def.view === kind ? 'primary' : 'secondary'} aria-pressed={def.view === kind} onClick={() => update({ view: kind })}>
              {t(`qolSearch.collections.views.${kind}`)}
            </Button>
          ))}
        </div>
      )}
      {def && facts === null && <p className={styles.note}>{t('qolSearch.collections.loading')}</p>}
      {def && facts !== null && (
        <p role="status" className={styles.note}>
          {shown.length === 0 ? t('qolSearch.collections.nothing') : t('qolSearch.collections.pages', { count: shown.length })}
        </p>
      )}
      {def && View && shown.length > 0 && (
        <View groups={groups} rows={shown} names={names} def={def} onOpen={open} onEdit={edit} onSort={sort} />
      )}
    </Dialog>
  );
}

