// The list part of Upcoming: the groups that have something in them (Overdue, Today, This week, Later, and no
// date), each with its items. An item has a checkbox, its title and date, a reminder choice, Skip for a repeat, and
// a remove button. A line read from a page is owned by the page, so it can be reminded about but not removed.
import { useState } from 'react';
import { useFlag } from '../../../app/flags';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { dateKey } from '../upcoming';
import type { Due, UpcomingGroupId, UpcomingGroups, UpcomingItem } from '../upcoming';
import { chooseReminder, hasReminder } from './itemReminder';
import { readReminders } from './upcomingStores';
import styles from './tools.module.css';

export function whenText(due: Due): string {
  const day = new Date(due.date.year, due.date.month - 1, due.date.day);
  const date = day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (!due.time) return date;
  const time = new Date(2000, 0, 1, due.time.hour, due.time.minute).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date}, ${time}`;
}

export interface GroupsProps {
  groups: UpcomingGroups;
  shown: readonly (UpcomingGroupId | 'undated')[];
  onChange(id: string, patch: Partial<UpcomingItem> | null): void;
  onSkip(id: string): void;
  /** Says something in the note under the form, such as why a reminder cannot show. */
  onNote(text: string): void;
}

export function Groups({ groups, shown, onChange, onSkip, onNote }: GroupsProps) {
  const remindersAllowed = useFlag('tools.reminders');
  const [pageLines, setPageLines] = useState(() => readReminders().pageLines);

  const remind = async (item: UpcomingItem, on: boolean) => {
    const allowed = await chooseReminder(item, on);
    if (item.page) setPageLines(readReminders().pageLines);
    else onChange(item.id, { remind: on });
    if (!allowed) onNote(t('study.reminders.blocked'));
    else announce(t(on ? 'study.reminders.itemOn' : 'study.reminders.itemOff', { title: item.title }));
  };

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
                {remindersAllowed && item.due ? (
                  <Button
                    variant="quiet"
                    aria-pressed={hasReminder(item, pageLines)}
                    aria-label={t('study.reminders.itemNamed', { title: item.title })}
                    onClick={() => void remind(item, !hasReminder(item, pageLines))}
                  >
                    {t('study.reminders.item')}
                  </Button>
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
