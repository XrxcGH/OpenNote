// Upcoming (Phase 10): what is due, in Overdue, Today, This week, and Later. A task is added in plain words ("Read
// chapter 4 Fri 5 PM"), and the date found shows beside it, so a wrong guess is easy to see. Tasks can repeat: checking
// one off makes the next, and Skip this one makes the next without finishing. Dates written on pages ("- [ ] Read by
// Friday") appear here too. A calendar file (.ics) adds classes, exams, and assignments, and can be updated later.
// Items stay on this device. Nothing here counts, scores, or nags.
import { useMemo, useState } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { findDue, firstDue, followingItem, groupUpcoming, parseRepeat } from '../upcoming';
import type { GroupContext, Repeat, UpcomingGroupId, UpcomingItem } from '../upcoming';
import { dateIn } from '../upcoming/zone';
import { openPage } from '../../search';
import { commandContext } from '../../../commands/registry';
import { UpcomingCalendar } from './UpcomingCalendar';
import type { CalendarMode } from './UpcomingCalendar';
import { loadStored, saveStored } from './storage';
import { CalendarFile } from './CalendarFile';
import { Groups } from './UpcomingList';
import { setPageItemDone } from './pageCheckOff';
import { RemindersSwitch } from './RemindersSwitch';
import { Overview } from './UpcomingOverview';
import { Planner } from './UpcomingPlanner';
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

function context(): GroupContext {
  return { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

type View = 'list' | CalendarMode;
const VIEWS: readonly View[] = ['list', 'week', 'month'];

type RepeatChoice = 'none' | 'daily' | 'weekly' | 'afterDays';

function repeatOf(choice: RepeatChoice, days: number): Repeat | undefined {
  if (choice === 'daily') return { every: 1, unit: 'day', mode: 'schedule' };
  if (choice === 'weekly') return { every: 1, unit: 'week', mode: 'schedule' };
  if (choice === 'afterDays')
    return { every: Math.min(365, Math.max(1, Math.round(days) || 1)), unit: 'day', mode: 'afterFinish' };
  return undefined;
}

export function UpcomingTool() {
  const [saved, setSaved] = useState(readSaved);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>('none');
  const [repeatDays, setRepeatDays] = useState('3');
  const [view, setView] = useState<View>('list');
  const [chosen, setChosen] = useState(() => dateIn(Date.now(), context().timeZone));
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
    // Words such as "every weekday" or "monthly on the 1st" set the repeat and are taken out of the title.
    const typed = parseRepeat(title);
    const words = typed ? typed.rest : title;
    const found = words ? findDue(words, context()) : null;
    const due = found?.due ?? (typed ? firstDue(typed.repeat, today()) : null);
    const repeat = typed ? typed.repeat : found ? repeatOf(repeatChoice, Number(repeatDays)) : undefined;
    const item: UpcomingItem = {
      id: `u${saved.next}`,
      title: (found?.title.trim() || words).trim() || title,
      due,
      done: false,
      ...(repeat ? { repeat } : {}),
    };
    update({ items: [...saved.items, item], next: saved.next + 1 });
    setText('');
    setNote(due ? '' : repeatChoice === 'none' ? t('smart.tools.upcoming.undated') : t('study.repeat.needsDate'));
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
  /** Left and Right move between the views, as in any tab strip. */
  const moveTab = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = VIEWS[(VIEWS.indexOf(view) + step + VIEWS.length) % VIEWS.length];
    setView(next);
    document.getElementById(`upcoming-tab-${next}`)?.focus();
  };
  /** Checks a line on a page. The check goes into the page; a page that changed since is left alone. */
  const checkPage = (item: UpcomingItem, done: boolean) => {
    void setPageItemDone(item, done).then((result) => {
      const text =
        result === 'done'
          ? t(done ? 'study.dueDates.checkedOff' : 'study.dueDates.reopened', { title: item.title })
          : t(result === 'moved' ? 'study.dueDates.moved' : 'study.dueDates.checkFailed', { title: item.title });
      setNote(result === 'done' ? '' : text);
      announce(text);
    });
  };
  const checkAny = (item: UpcomingItem, done: boolean) =>
    item.page ? checkPage(item, done) : change(item.id, { done });
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
      <div className={styles.tabs} role="tablist" aria-label={t('study.views.views')} onKeyDown={moveTab}>
        {VIEWS.map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            id={`upcoming-tab-${one}`}
            aria-selected={view === one}
            aria-controls="upcoming-panel"
            tabIndex={view === one ? 0 : -1}
            className={styles.tab}
            onClick={() => setView(one)}
          >
            {t(`study.views.tabs.${one}`)}
          </button>
        ))}
      </div>
      <div id="upcoming-panel" role="tabpanel" aria-labelledby={`upcoming-tab-${view}`} className={styles.tool}>
        {view === 'list' ? (
          <>
            {groupsShown.length === 0 ? <p className={styles.empty}>{t('smart.tools.upcoming.empty')}</p> : null}
            <Groups
              groups={groups}
              shown={groupsShown}
              onChange={change}
              onSkip={(id) => advance(id, false)}
              onCheckPage={checkPage}
              onNote={setNote}
            />
          </>
        ) : (
          <UpcomingCalendar
            mode={view}
            items={everything}
            selected={chosen}
            onSelect={setChosen}
            onCheck={checkAny}
            onOpenPage={(item) => {
              if (item.page) void openPage(commandContext('palette').notes, item.page.id);
            }}
          />
        )}
      </div>
      <Planner />
      <RemindersSwitch />
    </div>
  );
}
