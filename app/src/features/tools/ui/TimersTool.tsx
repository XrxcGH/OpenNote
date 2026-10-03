// Timers (Phase 10): countdowns, stopwatches with laps, and focus timers with work and break lengths. Several can
// run at once. A timer counts by the clock, so it stays right across sleep, and one that ended while the computer
// slept shows as finished on waking. There are no streaks, totals, or history, and nothing makes a sound or a
// notice on its own: a finished timer says so here, and politely to a screen reader.
import { useEffect, useReducer, useRef, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { createTimers, restoreTimerSet, systemClock } from '../timers';
import type { TimerConfig, TimerKind, TimerView, Timers } from '../timers';
import { loadStored, saveStored } from './storage';
import styles from './tools.module.css';

const STORE = 'timers';
let shared: Timers | null = null;

/** The one set of timers for this window, restored from the device and saved after every change. */
function timersForWindow(): Timers {
  if (!shared) {
    shared = createTimers(systemClock(), restoreTimerSet(loadStored(STORE, null)));
    const timers = shared;
    timers.subscribe(() => saveStored(STORE, timers.snapshot()));
  }
  return shared;
}

/** Hours, minutes, and seconds: 1:05:09, or 5:09 under an hour. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

const stopwatchText = (ms: number) => clockText(Math.floor(ms / 1000) * 1000);

function TimerCard({ view, timers }: { view: TimerView; timers: Timers }) {
  const shown = view.kind === 'stopwatch' ? stopwatchText(view.elapsedMs) : clockText(view.leftMs ?? 0);
  const phase = view.focus
    ? t(view.focus.phase === 'work' ? 'smart.tools.timers.phaseWork' : 'smart.tools.timers.phaseBreak', {
        cycle: view.focus.cycle,
        cycles: view.focus.cycles,
      })
    : null;
  const act = (action: Parameters<Timers['act']>[1]) => () => timers.act(view.id, action);
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
  const finished = useRef(new Set<string>());
  useEffect(() => timers.subscribe(refresh), [timers]);
  // Check again when something is due to change; a timer's own wake time is the soonest of them.
  useEffect(() => {
    const interval = setInterval(refresh, 250);
    return () => clearInterval(interval);
  }, []);
  const views = timers.views();
  useEffect(() => {
    for (const view of views) {
      if (view.status === 'done' && !finished.current.has(view.id)) {
        finished.current.add(view.id);
        announce(t('smart.tools.timers.finished', { name: view.label }));
      } else if (view.status !== 'done') finished.current.delete(view.id);
    }
  });

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
