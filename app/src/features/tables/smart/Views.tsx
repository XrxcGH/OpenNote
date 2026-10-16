// Board, calendar, gallery, and timeline views of a smart table (Further features, Phase 7), shown under the table.
// A card is a row. Dragging a card to another lane or day edits that cell, and so does the keyboard: Alt with the
// arrow keys moves a card to the next lane or day. Each card has a Move control for a pen or screen reader too.
import { useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import type { Locale } from '../engine';
import type { ViewKind, ViewSmart } from './data';
import { VIEW_KINDS } from './data';
import type { SmartModel } from './model';
import styles from './views.module.css';
import {
  barsOf,
  cellText,
  dayAt,
  dayText,
  defaultColumns,
  lanesOf,
  monthOf,
  monthWeeks,
  neighborLane,
  rowsByDay,
  shiftMonth,
} from './viewLogic';
import type { Month } from './viewLogic';

export interface ViewsProps {
  model: SmartModel;
  locale: Locale;
  view: ViewSmart | undefined;
  choose(view: ViewSmart | null): void;
  setCell(row: number, column: number, text: string): Promise<boolean>;
  announce(text: string): void;
}

type Pick = 'group' | 'date' | 'end' | 'title';
const PICKS: Record<ViewKind, readonly Pick[]> = {
  board: ['title', 'group'],
  calendar: ['title', 'date'],
  gallery: ['title'],
  timeline: ['title', 'date', 'end'],
};

function columnOf(props: ViewsProps, pick: Pick): number | null {
  const wanted = props.view?.[pick];
  const found = wanted ? props.model.columnIds.indexOf(wanted) : -1;
  if (found >= 0) return found;
  const defaults = defaultColumns(props.model);
  return pick === 'title'
    ? defaults.title
    : pick === 'group'
      ? defaults.group
      : pick === 'date'
        ? defaults.date
        : defaults.end;
}

function Controls(props: ViewsProps) {
  const { view, model } = props;
  if (!view) return null;
  return (
    <div className={styles.controls}>
      {PICKS[view.kind].map((pick) => (
        <label key={pick} className={styles.field}>
          {t(`smart.views.pick.${pick}`)}
          <select
            value={columnOf(props, pick) ?? ''}
            onChange={(event) => {
              const value = event.target.value === '' ? undefined : model.columnIds[Number(event.target.value)];
              const next = { ...view };
              if (value === undefined) delete next[pick];
              else next[pick] = value;
              props.choose(next);
            }}
          >
            {pick === 'end' ? <option value="">{t('smart.views.noEnd')}</option> : null}
            {model.names.map((name, index) => (
              <option key={model.columnIds[index]} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

interface CardProps {
  props: ViewsProps;
  row: number;
  title: number;
  onKey?(event: KeyboardEvent): void;
  extra?: readonly number[];
  children?: React.ReactNode;
}

function Card({ props, row, title, onKey, extra = [], children }: CardProps) {
  const name = cellText(props.model, row, title, props.locale) || t('smart.views.untitled');
  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.cardButton}
        draggable
        aria-label={name}
        onDragStart={(event: DragEvent) => event.dataTransfer.setData('text/plain', String(row))}
        onKeyDown={onKey}
      >
        <strong>{name}</strong>
        {extra.map((column) => {
          const text = cellText(props.model, row, column, props.locale);
          return text ? (
            <span key={column} className={styles.fieldLine}>
              {props.model.names[column]}: {text}
            </span>
          ) : null;
        })}
      </button>
      {children}
    </div>
  );
}

const rowOf = (event: DragEvent): number => Number(event.dataTransfer.getData('text/plain'));

function Board(props: ViewsProps) {
  const title = columnOf(props, 'title') ?? 0;
  const group = columnOf(props, 'group');
  if (group === null) return <p className={styles.note}>{t('smart.views.needGroup')}</p>;
  const lanes = lanesOf(props.model, group, props.locale);
  const move = async (row: number, value: string) => {
    if (await props.setCell(row, group, value)) {
      props.announce(
        t('smart.views.movedLane', {
          card: cellText(props.model, row, title, props.locale),
          lane: value || t('smart.views.noValue'),
        }),
      );
    }
  };
  const others = props.model.names
    .map((_n, index) => index)
    .filter((index) => index !== title && index !== group)
    .slice(0, 2);
  return (
    <div className={styles.board}>
      {lanes.map((lane) => (
        <section
          key={lane.value || 'none'}
          className={styles.lane}
          aria-label={t('smart.views.lane', { lane: lane.value || t('smart.views.noValue'), count: lane.rows.length })}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void move(rowOf(event), lane.value);
          }}
        >
          <h4 className={styles.laneTitle}>
            {lane.value || t('smart.views.noValue')} <span className={styles.count}>{lane.rows.length}</span>
          </h4>
          {lane.rows.map((row) => (
            <Card
              key={row}
              props={props}
              row={row}
              title={title}
              extra={others}
              onKey={(event) => {
                const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                if (!event.altKey || step === 0) return;
                event.preventDefault();
                const next = neighborLane(lanes, lane.value, step);
                if (next) void move(row, next.value);
              }}
            >
              <select
                className={styles.move}
                aria-label={t('smart.views.moveTo', { card: cellText(props.model, row, title, props.locale) })}
                value={lane.value}
                onChange={(event) => void move(row, event.target.value)}
              >
                {lanes.map((one) => (
                  <option key={one.value || 'none'} value={one.value}>
                    {one.value || t('smart.views.noValue')}
                  </option>
                ))}
              </select>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}

function Calendar(props: ViewsProps) {
  const title = columnOf(props, 'title') ?? 0;
  const dateColumn = columnOf(props, 'date');
  const days = dateColumn === null ? null : rowsByDay(props.model, dateColumn);
  const first = days ? Math.min(...days.keys()) : Infinity;
  const [month, setMonth] = useState<Month | null>(null);
  const [today] = useState(() => Math.floor(Date.now() / 86_400_000));
  if (dateColumn === null || days === null) return <p className={styles.note}>{t('smart.views.needDate')}</p>;
  const at = month ?? monthOf(Number.isFinite(first) ? first : today);
  const move = async (row: number, day: number) => {
    if (await props.setCell(row, dateColumn, dayText(day))) {
      props.announce(
        t('smart.views.movedDay', { card: cellText(props.model, row, title, props.locale), day: dayText(day) }),
      );
    }
  };
  const label = new Date(Date.UTC(at.year, at.month - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <div className={styles.calendar}>
      <div className={styles.controls}>
        <button type="button" className={styles.nav} onClick={() => setMonth(shiftMonth(at, -1))}>
          {t('smart.views.previousMonth')}
        </button>
        <strong role="status">{label}</strong>
        <button type="button" className={styles.nav} onClick={() => setMonth(shiftMonth(at, 1))}>
          {t('smart.views.nextMonth')}
        </button>
      </div>
      <div className={styles.week} aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((d) => (
          <span key={d}>
            {new Date(Date.UTC(2023, 0, 1 + d)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}
          </span>
        ))}
      </div>
      {monthWeeks(at).map((week) => (
        <div key={week[0]} className={styles.week}>
          {week.map((day) => (
            <div
              key={day}
              className={styles.day}
              data-outside={monthOf(day).month !== at.month ? '' : undefined}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void move(rowOf(event), day);
              }}
            >
              <span className={styles.dayNumber}>{new Date(Date.UTC(1970, 0, 1 + day)).getUTCDate()}</span>
              {(days.get(day) ?? []).map((row) => (
                <Card
                  key={row}
                  props={props}
                  row={row}
                  title={title}
                  onKey={(event) => {
                    const step =
                      event.key === 'ArrowLeft'
                        ? -1
                        : event.key === 'ArrowRight'
                          ? 1
                          : event.key === 'ArrowUp'
                            ? -7
                            : event.key === 'ArrowDown'
                              ? 7
                              : 0;
                    if (!event.altKey || step === 0) return;
                    event.preventDefault();
                    void move(row, day + step);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
      <p className={styles.note}>{t('smart.views.calendarKeys')}</p>
    </div>
  );
}

function Gallery(props: ViewsProps) {
  const title = columnOf(props, 'title') ?? 0;
  const others = props.model.names.map((_n, index) => index).filter((index) => index !== title);
  return (
    <div className={styles.gallery}>
      {props.model.shown.map((row) => (
        <Card key={row} props={props} row={row} title={title} extra={others} />
      ))}
      {props.model.shown.length === 0 ? <p className={styles.note}>{t('smart.views.empty')}</p> : null}
    </div>
  );
}

function Timeline(props: ViewsProps) {
  const title = columnOf(props, 'title') ?? 0;
  const start = columnOf(props, 'date');
  const end = columnOf(props, 'end');
  if (start === null) return <p className={styles.note}>{t('smart.views.needDate')}</p>;
  const { bars, first, last } = barsOf(props.model, start, end);
  if (bars.length === 0) return <p className={styles.note}>{t('smart.views.empty')}</p>;
  const span = Math.max(1, last - first + 1);
  const shift = async (row: number, by: number, which: 'both' | 'end') => {
    const bar = bars.find((one) => one.row === row)!;
    const writeEnd = end !== null && (which === 'end' || dayAt(props.model, row, end) !== null);
    let ok = true;
    if (which === 'both') ok = await props.setCell(row, start, dayText(bar.start + by));
    if (ok && writeEnd)
      ok = await props.setCell(row, end, dayText(Math.max(bar.start + (which === 'both' ? by : 0), bar.end + by)));
    if (ok)
      props.announce(
        t('smart.views.movedDay', {
          card: cellText(props.model, row, title, props.locale),
          day: dayText(bar.start + (which === 'both' ? by : 0)),
        }),
      );
  };
  return (
    <ol className={styles.timeline} aria-label={t('smart.views.timeline')}>
      {bars.map((bar) => {
        const name = cellText(props.model, bar.row, title, props.locale) || t('smart.views.untitled');
        return (
          <li
            key={bar.row}
            className={styles.bar}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
              if (!event.altKey || step === 0) return;
              event.preventDefault();
              void shift(bar.row, step, event.shiftKey ? 'end' : 'both');
            }}
          >
            <span className={styles.barName}>{name}</span>
            <div className={styles.track}>
              <button
                type="button"
                className={styles.span}
                style={{
                  insetInlineStart: `${((bar.start - first) / span) * 100}%`,
                  inlineSize: `${((bar.end - bar.start + 1) / span) * 100}%`,
                }}
                aria-label={t('smart.views.barLabel', { card: name, from: dayText(bar.start), to: dayText(bar.end) })}
              />
            </div>
            <button
              type="button"
              className={styles.nav}
              aria-label={t('smart.views.earlierNamed', { card: name })}
              onClick={() => void shift(bar.row, -1, 'both')}
            >
              {t('smart.views.earlier')}
            </button>
            <button
              type="button"
              className={styles.nav}
              aria-label={t('smart.views.laterNamed', { card: name })}
              onClick={() => void shift(bar.row, 1, 'both')}
            >
              {t('smart.views.later')}
            </button>
          </li>
        );
      })}
      <li className={styles.note}>{t('smart.views.timelineKeys')}</li>
    </ol>
  );
}

/** The view switch, and the view that is chosen. */
export function Views(props: ViewsProps) {
  const kind = props.view?.kind;
  return (
    <section className={styles.root} aria-label={t('smart.views.label')}>
      <div className={styles.controls}>
        <label className={styles.field}>
          {t('smart.views.view')}
          <select
            value={kind ?? ''}
            onChange={(event) =>
              props.choose(event.target.value === '' ? null : { kind: event.target.value as ViewKind })
            }
          >
            <option value="">{t('smart.views.table')}</option>
            {VIEW_KINDS.map((one) => (
              <option key={one} value={one}>
                {t(`smart.views.kinds.${one}`)}
              </option>
            ))}
          </select>
        </label>
        <Controls {...props} />
      </div>
      {kind === 'board' ? <Board {...props} /> : null}
      {kind === 'calendar' ? <Calendar {...props} /> : null}
      {kind === 'gallery' ? <Gallery {...props} /> : null}
      {kind === 'timeline' ? <Timeline {...props} /> : null}
    </section>
  );
}
