// The Upcoming section of Home: the next few things that are due, each with its day, and a button that opens the
// Upcoming window. It shows only the person's own items, and it says so plainly when there are none.
import { useEffect, useState } from 'react';
import { executeCommand } from '../../commands/registry';
import { commands } from '../../registries';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import type { UpcomingItem } from '../tools';
import styles from './Home.module.css';

const loadItems = async (): Promise<UpcomingItem[]> => (await import('../tools')).homeUpcoming();

function dayText(item: UpcomingItem): string {
  const due = item.due;
  if (!due) return '';
  const day = new Date(due.date.year, due.date.month - 1, due.date.day);
  return day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export interface UpcomingSectionProps {
  /** Where the items come from. Tests give their own. */
  load?: () => Promise<UpcomingItem[]>;
}

export function UpcomingSection({ load = loadItems }: UpcomingSectionProps) {
  const [items, setItems] = useState<UpcomingItem[] | null>(null);
  useEffect(() => {
    let current = true;
    void load().then(
      (list) => current && setItems(list),
      () => current && setItems([]),
    );
    return () => {
      current = false;
    };
  }, [load]);
  if (commands.get('tools.upcoming') === undefined) return <p className={styles.empty}>{t('qol.home.upcomingNone')}</p>;
  return (
    <>
      {items && items.length > 0 ? (
        <ul className={styles.list} aria-label={t('qol.home.upcomingList')}>
          {items.map((item) => (
            <li key={item.id} className={styles.upcomingItem}>
              <span>{item.title}</span>
              <span className={styles.path}>{dayText(item)}</span>
            </li>
          ))}
        </ul>
      ) : items ? (
        <p className={styles.empty}>{t('qol.home.upcomingEmpty')}</p>
      ) : null}
      <div className={styles.row}>
        <Button onClick={() => void executeCommand('tools.upcoming', undefined, 'commandBar')}>
          {t('qol.home.upcomingOpen')}
        </Button>
      </div>
    </>
  );
}
