// Upcoming (Phase 10): what is due, in Overdue, Today, This week, and Later. A task is added in plain words ("Read
// chapter 4 Fri 5 PM"), and the date found shows beside it, so a wrong guess is easy to see. A calendar file (.ics)
// can be imported to add its events and to-dos. Items stay on this device. Nothing here counts, scores, or nags.
import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { addDays, dateKey, findDue, groupUpcoming, icsToItems, parseDateKey, parseIcs } from '../upcoming';
import type { Due, GroupContext, UpcomingGroupId, UpcomingItem } from '../upcoming';
import { loadStored, saveStored } from './storage';
import styles from './tools.module.css';

const STORE = 'upcoming';
const GROUPS: readonly UpcomingGroupId[] = ['overdue', 'today', 'thisWeek', 'later'];
/** Calendar files can repeat forever, so an import looks a year ahead and a month back. */
const IMPORT_AHEAD_DAYS = 365;
const IMPORT_BACK_DAYS = 31;

interface Saved {
  items: UpcomingItem[];
  next: number;
}

function readSaved(): Saved {
  const saved = loadStored<Partial<Saved>>(STORE, {});
  const items = Array.isArray(saved.items)
    ? saved.items.filter((item): item is UpcomingItem => typeof item?.id === 'string' && typeof item.title === 'string')
    : [];
  return { items, next: typeof saved.next === 'number' ? saved.next : items.length + 1 };
}

function whenText(due: Due): string {
  const day = new Date(due.date.year, due.date.month - 1, due.date.day);
  const date = day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (!due.time) return date;
  const time = new Date(2000, 0, 1, due.time.hour, due.time.minute).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date}, ${time}`;
}

function context(): GroupContext {
  return { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

interface GroupsProps {
  groups: ReturnType<typeof groupUpcoming>;
  shown: readonly (UpcomingGroupId | 'undated')[];
  onChange(id: string, patch: Partial<UpcomingItem> | null): void;
}

/** The groups that have something in them, each with its items. */
function Groups({ groups, shown, onChange }: GroupsProps) {
  return (
    <>
      {shown.map((id) => (
        <section key={id} aria-labelledby={`upcoming-${id}`} className={styles.group}>
          <h3 id={`upcoming-${id}`} className={styles.groupTitle}>
            {t(`smart.tools.upcoming.groups.${id}`)}
          </h3>
          <ul className={styles.items}>
            {groups[id].map((item) => (
              <li key={item.id} className={styles.item}>
                <input
                  type="checkbox"
                  checked={item.done}
                  aria-label={t('smart.tools.upcoming.done', { title: item.title })}
                  onChange={(event) => onChange(item.id, { done: event.target.checked })}
                />
                <span className={styles.itemTitle}>{item.title}</span>
                {item.due ? (
                  <span className={styles.itemDue} title={dateKey(item.due.date)}>
                    {whenText(item.due)}
                  </span>
                ) : null}
                <Button
                  variant="quiet"
                  aria-label={t('smart.tools.upcoming.remove', { title: item.title })}
                  onClick={() => onChange(item.id, null)}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function UpcomingTool() {
  const [saved, setSaved] = useState(readSaved);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupUpcoming(saved.items, context(), { includeDone: false }), [saved.items]);
  const update = (next: Saved) => {
    setSaved(next);
    saveStored(STORE, next);
  };

  const add = () => {
    const title = text.trim();
    if (!title) return;
    const found = findDue(title, context());
    const item: UpcomingItem = {
      id: `u${saved.next}`,
      title: found?.title.trim() || title,
      due: found?.due ?? null,
      done: false,
    };
    update({ items: [...saved.items, item], next: saved.next + 1 });
    setText('');
    setNote(found ? '' : t('smart.tools.upcoming.undated'));
    announce(t('smart.tools.upcoming.added'));
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const calendar = parseIcs(await file.text());
      const ctx = context();
      const today = parseDateKey(new Date(ctx.now).toISOString().slice(0, 10))!;
      const range = { from: addDays(today, -IMPORT_BACK_DAYS), to: addDays(today, IMPORT_AHEAD_DAYS) };
      const known = new Set(saved.items.map((item) => item.id));
      const fresh = icsToItems(calendar, range, ctx.timeZone).filter((item) => !known.has(`ics:${item.id}`));
      const items = fresh.map((item) => ({ ...item, id: `ics:${item.id}` }));
      if (items.length === 0 && calendar.components.length === 0) throw new Error('empty');
      update({ ...saved, items: [...saved.items, ...items] });
      setNote(t('smart.tools.upcoming.imported', { count: items.length }));
      announce(t('smart.tools.upcoming.imported', { count: items.length }));
    } catch {
      setNote(t('smart.tools.upcoming.importFailed'));
    }
  };

  const change = (id: string, patch: Partial<UpcomingItem> | null) =>
    update({
      ...saved,
      items: patch
        ? saved.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
        : saved.items.filter((item) => item.id !== id),
    });
  const groupsShown = [...GROUPS, 'undated' as const].filter((id) => groups[id].length > 0);

  return (
    <div className={styles.tool}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <TextField
          label={t('smart.tools.upcoming.addLabel')}
          value={text}
          onChange={setText}
          help={t('smart.tools.upcoming.placeholder')}
        />
        <div className={styles.buttons}>
          <Button type="submit" variant="primary">
            {t('smart.tools.upcoming.add')}
          </Button>
          <Button variant="quiet" onClick={() => picker.current?.click()}>
            {t('smart.tools.upcoming.importFile')}
          </Button>
          <input
            ref={picker}
            type="file"
            accept=".ics,text/calendar"
            hidden
            onChange={(event) => void importFile(event)}
          />
        </div>
      </form>
      {note ? (
        <p className={styles.note} role="status">
          {note}
        </p>
      ) : null}
      {groupsShown.length === 0 ? <p className={styles.empty}>{t('smart.tools.upcoming.empty')}</p> : null}
      <Groups groups={groups} shown={groupsShown} onChange={change} />
    </div>
  );
}
