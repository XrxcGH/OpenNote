// A repeat in words, for the badge beside a to-do: "every weekday", "every 2 weeks", "every Monday and Wednesday".
import { t } from '../../../strings/t';
import type { Repeat } from '../upcoming';
import { longDay } from './upcomingShared';

export function repeatWords(repeat: Repeat): string {
  const count = repeat.every;
  if (repeat.unit === 'weekday') return t('study.repeat.when.weekday');
  if (repeat.unit === 'day') return t('study.repeat.when.day', { count });
  if (repeat.unit === 'week') {
    if (repeat.days && repeat.days.length > 0) {
      const days = new Intl.ListFormat(undefined, { type: 'conjunction' }).format(repeat.days.map(longDay));
      return t('study.repeat.when.weekOn', { days });
    }
    return t('study.repeat.when.week', { count });
  }
  const base = t('study.repeat.when.month', { count });
  if (repeat.dayOfMonth === -1) return t('study.repeat.when.monthLast', { base });
  return repeat.dayOfMonth ? t('study.repeat.when.monthOn', { base, day: repeat.dayOfMonth }) : base;
}

/** The badge text for a repeating item: the words, or just "repeats" for one that counts from when it is finished. */
export const repeatBadge = (repeat: Repeat): string =>
  repeat.mode === 'afterFinish' ? t('study.repeat.badge') : t('study.repeat.badgeWhen', { when: repeatWords(repeat) });
