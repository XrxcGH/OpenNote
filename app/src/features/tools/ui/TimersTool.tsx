// Timers (Phase 10): countdowns, stopwatches with laps, and focus timers with work and break lengths. Several can
// run at once. A timer counts by the clock, so it stays right across sleep, and one that ended while the computer
// slept shows as finished on waking. There are no streaks, totals, or history, and nothing makes a sound. A finished
// timer says so politely to a screen reader, and shows a Windows notification only if the person asked for one for
// that timer (timerWatch.ts, which also works when this window is closed).
import { useEffect, useReducer, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, Switch, TextField } from '../../../ui';
import type { TimerConfig, TimerKind, TimerView, Timers } from '../timers';
import { enableReminders, remindersOn } from './notify';
import { clockText, stopwatchText, timersForWindow } from './timerSet';
import styles from './tools.module.css';

export { clockText };

function TimerCard({ view, timers }: { view: TimerView; timers: Timers }) {
  const shown = view.kind === 'stopwatch' ? stopwatchText(view.elapsedMs) : clockText(view.leftMs ?? 0);
  const phase = view.focus
    ? t(view.focus.phase === 'work' ? 'smart.tools.timers.phaseWork' : 'smart.tools.timers.phaseBreak', {
        cycle: view.focus.cycle,
        cycles: view.focus.cycles,
      })
    : null;
  const act = (action: Parameters<Timers['act']>[1]) => () => timers.act(view.id, action);
  const [blocked, setBlocked] = useState(false);
  const chooseNotify = async (next: boolean) => {
    if (next && !remindersOn() && !(await enableReminders())) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    timers.setNotify(view.id, next);
  };
  return (
    <li className={styles.card} data-status={view.status}>
      <div className={styles.cardHead}>
        <span className={styles.cardName}>{view.label}</span>
        <span className={styles.status}>{t(`smart.tools.timers.status.${view.status}`)}</span>
      </div>
      <div className={styles.time} role="timer" aria-label={view.label}>
        {shown}
      </div>
      {phase ? <div className={styles.phase}>{phase}</div> : null}
      <Switch
        label={t('smart.tools.timers.notify', { name: view.label })}
        checked={view.notify}
        onChange={chooseNotify}
      />
      {blocked ? <p className={styles.note}>{t('study.reminders.blocked')}</p> : null}
      <div className={styles.buttons}>
        {view.status === 'idle' ? <Button onClick={act('start')}>{t('smart.tools.timers.start')}</Button> : null}
        {view.status === 'running' ? <Button onClick={act('pause')}>{t('smart.tools.timers.pause')}</Button> : null}
        {view.status === 'running' && view.kind === 'stopwatch' ? (
          <Button variant="quiet" onClick={act('lap')}>
            {t('smart.tools.timers.lap')}
          </Button>
        ) : null}
        {view.status === 'paused' ? <Button onClick={act('resume')}>{t('smart.tools.timers.resume')}</Button> : null}
        {view.status !== 'idle' ? (
          <Button variant="quiet" onClick={act('reset')}>
            {t('smart.tools.timers.reset')}
          </Button>
        ) : null}
        <Button
          variant="quiet"
          aria-label={t('smart.tools.timers.remove', { name: view.label })}
          onClick={() => timers.remove(view.id)}
        >
          ×
        </Button>
      </div>
      {view.laps.length > 0 ? (
        <ol className={styles.laps} aria-label={t('smart.tools.timers.laps')}>
          {view.laps.map((lap, index) => (
            <li key={index}>{t('smart.tools.timers.lapEntry', { number: index + 1, time: stopwatchText(lap) })}</li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function NewTimer({ timers, count }: { timers: Timers; count: number }) {
  const [kind, setKind] = useState<TimerKind>('countdown');
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('5');
  const [seconds, setSeconds] = useState('0');
  const [work, setWork] = useState('25');
  const [rest, setRest] = useState('5');
  const [rounds, setRounds] = useState('4');
  const [problem, setProblem] = useState(false);

  const add = () => {
    const number = (text: string) => Math.max(0, Number(text) || 0);
    let config: TimerConfig;
    if (kind === 'countdown') config = { kind, durationMs: (number(minutes) * 60 + number(seconds)) * 1000 };
    else if (kind === 'focus') {
      config = {
        kind,
        workMs: number(work) * 60_000,
        breakMs: number(rest) * 60_000,
        cycles: Math.max(1, Math.floor(number(rounds))),
      };
    } else config = { kind };
    const empty =
      (config.kind === 'countdown' && config.durationMs < 1000) || (config.kind === 'focus' && config.workMs < 1000);
    setProblem(empty);
    if (empty) return;
    timers.add(config, name.trim() || t('smart.tools.timers.defaultName', { number: count + 1 }));
    setName('');
  };

  return (
    <form
      className={styles.form}
      aria-label={t('smart.tools.timers.form')}
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <label className={styles.field}>
        <span>{t('smart.tools.timers.kind')}</span>
        <select value={kind} onChange={(event) => setKind(event.target.value as TimerKind)}>
          {(['countdown', 'stopwatch', 'focus'] as const).map((one) => (
            <option key={one} value={one}>
              {t(`smart.tools.timers.kinds.${one}`)}
            </option>
          ))}
        </select>
      </label>
      <TextField label={t('smart.tools.timers.name')} value={name} onChange={setName} />
      {kind === 'countdown' ? (
        <div className={styles.pair}>
          <TextField label={t('smart.tools.timers.minutes')} value={minutes} onChange={setMinutes} />
          <TextField label={t('smart.tools.timers.seconds')} value={seconds} onChange={setSeconds} />
        </div>
      ) : null}
      {kind === 'focus' ? (
        <div className={styles.pair}>
          <TextField label={t('smart.tools.timers.work')} value={work} onChange={setWork} />
          <TextField label={t('smart.tools.timers.rest')} value={rest} onChange={setRest} />
          <TextField label={t('smart.tools.timers.rounds')} value={rounds} onChange={setRounds} />
        </div>
      ) : null}
      {problem ? (
        <p className={styles.problem} role="status">
          {t('smart.tools.timers.tooLong')}
        </p>
      ) : null}
      <Button type="submit" variant="primary">
        {t('smart.tools.timers.add')}
      </Button>
    </form>
  );
}

export function TimersTool() {
  const [timers] = useState(timersForWindow);
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => timers.subscribe(refresh), [timers]);
  // Check again when something is due to change; a timer's own wake time is the soonest of them.
  useEffect(() => {
    const interval = setInterval(refresh, 250);
    return () => clearInterval(interval);
  }, []);
  const views = timers.views();

  return (
    <div className={styles.tool}>
      {views.length === 0 ? (
        <p className={styles.empty}>{t('smart.tools.timers.empty')}</p>
      ) : (
        <ul className={styles.cards}>
          {views.map((view) => (
            <TimerCard key={view.id} view={view} timers={timers} />
          ))}
        </ul>
      )}
      <NewTimer timers={timers} count={views.length} />
    </div>
  );
}
