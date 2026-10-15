// The person's own tasks in Upcoming, as the sync sees them: the items that are not read from a page, not from a calendar
// file or a course, not repeating, and not events. Those are the ones the person adds and ticks off themselves.
import { readUpcoming, updateUpcomingItems } from '../../tools';
import type { Due, UpcomingItem } from '../../tools';
import type { LocalTask, LocalTasks } from './types';

const two = (n: number): string => String(n).padStart(2, '0');

function isOwn(item: UpcomingItem): boolean {
  return !item.page && !item.source && !item.repeat && (item.kind ?? 'task') === 'task';
}

export function toLocal(item: UpcomingItem): LocalTask {
  return {
    id: item.id,
    title: item.title,
    done: item.done,
    date: item.due ? `${item.due.date.year}-${two(item.due.date.month)}-${two(item.due.date.day)}` : null,
    time: item.due?.time ? `${two(item.due.time.hour)}:${two(item.due.time.minute)}` : null,
  };
}

function dueOf(task: LocalTask): Due | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(task.date ?? '');
  if (!date) return null;
  const time = /^(\d{2}):(\d{2})$/.exec(task.time ?? '');
  return {
    date: { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) },
    time: time ? { hour: Number(time[1]), minute: Number(time[2]) } : null,
  };
}

export function upcomingTasks(): LocalTasks {
  return {
    read: () => readUpcoming().items.filter(isOwn).map(toLocal),
    write(put, remove) {
      updateUpcomingItems((items) => {
        const gone = new Set(remove);
        const incoming = new Map(put.map((task) => [task.id, task]));
        const next = items
          .filter((item) => !gone.has(item.id))
          .map((item) => {
            const task = incoming.get(item.id);
            if (!task) return item;
            incoming.delete(item.id);
            return { ...item, title: task.title, done: task.done, due: dueOf(task) };
          });
        for (const task of incoming.values()) {
          next.push({ id: task.id, title: task.title, done: task.done, due: dueOf(task), kind: 'task' });
        }
        return next;
      });
    },
  };
}
