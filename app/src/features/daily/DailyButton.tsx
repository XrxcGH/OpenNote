// The title bar's Today button: one press opens today's note, made from its template when it is the first visit.
import { CalendarCheckIcon } from '@phosphor-icons/react/dist/csr/CalendarCheck';
import { useFlag } from '../../app/flags';
import { executeCommand } from '../../commands/registry';
import { TitleBarMenuItem } from '../../shell/titlebar/TitleBarMenuItem';
import { t } from '../../strings/t';
import { IconButton } from '../../ui';

export function DailyButton({ presentation }: { presentation: 'full' | 'icon' | 'menuItem' }) {
  const on = useFlag('daily.notes');
  if (!on) return null;
  const run = () => void executeCommand('daily.open', undefined, 'titleBar');
  if (presentation === 'menuItem') {
    return <TitleBarMenuItem label={t('qolSearch.commands.dailyOpen')} command="daily.open" onPress={run} />;
  }
  return <IconButton label={t('qolSearch.commands.dailyOpen')} icon={CalendarCheckIcon} command="daily.open" onPress={run} />;
}
