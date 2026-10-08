// Upcoming (Phase 10): what is due, in Overdue, Today, This week, and Later. A task is added in plain words ("Read
// chapter 4 Fri 5 PM"), and the date found shows beside it, so a wrong guess is easy to see. Tasks can repeat: checking
// one off makes the next, and Skip this one makes the next without finishing. Dates written on pages ("- [ ] Read by
// Friday") appear here too. A calendar file (.ics) adds classes, exams, and assignments, and can be updated later.
// Items stay on this device. Nothing here counts, scores, or nags.
import { useMemo, useState } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { dateKey, findDue, followingItem, groupUpcoming } from '../upcoming';
import type { Due, GroupContext, Repeat, UpcomingGroupId, UpcomingItem } from '../upcoming';
import { dateIn } from '../upcoming/zone';
import { loadStored, saveStored } from './storage';
import { CalendarFile, Overview, Planner, RemindersSwitch } from './UpcomingExtras';
import { pageItemsStore } from './upcomingStores';
import styles from './tools.module.css';
import extra from './extra.module.css';

const STORE = 'upcoming';
const GROUPS: readonly UpcomingGroupId[] = ['overdue', 'today', 'thisWeek', 'later'];

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

type RepeatChoice = 'none' | 'daily' | 'weekly' | 'afterDays';

function repeatOf(choice: RepeatChoice, days: number): Repeat | undefined {
  if (choice === 'daily') return { every: 1, unit: 'day', mode: 'schedule' };
  if (choice === 'weekly') return { every: 1, unit: 'week', mode: 'schedule' };
  if (choice === 'afterDays')
    return { every: Math.min(365, Math.max(1, Math.round(days) || 1)), unit: 'day', mode: 'afterFinish' };
  return undefined;
}

interface GroupsProps {
  groups: ReturnType<typeof groupUpcoming>;
  shown: readonly (UpcomingGroupId | 'undated')[];
  onChange(id: string, patch: Partial<UpcomingItem> | null): void;
  onSkip(id: string): void;
}

/** The groups that have something in them, each with its items. */
function Groups({ groups, shown, onChange, onSkip }: GroupsProps) {
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
                  disabled={Boolean(item.page)}
                  aria-label={t('smart.tools.upcoming.done', { title: item.title })}
                  onChange={(event) => onChange(item.id, { done: event.target.checked })}
                />
                <span className={styles.itemTitle}>
                  {item.title}
                  {item.page ? (
                    <span className={styles.note}> {t('study.dueDates.fromPage', { page: item.page.title })}</span>
                  ) : null}
                  {item.repeat ? <span className={styles.note}> {t('study.repeat.badge')}</span> : null}
                </span>
                {item.due ? (
                  <span className={styles.itemDue} title={dateKey(item.due.date)}>
                    {whenText(item.due)}
                  </span>
                ) : null}
                {item.repeat ? (
                  <Button
                    variant="quiet"
                    aria-label={t('study.repeat.skipNamed', { title: item.title })}
                    onClick={() => onSkip(item.id)}
                  >
                    {t('study.repeat.skip')}
                  </Button>
                ) : null}
                {item.page ? null : (
                  <Button
                    variant="quiet"
                    aria-label={t('smart.tools.upcoming.remove', { title: item.title })}
                    onClick={() => onChange(item.id, null)}
                  >
                    ×
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function UpcomingTool() {
  const [saved, setSaved] = useState(readSaved);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>('none');
  const [repeatDays, setRepeatDays] = useState('3');
  const pages = useStore(pageItemsStore, (current) => current);
  const pageItems = useMemo(() => Object.values(pages).flatMap((entry) => entry.items), [pages]);
  const everything = useMemo(() => [...saved.items, ...pageItems], [saved.items, pageItems]);
  const groups = useMemo(() => groupUpcoming(everything, context(), { includeDone: false }), [everything]);
  const update = (next: Saved) => {
    setSaved(next);
    saveStored(STORE, next);
  };

  const add = () => {
    const title = text.trim();
    if (!title) return;
    const found = findDue(title, context());
    const repeat = found ? repeatOf(repeatChoice, Number(repeatDays)) : undefined;
    const item: UpcomingItem = {
      id: `u${saved.next}`,
      title: found?.title.trim() || title,
      due: found?.due ?? null,
      done: false,
      ...(repeat ? { repeat } : {}),
    };
    update({ items: [...saved.items, item], next: saved.next + 1 });
    setText('');
    setNote(found ? '' : repeatChoice === 'none' ? t('smart.tools.upcoming.undated') : t('study.repeat.needsDate'));
    announce(t('smart.tools.upcoming.added'));
  };

  const today = () => dateIn(Date.now(), context().timeZone);

  /** Replaces the item with the one that follows it, or removes it when it does not repeat. */
  const advance = (id: string, finished: boolean) => {
    const item = saved.items.find((one) => one.id === id);
    if (!item) return;
    const following = followingItem(item, today(), `u${saved.next}`);
    const items = saved.items.flatMap((one) => {
      if (one.id !== id) return [one];
      if (finished)
        return following ? [{ ...one, done: true, repeat: undefined }, following] : [{ ...one, done: true }];
      return following ? [following] : [one];
    });
    update({ items, next: saved.next + (following ? 1 : 0) });
    if (following) announce(t('study.repeat.next', { title: item.title }));
  };

  const change = (id: string, patch: Partial<UpcomingItem> | null) => {
    if (patch?.done === true) return advance(id, true);
    update({
      ...saved,
      items: patch
        ? saved.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
        : saved.items.filter((item) => item.id !== id),
    });
  };
  const groupsShown = [...GROUPS, 'undated' as const].filter((id) => groups[id].length > 0);

  return (
    <div className={styles.tool}>
      <Overview />
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
        <div className={extra.pair}>
          <label className={extra.field}>
            {t('study.repeat.label')}
            <select
              className={extra.input}
              value={repeatChoice}
              onChange={(event) => setRepeatChoice(event.target.value as RepeatChoice)}
            >
              {(['none', 'daily', 'weekly', 'afterDays'] as const).map((one) => (
                <option key={one} value={one}>
                  {t(`study.repeat.choices.${one}`)}
                </option>
              ))}
            </select>
          </label>
          {repeatChoice === 'afterDays' ? (
            <label className={extra.field}>
              {t('study.repeat.days')}
              <input
                type="number"
                min={1}
                max={365}
                className={extra.input}
                value={repeatDays}
                onChange={(event) => setRepeatDays(event.target.value)}
              />
            </label>
          ) : null}
        </div>
        <div className={styles.buttons}>
          <Button type="submit" variant="primary">
            {t('smart.tools.upcoming.add')}
          </Button>
          <CalendarFile items={saved.items} onItems={(items) => update({ ...saved, items })} setNote={setNote} />
        </div>
      </form>
      {note ? (
        <p className={styles.note} role="status">
          {note}
        </p>
      ) : null}
      {groupsShown.length === 0 ? <p className={styles.empty}>{t('smart.tools.upcoming.empty')}</p> : null}
      <Groups groups={groups} shown={groupsShown} onChange={change} onSkip={(id) => advance(id, false)} />
      <Planner />
      <RemindersSwitch />
    </div>
  );
}
