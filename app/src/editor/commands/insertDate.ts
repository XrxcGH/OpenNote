// Date and time (ARCHITECTURE.md section 18.3; owner: WP4). Alt+Shift+D, T, and F type the date ("Sep 30, 2026"),
// the time ("2:05 PM"), or both. They use Phase 2's formatters and type plain text in the current marks.
import { formatDate, formatTime } from '../../strings/format';
import { fromChange } from './command';
import type { Command } from './command';

export type DateTimeKind = 'date' | 'time' | 'dateTime';

/** The text a kind inserts for the moment `now`. */
export function dateTimeText(kind: DateTimeKind, now: Date = new Date()): string {
  const iso = now.toISOString();
  if (kind === 'date') return formatDate(iso);
  if (kind === 'time') return formatTime(iso);
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

export function insertDateTime(kind: DateTimeKind, now: Date = new Date()): Command {
  return fromChange((tr) => {
    const { $from } = tr.selection;
    if (!$from.parent.isTextblock) return false;
    // A space first when the text before it ends in a word or a mark, so the value never runs into it.
    const before = tr.doc.textBetween(Math.max($from.start(), tr.selection.from - 1), tr.selection.from);
    const gap = before !== '' && !/\s/.test(before) ? ' ' : '';
    tr.insertText(gap + dateTimeText(kind, now), tr.selection.from, tr.selection.to);
    return true;
  });
}
