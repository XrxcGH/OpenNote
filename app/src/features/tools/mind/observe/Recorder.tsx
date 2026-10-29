// A live session recorder beside the observation tool's fields. A running clock (monotonic, from performance.now)
// can be paused; each behavior in the ethogram has a button and a number key, and each press adds a line to the
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

export default function Recorder({ texts, setText }: ExtraProps) {
  const shown = texts.mode === 'session' || texts.mode === 'intervals';
  const behaviors = ethogramOf(texts.ethogram ?? '').slice(0, 9);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [states, setStates] = useState<readonly string[]>([]);
  const since = useRef(0);
  const banked = useRef(0);
  const log = useRef<string[]>([]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed(banked.current + (clockMs() - since.current) / 1000), 100);
    return () => clearInterval(timer);
  }, [running]);

  if (!shown) return null;

  const now = () => (running ? banked.current + (clockMs() - since.current) / 1000 : banked.current);
  const write = () => setText('log', log.current.join('\n'));
  const toggle = () => {
    if (running) {
      banked.current = now();
      setElapsed(banked.current);
      setRunning(false);
      return;
    }
    if (banked.current === 0) {
      log.current = [];
      setStates([]);
    }
    since.current = clockMs();
    setRunning(true);
  };
  const mark = (b: Behavior) => {
    if (!running) return;
    const t = numText(Math.round(now() * 10) / 10, 6);
    if (b.kind === 'event') log.current.push(`${t} | ${b.name}`);
    else if (states.includes(b.name)) {
      log.current.push(`${t} | ${b.name} | stop`);
      setStates(states.filter((s) => s !== b.name));
    } else {
      log.current.push(`${t} | ${b.name}`);
      const others = b.group === '' ? [] : behaviors.filter((o) => o.group === b.group).map((o) => o.name);
      setStates([...states.filter((s) => !others.includes(s)), b.name]);
    }
    write();
  };
  const finish = () => {
    const total = now();
    setRunning(false);
    setText('session', numText(Math.max(1, Math.ceil(total)), 6));
    banked.current = 0;
    setElapsed(0);
    setStates([]);
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    const n = Number(event.key);
    if (!Number.isInteger(n) || n < 1 || n > behaviors.length) return;
    event.preventDefault();
    mark(behaviors[n - 1]);
  };

  return (
    <section className={styles.section} aria-label={say('kitMind.observe.live.title')} onKeyDown={onKey}>
      <h3 className={styles.heading}>{say('kitMind.observe.live.title')}</h3>
      <p>{say('kitMind.observe.live.help')}</p>
      <div className={styles.row}>
        <span role="timer" aria-live="off" className={styles.number}>
          {say('kitMind.observe.live.clock', { t: numText(Math.floor(elapsed * 10) / 10, 6) })}
        </span>
        <Button onClick={toggle}>
          {say(
            running
              ? 'kitMind.observe.live.pause'
              : elapsed > 0
                ? 'kitMind.observe.live.resume'
                : 'kitMind.observe.live.start',
          )}
        </Button>
        <Button variant="quiet" onClick={finish} disabled={elapsed === 0 && !running}>
          {say('kitMind.observe.live.finish')}
        </Button>
      </div>
      <div className={styles.row}>
        {behaviors.map((b, i) => (
          <Button
            key={b.name}
            variant="quiet"
            disabled={!running}
            aria-pressed={b.kind === 'state' ? states.includes(b.name) : undefined}
            aria-keyshortcuts={String(i + 1)}
            onClick={() => mark(b)}
          >
            {say('kitMind.observe.live.behavior', { name: b.name, key: i + 1 })}
          </Button>
        ))}
      </div>
    </section>
  );
}
