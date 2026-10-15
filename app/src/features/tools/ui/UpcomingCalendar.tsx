// The week and month views of Upcoming. Both draw the same grid of days, one row for a week and up to six for a month,
// with the number of things due on each day. A day is chosen with the arrow keys or a click, and its items list under
// the grid, where each can be checked off and, when it came from a page, opened. Nothing here counts or scores.
import { useEffect, useRef } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import { addDays, addMonths, bucketByDay, dateKey, dayOfWeek, monthGrid, startOfWeek, weekGrid } from '../upcoming';
import type { CalendarDay, CivilDate, UpcomingItem } from '../upcoming';
import { dateIn } from '../upcoming/zone';
import { whenText } from './UpcomingList';
import { longDay, useMinute, weekday, zone } from './upcomingShared';
import grid from './calendar.module.css';
import styles from './tools.module.css';

export type CalendarMode = 'week' | 'month';

export interface UpcomingCalendarProps {
  mode: CalendarMode;
  items: readonly UpcomingItem[];
  /** The chosen day, kept by the parent so the week and month views share it. */
  selected: CivilDate;
  onSelect(date: CivilDate): void;
  onCheck(item: UpcomingItem, done: boolean): void;
  onOpenPage(item: UpcomingItem): void;
}

const dayName = (date: CivilDate): string =>
  new Date(date.year, date.month - 1, date.day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

const shortDate = (date: CivilDate): string =>
  new Date(date.year, date.month - 1, date.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const monthName = (date: CivilDate): string =>
  new Date(date.year, date.month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** Where an arrow key or Page key moves the chosen day, or null for a key the grid does not use. */
export function movedBy(key: string, from: CivilDate, mode: CalendarMode): CivilDate | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(from, -1);
    case 'ArrowRight':
      return addDays(from, 1);
    case 'ArrowUp':
      return addDays(from, -7);
    case 'ArrowDown':
      return addDays(from, 7);
    case 'Home':
      return startOfWeek(from, 0);
    case 'End':
      return addDays(startOfWeek(from, 0), 6);
    case 'PageUp':
      return mode === 'month' ? addMonths(from, -1) : addDays(from, -7);
    case 'PageDown':
      return mode === 'month' ? addMonths(from, 1) : addDays(from, 7);
    default:
      return null;
  }
}

function Cell({
  day,
  selected,
  count,
  open,
  onSelect,
}: {
  day: CalendarDay;
  selected: boolean;
  count: number;
  open: number;
  onSelect(): void;
}) {
  const label = `${dayName(day.date)}, ${t('study.views.count', { count })}${day.today ? `, ${t('study.views.today')}` : ''}`;
  return (
    <button
      type="button"
      role="gridcell"
      className={grid.day}
      aria-selected={selected}
      aria-label={label}
      tabIndex={selected ? 0 : -1}
      data-key={day.key}
      data-today={day.today}
      data-outside={!day.inMonth}
      onClick={onSelect}
    >
      <span aria-hidden="true">{day.date.day}</span>
      <span aria-hidden="true" className={grid.count} data-open={open > 0}>
        {count > 0 ? count : ' '}
      </span>
    </button>
  );
}

export function UpcomingCalendar({ mode, items, selected, onSelect, onCheck, onOpenPage }: UpcomingCalendarProps) {
  const now = useMinute();
  const today = dateIn(now, zone());
  const days = bucketByDay(items);
  const rows: CalendarDay[][] =
    mode === 'week'
      ? [weekGrid(selected, today, 0)]
      : monthGrid(selected.year, selected.month, today, { rows: 6, weekStart: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // After a key moves the chosen day, focus follows it.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    gridRef.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]')?.focus();
  });

  const step = (direction: -1 | 1) => {
    if (mode === 'week') onSelect(addDays(selected, direction * 7));
    else onSelect(addMonths(selected, direction));
  };

  const chosen = days.get(dateKey(selected)) ?? [];
  const first = rows[0][0].date;
  const last = rows[rows.length - 1][6].date;
  const range = mode === 'week' ? `${shortDate(first)} – ${shortDate(last)}` : monthName(selected);

  return (
    <div className={grid.views}>
      <div className={grid.bar}>
        <Button variant="quiet" onClick={() => step(-1)}>
          {t(mode === 'week' ? 'study.views.previousWeek' : 'study.views.previousMonth')}
        </Button>
        <h3 className={grid.range} aria-live="polite">
          {range}
        </h3>
        <Button variant="quiet" onClick={() => step(1)}>
          {t(mode === 'week' ? 'study.views.nextWeek' : 'study.views.nextMonth')}
        </Button>
        <Button variant="quiet" onClick={() => onSelect(today)}>
          {t('study.views.goToToday')}
        </Button>
      </div>
      <div
        ref={gridRef}
        className={grid.grid}
        role="grid"
        aria-label={t(mode === 'week' ? 'study.views.weekGrid' : 'study.views.monthGrid', { range })}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const to = movedBy(event.key, selected, mode);
          if (!to) return;
          event.preventDefault();
          moved.current = true;
          onSelect(to);
        }}
      >
        <div className={grid.row} role="row">
          {rows[0].map((day) => (
            <span key={day.key} className={grid.head} role="columnheader" aria-label={longDay(dayOfWeek(day.date))}>
              {weekday(dayOfWeek(day.date))}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row[0].key} className={grid.row} role="row">
            {row.map((day) => {
              const list = days.get(day.key) ?? [];
              return (
                <Cell
                  key={day.key}
                  day={day}
                  selected={dateKey(selected) === day.key}
                  count={list.length}
                  open={list.filter((item) => !item.done).length}
                  onSelect={() => onSelect(day.date)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <section aria-labelledby="upcoming-day" className={styles.group}>
        <h3 id="upcoming-day" className={styles.groupTitle}>
          {t('study.views.dueOn', { date: dayName(selected) })}
        </h3>
        {chosen.length === 0 ? <p className={styles.empty}>{t('study.views.nothing')}</p> : null}
        <ul className={styles.items}>
          {chosen.map((item) => (
            <li key={item.id} className={styles.item}>
              <input
                type="checkbox"
                checked={item.done}
                disabled={Boolean(item.page) && !item.page?.task}
                aria-label={t('smart.tools.upcoming.done', { title: item.title })}
                onChange={(event) => onCheck(item, event.target.checked)}
              />
              <span className={styles.itemTitle}>{item.title}</span>
              {item.due?.time ? <span className={styles.itemDue}>{whenText(item.due).split(', ').at(-1)}</span> : null}
              {item.page ? (
                <Button
                  variant="quiet"
                  aria-label={t('study.views.openPage', { page: item.page.title })}
                  onClick={() => onOpenPage(item)}
                >
                  {t('study.views.open')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
