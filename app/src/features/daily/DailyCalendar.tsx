// checks-disable-file modifiability: one dialog whose parts share its state; split it when it grows again
// The daily notes calendar: a month of days. A day with pages shows a dot and a count. Arrow keys move
// by day and week, Page Up and Page Down by month, and Today comes back to the current day. Enter opens the note for
// the day, making it from its template when it does not exist yet.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { commandContext } from '../../commands/registry';
import type { SearchClient } from '../../services/search/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Button, Dialog, announce, showToast } from '../../ui';
import { maybeSearchClient } from '../search';
import styles from './daily.module.css';
import {
  addDays,
  addMonths,
  dayKey,
  dayOfMs,
  monthGrid,
  noteTitle,
  sameDay,
  startOfWeek,
  today,
  toDate,
} from './dates';
import type { DailyKind, Ymd } from './dates';
import { dailyNotebook, existingTitles, openNote } from './notes';
import { TemplateEditor } from './TemplateEditor';

const WEEK_START = 0;

interface Marks {
  counts: Map<string, number>;
  notes: Set<string>;
}

function useMarks(version: number): Marks {
  const [marks, setMarks] = useState<Marks>({ counts: new Map(), notes: new Set() });
  useEffect(() => {
    let current = true;
    const { notes } = commandContext('palette');
    void (async () => {
      const notebook = await dailyNotebook(notes);
      const extras: SearchClient['extras'] = maybeSearchClient()?.extras;
      const facts = notebook && extras ? await extras.pageFacts(notebook) : [];
      const counts = new Map<string, number>();
      for (const fact of facts) {
        const key = dayKey(dayOfMs(fact.created));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const titles = notebook ? await existingTitles(notes, notebook) : new Set<string>();
      if (current) setMarks({ counts, notes: titles });
    })().catch(() => undefined);
    return () => {
      current = false;
    };
  }, [version]);
  return marks;
}

const monthName = (day: Ymd) => toDate(day).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const longName = (day: Ymd) =>
  toDate(day).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const weekdayName = (index: number, style: 'short' | 'long') =>
  new Date(2023, 0, 1 + index).toLocaleDateString('en-US', { weekday: style });

export default function DailyCalendar({ onClose }: OverlayProps) {
  const [cursor, setCursor] = useState<Ymd>(today());
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const marks = useMarks(version);
  const grid = useMemo(() => monthGrid(cursor.y, cursor.m, WEEK_START), [cursor.y, cursor.m]);
  const focused = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (moved.current) focused.current?.focus();
  }, [cursor]);

  const go = (next: Ymd) => {
    moved.current = true;
    setCursor(next);
    announce(longName(next));
  };

  const open = async (kind: DailyKind, day: Ymd) => {
    try {
      const opened = await openNote(kind, day);
      if (opened) onClose();
      else showToast({ message: t('qolSearch.daily.noNotebook'), tone: 'danger' });
    } catch {
      showToast({ message: t('qolSearch.daily.failed'), tone: 'danger' });
    }
  };

  const onKey = (event: KeyboardEvent) => {
    const keys: Record<string, Ymd> = {
      ArrowLeft: addDays(cursor, -1),
      ArrowRight: addDays(cursor, 1),
      ArrowUp: addDays(cursor, -7),
      ArrowDown: addDays(cursor, 7),
      PageUp: addMonths(cursor, event.shiftKey ? -12 : -1),
      PageDown: addMonths(cursor, event.shiftKey ? 12 : 1),
      Home: startOfWeek(cursor, WEEK_START),
      End: addDays(startOfWeek(cursor, WEEK_START), 6),
    };
    const next = keys[event.key];
    if (next) {
      event.preventDefault();
      go(next);
    }
  };

  const now = today();
  return (
    <Dialog
      title={t('qolSearch.daily.title')}
      description={t('qolSearch.daily.description')}
      size="medium"
      actions={[{ id: 'close', label: t('common.close'), variant: 'secondary', onPress: onClose }]}
      onDismiss={onClose}
    >
      <div className={styles.header}>
        <Button
          variant="quiet"
          aria-label={t('qolSearch.daily.previousMonth')}
          onClick={() => go(addMonths(cursor, -1))}
        >
          {t('qolSearch.daily.previous')}
        </Button>
        <h3 className={styles.month} id="daily-month" aria-live="polite">
          {monthName(cursor)}
        </h3>
        <Button variant="quiet" aria-label={t('qolSearch.daily.nextMonth')} onClick={() => go(addMonths(cursor, 1))}>
          {t('qolSearch.daily.next')}
        </Button>
        <Button variant="secondary" onClick={() => go(now)}>
          {t('qolSearch.daily.today')}
        </Button>
      </div>
      <div role="grid" aria-labelledby="daily-month" className={styles.grid} onKeyDown={onKey}>
        <div role="row" className={styles.row}>
          {Array.from({ length: 7 }, (_, col) => (
            <span key={col} role="columnheader" className={styles.weekday} aria-label={weekdayName(col, 'long')}>
              {weekdayName(col, 'short')}
            </span>
          ))}
        </div>
        {grid.map((week) => (
          <div role="row" className={styles.row} key={dayKey(week[0])}>
            {week.map((day) => {
              const key = dayKey(day);
              const count = marks.counts.get(key) ?? 0;
              const isCursor = sameDay(day, cursor);
              const inMonth = day.m === cursor.m;
              const hasNote = marks.notes.has(noteTitle('day', day));
              const label = count > 0 ? `${longName(day)}, ${t('qolSearch.daily.pages', { count })}` : longName(day);
              return (
                <span role="gridcell" key={key} aria-selected={isCursor}>
                  <button
                    type="button"
                    ref={isCursor ? focused : undefined}
                    className={styles.day}
                    data-outside={inMonth ? undefined : 'true'}
                    data-today={sameDay(day, now) ? 'true' : undefined}
                    data-selected={isCursor ? 'true' : undefined}
                    tabIndex={isCursor ? 0 : -1}
                    aria-label={label}
                    aria-current={sameDay(day, now) ? 'date' : undefined}
                    onClick={() => {
                      setCursor(day);
                      void open('day', day);
                    }}
                  >
                    <span className={styles.number}>{day.d}</span>
                    {count > 0 && (
                      <span className={styles.count} data-note={hasNote ? 'true' : undefined}>
                        <span className={styles.dot} aria-hidden="true" />
                        {t('qolSearch.daily.pages', { count })}
                      </span>
                    )}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className={styles.periods}>
        <Button variant="secondary" onClick={() => void open('day', cursor)}>
          {t('qolSearch.daily.openDay', { title: noteTitle('day', cursor) })}
        </Button>
        <Button variant="secondary" onClick={() => void open('week', cursor)}>
          {t('qolSearch.daily.openWeek', { title: noteTitle('week', cursor) })}
        </Button>
        <Button variant="secondary" onClick={() => void open('month', cursor)}>
          {t('qolSearch.daily.openMonth', { title: noteTitle('month', cursor) })}
        </Button>
        <Button variant="secondary" onClick={() => void open('year', cursor)}>
          {t('qolSearch.daily.openYear', { title: noteTitle('year', cursor) })}
        </Button>
        <Button variant="quiet" aria-expanded={editing} onClick={() => setEditing((was) => !was)}>
          {t('qolSearch.daily.templates')}
        </Button>
      </div>
      {editing && <TemplateEditor onSaved={() => setVersion((was) => was + 1)} />}
    </Dialog>
  );
}
