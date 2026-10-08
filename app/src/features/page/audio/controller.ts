// Recording, from the interface's side (Phase 9). One recording runs at a time, in one block of the shown page. The
// block is saved before any audio file exists, so a crash can't lose a recording (crates/media/src/service/README.md,
// "Starting a recording safely"). This module loads on first use, so it stays out of the start-up bundle.
import { isEnabled } from '../../../app/flags';
import { commandContext } from '../../../commands/registry';
import { extrasOf, Flags, HostClock, RecordingSession } from '../../../core/audio';
import type { RecordingEntry, StopReason, Warning } from '../../../core/audio';
import { newId } from '../../../editor/ids';
import { beforeExit } from '../../../registries';
import type { AudioClient } from '../../../platform/types';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownPage as shownOpenPage } from '../history/shown';
import { shownLayer } from '../mount';
import { activeNs, insertRecordingBlock, removeBlock, writeEntry } from './blocks';
import { clock } from './format';
import { IDLE, recordingChoices, recordingUi } from './state';

/** The one host clock of the window: it learns the offset to the capture clock once and keeps it. */
export const hostClock = new HostClock();

export function platformAudio(): AudioClient {
  return commandContext('commandBar').platform.audio;
}

/** What went wrong, for the log. */
function describeFailure(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: string; message?: string };
    return [code, message].filter(Boolean).join(': ') || JSON.stringify(error);
  }
  return String(error);
}

/** The message for a failed command: its error code has a message, and the rest say something general. */
export function describeError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const known: Record<string, MessageKey> = {
    audioDevice: 'audio.errors.audioDevice',
    audioEncoder: 'audio.errors.audioEncoder',
    audioFormat: 'audio.errors.audioFormat',
    audioCorrupt: 'audio.errors.audioCorrupt',
    audioWriter: 'audio.errors.audioWriter',
    io: 'audio.errors.io',
  };
  return t((code && known[code]) || 'audio.errors.unknown');
}

interface Run {
  session: RecordingSession;
  page: string;
  block: string;
  entry: RecordingEntry;
  flags: Flags;
  pausedTotalNs: number;
  pausedSinceNs: number | null;
  stopping: boolean;
  stopExit: () => void;
}

let run: Run | null = null;

export const recordingBlockId = () => run?.block ?? null;
export const runningRecording = () => run?.entry.id ?? null;
/** The session, for the text stamps that need `stamp()`. Null when nothing records. */
export const recordingSession = () => (run && !run.stopping ? run.session : null);

/** Whether the person is recording and not paused: only then does typing get a time stamp. */
export function stampNow(): { recording: string; captureNs: number } | null {
  if (!run || run.stopping || recordingUi.get().phase !== 'recording') return null;
  // Text on another page isn't part of this page's recording.
  if (shownOpenPage.get()?.id !== run.page) return null;
  return run.session.stamp();
}

function update(patch: Partial<typeof IDLE>): void {
  recordingUi.set((state) => ({ ...state, ...patch }));
}

/** What a warning says, in words. */
export function warningText(warning: Warning): string {
  switch (warning.type) {
    case 'microphoneSilent':
      return t('audio.warnings.microphoneSilent', { seconds: Math.round(warning.seconds) });
    case 'deviceStalled':
      return t('audio.warnings.deviceStalled');
    case 'lowDisk':
      return t('audio.warnings.lowDisk', { minutes: Math.round(warning.minutesLeft) });
    case 'lowBattery':
      return t('audio.warnings.lowBattery', { percent: Math.round(warning.percent) });
    case 'writerFailed':
      return t('audio.warnings.writerFailed', { message: warning.message });
    case 'droppedAudio':
      return t('audio.warnings.droppedAudio');
    case 'deviceLost':
      return t('audio.warnings.deviceLost');
    case 'notDefaultDevice':
      return t('audio.warnings.notDefaultDevice');
  }
}

function watch(active: Run): void {
  const seen = new Set<string>();
  active.session.watch({
    onView(view) {
      const { status } = view;
      const now = status.now.captureNs;
      if (status.paused && active.pausedSinceNs === null) active.pausedSinceNs = now;
      if (!status.paused && active.pausedSinceNs !== null) {
        active.pausedTotalNs += now - active.pausedSinceNs;
        active.pausedSinceNs = null;
      }
      const paused = active.pausedTotalNs + (active.pausedSinceNs === null ? 0 : now - active.pausedSinceNs);
      const elapsedMs = Math.max(0, (now - active.entry.startedNs - paused) / 1e6);
      for (const warning of status.warnings) {
        const key = JSON.stringify([warning.type, 'track' in warning ? warning.track : '']);
        if (!seen.has(key)) {
          seen.add(key);
          announce(warningText(warning), 'assertive');
        }
      }
      if (run === active && !active.stopping) {
        update({ elapsedMs, meters: view.meters, warnings: status.warnings, bytes: status.bytes });
      }
    },
    onStop: (reason) => void stopRecording(reason),
    onError: () => undefined,
  });
}

/** Starts recording into a new block of the shown page. */
/**
 * The recording, stamped with the calendar event of the page when the page is a meeting note (New meeting note keeps
 * the event in the page's view), so the recording and the note name the same meeting.
 */
function stamped<T extends RecordingEntry>(entry: T, page: { initial: { view: Record<string, unknown> } }): T {
  const event = page.initial.view.meetingEvent;
  return event && typeof event === 'object' ? ({ ...entry, calendarEvent: event } as T) : entry;
}

export async function startRecording(): Promise<boolean> {
  if (recordingUi.get().phase !== 'idle') {
    announce(t('audio.errors.busy'));
    return false;
  }
  const page = shownOpenPage.get();
  if (!page || !shownLayer.get()) {
    showToast({ message: t('audio.errors.noPage'), tone: 'danger' });
    return false;
  }
  const audio = platformAudio();
  const choices = recordingChoices.get();
  const session = new RecordingSession(audio.host, hostClock);
  update({ ...IDLE, phase: 'starting', page: page.id });
  let block: string | null = null;
  let recording = '';
  let source: string | null = null;
  try {
    const assetsDir = await audio.assetsDir(page.id);
    const entry = await session.start(
      {
        assetsDir,
        microphone: choices.microphone,
        systemAudio: isEnabled('audio.systemAudio') && choices.systemAudio,
        systemDevice: null,
      },
      async (prepared) => {
        source = prepared.microphone.device.name;
        recording = prepared.entry.id;
        block = await insertRecordingBlock(stamped(prepared.entry, page));
        await page.saveNow();
      },
      async () => {
        if (block) await removeBlock(block, recording);
        block = null;
      },
    );
    if (!block) throw new Error('The recording block is missing.');
    const stampedEntry = stamped(entry, page);
    run = {
      session,
      page: page.id,
      block,
      entry: stampedEntry,
      flags: new Flags(),
      pausedTotalNs: 0,
      pausedSinceNs: null,
      stopping: false,
      stopExit: beforeExit.register({
        id: 'audio.recording',
        order: 5,
        run: async () => {
          await stopRecording();
          return { ok: true };
        },
      }),
    };
    update({ phase: 'recording', block, recording: entry.id, source });
    await writeEntry(page.id, block, stampedEntry);
    watch(run);
    announce(t('audio.announce.started'));
    void import('./watch').then((module) => module.activate());
    return true;
  } catch (error) {
    commandContext('commandBar').platform.log('error', `Recording couldn't start: ${describeFailure(error)}`);
    run = null;
    update({ ...IDLE });
    showToast({
      message: t('audio.errors.start', { message: describeError(error) }),
      tone: 'danger',
    });
    return false;
  }
}

function stoppedMessage(reason: StopReason | undefined, time: string): string {
  if (reason?.type === 'diskFull') return t('audio.stopped.diskFull', { time });
  if (reason?.type === 'writerFailed') return t('audio.stopped.writerFailed', { time });
  return t('audio.announce.stopped', { time });
}

/** Stops the recording and saves its entry. `reason` is set when the host stopped it. */
export async function stopRecording(reason?: StopReason): Promise<void> {
  const active = run;
  if (!active || active.stopping) return;
  active.stopping = true;
  update({ phase: 'stopping' });
  try {
    const finished = await active.session.stop();
    // The snaps taken while recording are in the running entry, and the host's entry doesn't know them.
    const { snaps, calendarEvent } = extrasOf(active.entry);
    const carried = { ...(snaps ? { snaps } : {}), ...(calendarEvent ? { calendarEvent } : {}) };
    const entry = active.flags.into({ ...finished.entry, ...carried } as RecordingEntry);
    await writeEntry(active.page, active.block, entry, { track: 'finished' });
    const time = clock(activeNs(entry) / 1e6);
    const message = stoppedMessage(reason, time);
    if (reason) showToast({ message, tone: 'danger' });
    else announce(message);
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
  } finally {
    active.stopExit();
    run = null;
    update({ ...IDLE });
  }
}

export async function togglePause(): Promise<void> {
  const active = run;
  if (!active || active.stopping) return;
  try {
    if (recordingUi.get().phase === 'paused') {
      await active.session.resume();
      update({ phase: 'recording' });
      announce(t('audio.announce.resumed'));
    } else {
      await active.session.pause();
      update({ phase: 'paused' });
      announce(t('audio.announce.paused'));
    }
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
  }
}

/** Drops a flag at this moment of the recording that runs. */
export async function flagNow(): Promise<void> {
  const active = run;
  if (!active || active.stopping) return;
  const stamp = active.session.stamp();
  active.flags.add(stamp.recording, stamp.captureNs, newId);
  const entry = active.flags.into(active.entry);
  active.entry = entry;
  announce(t('audio.announce.flagged', { time: clock(recordingUi.get().elapsedMs) }));
  await writeEntry(active.page, active.block, entry);
}

/** Whether the recording that runs is the shown page's, so a snap can be stamped to it. */
export function snapStamp(): { captureNs: number } | null {
  const stamp = stampNow();
  return stamp ? { captureNs: stamp.captureNs } : null;
}

/** Notes that a block of the page (a screen snap) was added at a moment of the recording that runs. */
export async function stampBlockNow(block: string, captureNs: number): Promise<void> {
  const active = run;
  if (!active || active.stopping) return;
  const snaps = [...(extrasOf(active.entry).snaps ?? []), { block, captureNs }];
  active.entry = { ...active.entry, snaps } as RecordingEntry;
  await writeEntry(active.page, active.block, active.entry);
}

/** Records from another microphone from now on, without stopping. */
export async function switchMicrophone(id: string | null): Promise<void> {
  const active = run;
  if (!active || active.stopping) return;
  try {
    const resolution = await active.session.switchMicrophone(id);
    update({ source: resolution.device.name });
    announce(t('audio.announce.switched', { device: resolution.device.name }));
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
  }
}

/** Follows the default output again, after the PC started playing sound somewhere else. */
export async function followSystemOutput(): Promise<void> {
  try {
    await run?.session.switchSystemAudio(null);
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
  }
}
