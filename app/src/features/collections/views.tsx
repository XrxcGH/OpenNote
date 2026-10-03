// The five views of a collection: table, list, board, calendar, and gallery. Each shows the same rows. A property
// edited in a view, or a card dragged to another column, changes the page itself.
import { useState } from 'react';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import { displayValue, fieldNamed } from '../search';
import type { Field } from '../search';
import type { CollectionDef, Group, Row } from './engine';
import styles from './collections.module.css';

export interface ViewProps {
  groups: Group[];
  rows: Row[];
  names: string[];
  def: CollectionDef;
  onOpen(row: Row): void;
  onEdit(row: Row, name: string, field: Field | undefined, value: Field['value'], label?: string): void;
  onSort(name: string): void;
}

const words = () => ({ yes: t('qolSearch.collections.yes'), no: t('qolSearch.collections.no') });
const show = (row: Row, name: string) => {
  const field = fieldNamed(row.fields, name);
  return field ? displayValue(field, words()) : '';
};

function Cell({ row, name, onEdit }: { row: Row; name: string; onEdit: ViewProps['onEdit'] }) {
  const field = fieldNamed(row.fields, name);
  const label = t('qolSearch.collections.cellLabel', { name, title: row.title });
  if (!field) return null;
  if (field.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={field.value === true}
        aria-label={label}
        onChange={(e) => onEdit(row, name, field, e.target.checked)}
      />
    );
  }
  if (field.type === 'choice') {
    return (
      <select
        className={styles.cell}
        aria-label={label}
        value={typeof field.value === 'string' ? field.value : ''}
        onChange={(e) => onEdit(row, name, field, e.target.value || null)}
      >
        <option value="">{t('qolSearch.properties.none')}</option>
        {(field.options ?? []).map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'page') return <span>{field.label ?? ''}</span>;
  const kind = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
  return (
    <input
      className={styles.cell}
      type={kind}
      aria-label={label}
      defaultValue={field.value === null ? '' : String(field.value)}
      onBlur={(e) => {
        const raw = e.target.value;
        const next = raw === '' ? null : field.type === 'number' ? Number(raw) : raw;
        if (next !== field.value) onEdit(row, name, field, next);
      }}
    />
  );
}

export function TableView({ groups, names, def, onOpen, onEdit, onSort }: ViewProps) {
  const columns = names.slice(0, 6);
  const sorted = (name: string) =>
    def.sortBy === name ? (def.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {['', ...columns].map((name) => (
              <th key={name || 'title'} scope="col" aria-sort={sorted(name)}>
                <button type="button" className={styles.sort} onClick={() => onSort(name)}>
                  {name || t('qolSearch.collections.pageTitle')}
                  {sorted(name) !== 'none' && <span aria-hidden="true">{def.sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            {group.label && (
              <tr>
                <th colSpan={columns.length + 1} scope="colgroup" className={styles.groupRow}>
                  {group.label}{' '}
                  <span className={styles.muted}>{t('qolSearch.collections.count', { count: group.rows.length })}</span>
                </th>
              </tr>
            )}
            {group.rows.map((row) => (
              <tr key={row.page}>
                <th scope="row" className={styles.titleCell}>
                  <button type="button" className={styles.link} onClick={() => onOpen(row)}>
                    {row.title || t('tree.page.noneTitle')}
                  </button>
                </th>
                {columns.map((name) => (
                  <td key={name}>
                    <Cell row={row} name={name} onEdit={onEdit} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Summary({ row, names }: { row: Row; names: string[] }) {
  const parts = names.map((name) => [name, show(row, name)] as const).filter(([, value]) => value !== '');
  return <span className={styles.muted}>{parts.map(([name, value]) => `${name}: ${value}`).join(' · ')}</span>;
}

export function ListView({ groups, names, onOpen }: ViewProps) {
  return (
    <div className={styles.scroll}>
      {groups.map((group) => (
        <section key={group.key}>
          {group.label && <h3 className={styles.groupTitle}>{group.label}</h3>}
          <ul className={styles.list}>
            {group.rows.map((row) => (
              <li key={row.page}>
                <button type="button" className={styles.link} onClick={() => onOpen(row)}>
                  {row.title || t('tree.page.noneTitle')}
                </button>{' '}
                <Summary row={row} names={names.slice(0, 4)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function GalleryView({ groups, names, onOpen }: ViewProps) {
  return (
    <div className={styles.scroll}>
      {groups.map((group) => (
        <section key={group.key}>
          {group.label && <h3 className={styles.groupTitle}>{group.label}</h3>}
          <ul className={styles.gallery}>
            {group.rows.map((row) => (
              <li key={row.page} className={styles.card}>
                <button type="button" className={styles.link} onClick={() => onOpen(row)}>
                  {row.title || t('tree.page.noneTitle')}
                </button>
                <Summary row={row} names={names.slice(0, 3)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function BoardView({ groups, names, def, onOpen, onEdit }: ViewProps) {
  const [over, setOver] = useState<string | null>(null);
  if (!def.groupBy) return <p className={styles.note}>{t('qolSearch.collections.boardNeedsGroup')}</p>;
  const movable = !groups.some((group) =>
    group.rows.some((row) => fieldNamed(row.fields, def.groupBy)?.type === 'date'),
  );
  const move = (row: Row, group: Group | undefined) => {
    const field = fieldNamed(row.fields, def.groupBy);
    if (movable && group) onEdit(row, def.groupBy, field, group.key === '~' ? null : group.label);
  };
  return (
    <div className={styles.board}>
      {groups.map((group) => (
        <section
          key={group.key}
          className={styles.column}
          data-over={over === group.key ? 'true' : undefined}
          aria-label={group.label}
          onDragOver={(event) => {
            if (!movable) return;
            event.preventDefault();
            setOver(group.key);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(null);
            const row = groups.flatMap((g) => g.rows).find((r) => r.page === event.dataTransfer.getData('text/plain'));
            if (row) move(row, group);
          }}
        >
          <h3 className={styles.groupTitle}>
            {group.label}{' '}
            <span className={styles.muted}>{t('qolSearch.collections.count', { count: group.rows.length })}</span>
          </h3>
          {group.rows.map((row) => (
            <div
              key={row.page}
              className={styles.card}
              draggable={movable}
              onDragStart={(event) => event.dataTransfer.setData('text/plain', row.page)}
            >
              <button type="button" className={styles.link} onClick={() => onOpen(row)}>
                {row.title || t('tree.page.noneTitle')}
              </button>
              <Summary row={row} names={names.filter((name) => name !== def.groupBy).slice(0, 3)} />
              {movable && (
                <select
                  className={styles.cell}
                  aria-label={t('qolSearch.collections.moveTo', { title: row.title })}
                  value={group.key}
                  onChange={(event) =>
                    move(
                      row,
                      groups.find((g) => g.key === event.target.value),
                    )
                  }
                >
                  {groups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function CalendarView({ rows, names, def, onOpen }: ViewProps) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const dateField =
    def.dateField || names.find((name) => rows.some((row) => fieldNamed(row.fields, name)?.type === 'date')) || '';
  if (!dateField) return <p className={styles.note}>{t('qolSearch.collections.calendarNeedsDate')}</p>;
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const value = show(row, dateField);
    if (value) byDay.set(value, [...(byDay.get(value) ?? []), row]);
  }
  const step = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  return (
    <div>
      <div className={styles.calendarHead}>
        <Button variant="quiet" onClick={() => step(-1)}>
          {t('qolSearch.daily.previous')}
        </Button>
        <strong>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
        <Button variant="quiet" onClick={() => step(1)}>
          {t('qolSearch.daily.next')}
        </Button>
        <span className={styles.muted}>{t('qolSearch.collections.byDate', { name: dateField })}</span>
      </div>
      <div className={styles.calendar}>
        {days.map((day) => (
          <div
            key={iso(day)}
            className={styles.day}
            data-outside={day.getMonth() === month.getMonth() ? undefined : 'true'}
          >
            <span className={styles.muted}>{day.getDate()}</span>
            {(byDay.get(iso(day)) ?? []).map((row) => (
              <button key={row.page} type="button" className={styles.link} onClick={() => onOpen(row)}>
                {row.title || t('tree.page.noneTitle')}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
