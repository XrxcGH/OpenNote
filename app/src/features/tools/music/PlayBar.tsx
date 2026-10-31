// Play and Stop for the sound an answer carries, with Tap for tempo when the tool has a tempo field. The audio
// starts only when the student presses Play, and stops when the answer changes or the window closes.
import './text';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { newAudioContext, play, tapTempo } from './audio';
import type { PlayPlan, Player } from './audio';
import styles from './kit.module.css';

export function PlayBar({ plan, onTempo }: { plan: PlayPlan; onTempo?(bpm: number): void }) {
  const [playing, setPlaying] = useState(false);
  const planRef = useRef(plan);
  const player = useRef<Player | null>(null);
  const taps = useRef<number[]>([]);
  useEffect(() => {
    planRef.current = plan;
  });
  const stop = () => {
    player.current?.stop();
    player.current = null;
    setPlaying(false);
  };
  // A different answer (other notes, other beats) stops the sound; a new tempo alone does not.
  const shape = `${plan.beats}|${plan.notes.map((n) => `${n.at}:${n.hz}:${n.level}`).join(',')}`;
  useEffect(() => stop, [shape]);
  const start = () => {
    const audio = newAudioContext();
    if (!audio) {
      announce(t('kitMusic.noAudio'));
      return;
    }
    void audio.resume?.();
    player.current = play(
      () => planRef.current,
      audio,
      () => {
        player.current = null;
        setPlaying(false);
      },
    );
    setPlaying(true);
    announce(t('kitMusic.playing'));
  };
  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((time) => now - time < 2500), now].slice(-8);
    const bpm = tapTempo(taps.current);
    if (bpm !== null) onTempo?.(bpm);
  };
  return (
    <div className={styles.actions} role="group" aria-label={t('kitMusic.sound')}>
      <Button variant="quiet" aria-pressed={playing} onClick={playing ? stop : start}>
        {t(playing ? 'kitMusic.stop' : 'kitMusic.play')}
      </Button>
      {plan.tempoField && onTempo ? (
        <Button variant="quiet" onClick={tap}>
          {t('kitMusic.tap')}
        </Button>
      ) : null}
    </div>
  );
}
