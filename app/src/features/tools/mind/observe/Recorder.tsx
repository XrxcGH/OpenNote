// A live session recorder beside the observation tool's fields. A running clock (monotonic, from performance.now)
// can be paused. Each behavior in the ethogram has a button and a number key, and each press adds a line to the
// session log. Pressing a running state's key again stops it. Finish puts the elapsed time in the session length.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../../../ui';
import { numText } from '../kit/format';
import { MindError } from '../kit/types';
import { say } from '../ui/insert';
import type { ExtraProps } from '../ui/ToolPanel';
import styles from '../ui/mind.module.css';
import { readEthogram, type Behavior } from './engine';

/** The monotonic clock in milliseconds; read only in event handlers and timers. */
const clockMs = (): number => performance.now();

function ethogramOf(text: string): Behavior[] {
  try {
    return readEthogram(text);
  } catch (error) {
    if (error instanceof MindError) return [];
    throw error;
  }
}

/** A stopwatch: seconds so far, whether it runs, and start, pause, and reset. */
function useStopwatch() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const since = useRef(0);
  const banked = useRef(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed(banked.current + (clockMs() - since.current) / 1000), 100);
    return () => clearInterval(timer);
  }, [running]);
  const now = () => (running ? banked.current + (clockMs() - since.current) / 1000 : banked.current);
  return {
    running,
    elapsed,
    now,
    start: () => {
      since.current = clockMs();
      setRunning(true);
    },
    pause: () => {
      banked.current = now();
      setElapsed(banked.current);
      setRunning(false);
    },
    reset: () => {
      banked.current = 0;
      setElapsed(0);
      setRunning(false);
    },
  };
}

/** The states running after a press: a second press stops one; a start ends the others in its group. */
function statesAfter(states: readonly string[], b: Behavior, all: readonly Behavior[]): string[] {
  if (states.includes(b.name)) return states.filter((s) => s !== b.name);
  const others = b.group === '' ? [] : all.filter((o) => o.group === b.group).map((o) => o.name);
  return [...states.filter((s) => !others.includes(s)), b.name];
}

function BehaviorButtons(props: {
  behaviors: readonly Behavior[];
  states: readonly string[];
  running: boolean;
  onMark: (b: Behavior) => void;
}) {
  return (
    <div className={styles.row}>
      {props.behaviors.map((b, i) => (
        <Button
          key={b.name}
          variant="quiet"
          disabled={!props.running}
          aria-pressed={b.kind === 'state' ? props.states.includes(b.name) : undefined}
          aria-keyshortcuts={String(i + 1)}
          onClick={() => props.onMark(b)}
        >
          {say('kitMind.observe.live.behavior', { name: b.name, key: i + 1 })}
        </Button>
      ))}
    </div>
  );
}

export default function Recorder({ texts, setText }: ExtraProps) {
  const behaviors = ethogramOf(texts.ethogram ?? '').slice(0, 9);
  const clock = useStopwatch();
  const [states, setStates] = useState<readonly string[]>([]);
  const log = useRef<string[]>([]);
  if (texts.mode !== 'session' && texts.mode !== 'intervals') return null;

  const toggle = () => {
    if (clock.running) return clock.pause();
    if (clock.elapsed === 0) {
      log.current = [];
      setStates([]);
    }
    clock.start();
  };
  const mark = (b: Behavior) => {
    if (!clock.running) return;
    const t = numText(Math.round(clock.now() * 10) / 10, 6);
    const stopping = b.kind === 'state' && states.includes(b.name);
    log.current.push(`${t} | ${b.name}${stopping ? ' | stop' : ''}`);
    if (b.kind === 'state') setStates(statesAfter(states, b, behaviors));
    setText('log', log.current.join('\n'));
  };
  const finish = () => {
    setText('session', numText(Math.max(1, Math.ceil(clock.now())), 6));
    clock.reset();
    setStates([]);
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    const n = Number(event.key);
    if (!Number.isInteger(n) || n < 1 || n > behaviors.length) return;
    event.preventDefault();
    mark(behaviors[n - 1]);
  };
  const toggleWord = clock.running ? 'pause' : clock.elapsed > 0 ? 'resume' : 'start';

  return (
    <section className={styles.section} aria-label={say('kitMind.observe.live.title')} onKeyDown={onKey}>
      <h3 className={styles.heading}>{say('kitMind.observe.live.title')}</h3>
      <p>{say('kitMind.observe.live.help')}</p>
      <div className={styles.row}>
        <span role="timer" aria-live="off" className={styles.number}>
          {say('kitMind.observe.live.clock', { t: numText(Math.floor(clock.elapsed * 10) / 10, 6) })}
        </span>
        <Button onClick={toggle}>{say(`kitMind.observe.live.${toggleWord}`)}</Button>
        <Button variant="quiet" onClick={finish} disabled={clock.elapsed === 0 && !clock.running}>
          {say('kitMind.observe.live.finish')}
        </Button>
      </div>
      <BehaviorButtons behaviors={behaviors} states={states} running={clock.running} onMark={mark} />
    </section>
  );
}
