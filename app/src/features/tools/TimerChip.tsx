// The title bar's timer chip: while a timer runs it shows the one that ends first and the time left, and pressing it
// opens Timers. It is a plain button, shows nothing when no timer runs, and never makes a sound.
import { TimerIcon } from '@phosphor-icons/react/dist/csr/Timer';
import { useEffect, useReducer } from 'react';
import { useFlag } from '../../app/flags';
import { executeCommand } from '../../commands/registry';
import { useStore } from '../../state/store';
import { TitleBarMenuItem } from '../../shell/titlebar/TitleBarMenuItem';
import { t } from '../../strings/t';
import { timerChip } from './ui/chipStore';
import styles from './ui/chip.module.css';

export function TimerChip({ presentation }: { presentation: 'full' | 'icon' | 'menuItem' }) {
  const on = useFlag('tools.windows');
  const { read } = useStore(timerChip, (state) => state);
  const [, tick] = useReducer((count: number) => count + 1, 0);
  const reading = on && read ? read() : null;
  const running = reading !== null;
  useEffect(() => {
    if (!running) return undefined;
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [running]);
  if (!reading) return null;
  const summary =
    reading.count > 1
      ? t('smart.tools.timers.chipMany', { count: reading.count })
      : t('smart.tools.timers.chip', { name: reading.label, time: reading.text });
  const open = () => void executeCommand('tools.timers', undefined, 'titleBar');
  if (presentation === 'menuItem') {
    return <TitleBarMenuItem label={summary} command="tools.timers" onPress={open} />;
  }
  return (
    <button
      type="button"
      className={styles.chip}
      aria-label={t('smart.tools.timers.chipOpen', { summary })}
      onClick={open}
    >
      <TimerIcon aria-hidden="true" />
      <span>{reading.text}</span>
    </button>
  );
}
