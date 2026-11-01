// A drawing that moves: a slider through the frames of a sweep or a run, a Play button that steps through them, and
// a button that puts the frame on screen into the page as a picture. Nothing moves until a person presses Play.
import '../text';
import { useEffect, useId, useMemo, useState } from 'react';
import { Button, announce } from '../../../../ui';
import { PAGE, SCREEN } from '../kit/picture';
import type { Animation as Frames } from '../kit/spec';
import { fmt } from '../types';
import { pictureRequest, plotPicture, sendToPage, type Say } from './insert';
import styles from './mechdyn.module.css';

/** About a second and a half through 360 frames; slower for short runs. */
const TICK_MS = 40;

export function Animation({ tool, animation, say }: { tool: string; animation: Frames; say: Say }) {
  const { frames, at, values } = animation;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const sliderId = useId();
  const shown = Math.min(index, frames.length - 1);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % frames.length), TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, frames.length]);
  const frame = frames[shown];
  const svg = useMemo(() => plotPicture(say, frame, SCREEN), [say, frame]);
  const value = values[shown] ?? 0;
  const label =
    at === 'angle'
      ? say('kitMechDyn.ui.frameAngle', { value: fmt((value * 180) / Math.PI, 4) })
      : say('kitMechDyn.ui.frameTime', { value: fmt(value, 4) });
  const insert = () => {
    const ok = sendToPage({ picture: pictureRequest(plotPicture(say, frame, PAGE), `${tool}-frame.svg`, label) });
    announce(say(ok ? 'kitMechDyn.ui.inserted' : 'kitMechDyn.ui.noPage'));
  };
  return (
    <section className={styles.section} aria-label={say('kitMechDyn.ui.animation')}>
      <h3 className={styles.heading}>{say('kitMechDyn.ui.animation')}</h3>
      <figure className={styles.figure}>
        <div role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
        <figcaption className={styles.caption} aria-live={playing ? 'off' : 'polite'}>
          {label}
        </figcaption>
      </figure>
      <div className={styles.row}>
        <div className={`${styles.field} ${styles.wide}`}>
          <label htmlFor={sliderId}>{say('kitMechDyn.ui.frame')}</label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={frames.length - 1}
            step={1}
            value={shown}
            aria-valuetext={label}
            onChange={(event) => {
              setPlaying(false);
              setIndex(Number(event.target.value));
            }}
          />
        </div>
      </div>
      <div className={styles.buttons}>
        <Button onClick={() => setPlaying((on) => !on)}>
          {say(playing ? 'kitMechDyn.ui.pause' : 'kitMechDyn.ui.play')}
        </Button>
        <Button onClick={insert}>{say('kitMechDyn.ui.insertFrame')}</Button>
      </div>
    </section>
  );
}
