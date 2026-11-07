// Exporting Upcoming as a calendar file: the dated tasks, the exams, and the weekly classes, saved to a place the person
// chooses, to keep or to open in another calendar.
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { saveBytes } from '../../study';
import { writeIcs } from '../upcoming';
import type { ClassSlot, Exam, UpcomingItem } from '../upcoming';
import { dateIn } from '../upcoming/zone';
import { zone } from './upcomingShared';

interface ExportProps {
  items: readonly UpcomingItem[];
  exams: readonly Exam[];
  slots: readonly ClassSlot[];
  setNote(text: string): void;
}

export function CalendarExport({ items, exams, slots, setNote }: ExportProps) {
  const save = async () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const text = writeIcs({
      // A line of a page belongs to the page, so it is not written as an item of its own.
      items: items.filter((one) => !one.page),
      exams,
      classes: slots,
      today: dateIn(Date.now(), zone()),
      stamp,
    });
    try {
      const bytes = new TextEncoder().encode(text);
      const saved = await saveBytes(
        t('study.calendar.exportName'),
        t('study.calendar.exportLabel'),
        bytes,
        'text/calendar',
      );
      const words = t(saved ? 'study.calendar.exported' : 'study.calendar.exportCanceled');
      setNote(words);
      announce(words);
    } catch {
      setNote(t('study.calendar.exportFailed'));
    }
  };
  return (
    <Button variant="quiet" onClick={() => void save()}>
      {t('smart.tools.upcoming.exportFile')}
    </Button>
  );
}
