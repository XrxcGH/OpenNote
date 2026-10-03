// The recording on the page (Phase 9): a card with the recording bar while it records, and the player once it
// has stopped. The player opens the audio on the first press of Play, not when the page opens, so a page with
// several recordings doesn't open an output device for each.
import { FastForwardIcon } from '@phosphor-icons/react/dist/csr/FastForward';
import { FlagIcon } from '@phosphor-icons/react/dist/csr/Flag';
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { RewindIcon } from '@phosphor-icons/react/dist/csr/Rewind';
import { StopIcon } from '@phosphor-icons/react/dist/csr/Stop';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { useId } from 'react';
import { useFlag } from '../../../app/flags';
import { executeCommand } from '../../../commands/registry';
import type { PlaybackStatus, RecordingEntry } from '../../../core/audio';
import { Flags } from '../../../core/audio';
import type { BlockJson } from '../../../services/pages/types';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { IconButton, Switch } from '../../../ui';
import audioStyles from './audio.module.css';
import styles from './block.module.css';
import { activeNs, recordingIdOf } from './blocks';
import { recordingEntries } from './entries';
import { addFlag, removeFlag } from './flagEdits';
import { clock, clockNs } from './format';
import { Meter } from './Meter';
import { MoreMenu } from './MoreMenu';
import { captureNow, openFor, playbackUi, seek, setSkipSilence, setSpeed } from './playback';
import { isRunning, recordingUi } from './state';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function LiveBar() {
  const ui = useStore(recordingUi, (state) => state);
  const flags = useFlag('audio.flags');
  const paused = ui.phase === 'paused';
  const run = (id: 'audio.pause' | 'audio.flag' | 'audio.stop') => () =>
    void executeCommand(id, undefined, 'commandBar');
  return (
    <div className={styles.live} data-testid="recording-bar">
      <div className={styles.liveTop}>
        <span className={audioStyles.dot} data-live={!paused} aria-hidden="true" />
        <strong className={styles.time}>{clock(ui.elapsedMs)}</strong>
        <span className={styles.source}>{ui.source}</span>
        <span className={styles.spacer} />
        <IconButton
          label={t(paused ? 'audio.commands.resume' : 'audio.commands.pause')}
          icon={paused ? PlayIcon : PauseIcon}
          command="audio.pause"
          onPress={run('audio.pause')}
        />
        {flags && (
          <IconButton
            label={t('audio.commands.flag')}
            icon={FlagIcon}
            command="audio.flag"
            onPress={run('audio.flag')}
          />
        )}
        <IconButton label={t('audio.commands.stop')} icon={StopIcon} command="audio.stop" onPress={run('audio.stop')} />
      </div>
      <Meter state={ui.meters.microphone} label={t('audio.indicator.meter')} />
      <p className={styles.hint}>{t('audio.block.liveHint')}</p>
    </div>
  );
}

function FlagList({ pageId, block, entry }: { pageId: string; block: string; entry: RecordingEntry }) {
  const list = Flags.fromEntries([entry]).list(entry.id);
  if (list.length === 0) return null;
  return (
    <ul className={styles.flags} aria-label={t('audio.block.flags')}>
      {list.map((flag) => {
        const time = clockNs(flag.captureNs - entry.startedNs);
        return (
          <li key={flag.id} className={styles.flag}>
            <FlagIcon aria-hidden="true" />
            <span>{flag.label ? `${time} ${flag.label}` : time}</span>
            <IconButton
              label={t('audio.block.flagRemove', { time })}
              icon={XIcon}
              onPress={() => void removeFlag(pageId, block, entry, flag.id)}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** What the controls of one recording share: whether it is the one that plays, where it is, and how to act on it. */
interface Open {
  mine: boolean;
  status: PlaybackStatus | null;
  error: string | null;
  total: number;
  position: number;
  playing: boolean;
  /** Opens the recording's audio if it isn't open, then does the action. */
  whenOpen(action: () => Promise<unknown>): Promise<void>;
  command(id: 'audio.play' | 'audio.skipBack' | 'audio.skipForward'): void;
}

function useOpen(block: BlockJson, entry: RecordingEntry, pageId: string): Open {
  const play = useStore(playbackUi, (state) => state);
  const mine = play.block === block.id;
  const status = mine ? play.status : null;
  const total = status?.durationNs ?? activeNs(entry);
  const whenOpen = async (action: () => Promise<unknown>) => {
    if ((mine && play.error === null) || (await openFor(block, pageId))) await action();
  };
  return {
    mine,
    status,
    error: mine ? play.error : null,
    total,
    position: Math.min(status?.positionNs ?? 0, total),
    playing: status?.state === 'playing',
    whenOpen,
    command: (id) => void whenOpen(() => executeCommand(id, undefined, 'commandBar')),
  };
}

function Transport({ open }: { open: Open }) {
  const sliderId = useId();
  const { total, position } = open;
  return (
    <>
      <IconButton
        label={t(open.playing ? 'audio.block.pause' : 'audio.block.play')}
        icon={open.playing ? PauseIcon : PlayIcon}
        command="audio.play"
        onPress={() => open.command('audio.play')}
      />
      <IconButton
        label={t('audio.block.skipBack')}
        icon={RewindIcon}
        command="audio.skipBack"
        onPress={() => open.command('audio.skipBack')}
      />
      <IconButton
        label={t('audio.block.skipForward')}
        icon={FastForwardIcon}
        command="audio.skipForward"
        onPress={() => open.command('audio.skipForward')}
      />
      <label className={styles.sliderLabel} htmlFor={sliderId}>
        {t('audio.block.position')}
      </label>
      <input
        id={sliderId}
        className={styles.slider}
        type="range"
        min={0}
        max={Math.max(total, 1)}
        step={100_000_000}
        value={position}
        aria-valuetext={t('audio.block.positionText', { position: clockNs(position), total: clockNs(total) })}
        onChange={(event) => {
          const to = Number(event.target.value);
          void open.whenOpen(() => seek(to));
        }}
      />
      <span className={styles.time} aria-hidden="true">
        {clockNs(position)} / {clockNs(total)}
      </span>
    </>
  );
}

function Extras(props: { open: Open; block: BlockJson; entry: RecordingEntry; pageId: string }) {
  const { open, block, entry, pageId } = props;
  const flags = useFlag('audio.flags');
  return (
    <>
      <select
        className={audioStyles.select}
        aria-label={t('audio.block.speed')}
        value={open.status?.speed ?? 1}
        onChange={(event) => {
          const speed = Number(event.target.value);
          void open.whenOpen(() => setSpeed(speed));
        }}
      >
        {SPEEDS.map((speed) => (
          <option key={speed} value={speed}>
            {t('audio.block.speedValue', { speed })}
          </option>
        ))}
      </select>
      {flags && (
        <IconButton
          label={t('audio.block.flag')}
          icon={FlagIcon}
          command="audio.flag"
          disabled={!open.mine}
          onPress={() => {
            const captureNs = open.mine ? captureNow() : null;
            if (captureNs !== null) void addFlag(pageId, block.id, entry, captureNs, open.position);
          }}
        />
      )}
      <MoreMenu block={block} entry={entry} pageId={pageId} position={open.position} />
    </>
  );
}

function Player({ block, entry, pageId }: { block: BlockJson; entry: RecordingEntry; pageId: string }) {
  const open = useOpen(block, entry, pageId);
  return (
    <div className={styles.player}>
      <div className={styles.controls}>
        <Transport open={open} />
        <Extras open={open} block={block} entry={entry} pageId={pageId} />
      </div>
      <div className={styles.options}>
        <Switch
          label={t('audio.block.skipSilence')}
          checked={open.status?.skipSilence ?? false}
          onChange={(on) => void open.whenOpen(() => setSkipSilence(on))}
        />
      </div>
      <FlagList pageId={pageId} block={block.id} entry={entry} />
      {open.error && (
        <p role="alert" className={styles.problem}>
          {t('audio.block.failed', { message: open.error })}
        </p>
      )}
      {entry.state === 'recovered' && (
        <p className={styles.hint}>{t('audio.block.recovered', { time: clock(activeNs(entry) / 1e6) })}</p>
      )}
    </div>
  );
}

export function RecordingBlockView({ block, pageId }: { block: BlockJson; pageId: string }) {
  const ui = useStore(recordingUi, (state) => state);
  const entry = useStore(recordingEntries, (held) => held.get(recordingIdOf(block) ?? ''));
  if (!entry) return <p className={styles.problem}>{t('audio.block.unavailable')}</p>;
  if (ui.block === block.id && isRunning(ui)) return <LiveBar />;
  if (entry.state === 'recording') return <p className={styles.hint}>{t('audio.block.recovering')}</p>;
  return <Player block={block} entry={entry} pageId={pageId} />;
}
