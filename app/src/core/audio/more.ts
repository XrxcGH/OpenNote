// The host commands of the audio lane's later features, which are not part of recording and playback itself. They
// split a recording, make a voice-enhanced copy, and compress a recording. They list what recordings take and delete
// a page's history. They export a recording, import a dropped audio or video file, snap the screen, and watch for
// meetings. They are the commands of app/src-tauri/src/audio_more. Like `AudioHost`, this shape is all the interface
// knows of Tauri.
import type { RecordingEntry, TrackEntry } from './types';

/** A recording after an edit: the entry that takes the old one's place, and its length. */
export interface Edited {
  entry: RecordingEntry;
  durationNs: number;
}

export interface SplitResult {
  first: Edited;
  second: Edited;
}

/** One recording in the storage list, with the page that holds it. */
export interface StoredRecording {
  notebook: string;
  section: string;
  page: string;
  pageTitle: string;
  assetsDir: string;
  entry: RecordingEntry;
  durationNs: number;
  /** The audio and timeline files together. */
  bytes: number;
  freesSmaller: number;
  freesSmallest: number;
}

export type CompressQuality = 'smaller' | 'smallest';
export type ExportFormat = 'wav' | 'opus';
export type SnapKind = 'screen' | 'window';

export interface MeetingOffer {
  app: string;
}

export interface AudioMore {
  split(assetsDir: string, entry: RecordingEntry, atNs: number): Promise<SplitResult>;
  /** The copy's tracks are in the answer's entry. The recording itself is untouched. */
  enhance(assetsDir: string, entry: RecordingEntry): Promise<Edited>;
  compress(assetsDir: string, entry: RecordingEntry, quality: CompressQuality): Promise<Edited>;
  storageScan(): Promise<StoredRecording[]>;
  /** Deletes the saved versions of a page. Answers how many. */
  purgeHistory(page: string): Promise<number>;
  /** Writes the recording to a path that `export_pick_save` chose. Answers the file's size. */
  exportAudio(assetsDir: string, entry: RecordingEntry, dest: string, format: ExportFormat): Promise<number>;
  /** Makes a recording of the sound in an audio or video file. */
  importFile(
    assetsDir: string,
    name: string,
    bytes: ArrayBuffer,
  ): Promise<{ entry: RecordingEntry; durationNs: number }>;
  meetingPoll(enabled: boolean, neverFor: readonly string[], recording: boolean): Promise<MeetingOffer | null>;
  /** The PNG of the screen, or of the window behind OpenNote. */
  snap(kind: SnapKind): Promise<ArrayBuffer>;
}

/** Calls a Tauri command with JSON arguments, or with raw bytes and headers. */
export type RawInvoke = (
  command: string,
  args?: unknown,
  options?: { headers?: Record<string, string> },
) => Promise<unknown>;

/** The host over Tauri commands named `audio_<method>` in snake case. */
export function moreOver(invoke: RawInvoke): AudioMore {
  const call = <T>(command: string, args?: Record<string, unknown>) => invoke(`audio_${command}`, args) as Promise<T>;
  return {
    split: (assetsDir, entry, atNs) => call('split', { assetsDir, entry, atNs }),
    enhance: (assetsDir, entry) => call('enhance', { assetsDir, entry }),
    compress: (assetsDir, entry, quality) => call('compress', { assetsDir, entry, quality }),
    storageScan: () => call('storage_scan'),
    purgeHistory: (page) => call('purge_history', { page }),
    exportAudio: (assetsDir, entry, dest, format) => call('export', { assetsDir, entry, dest, format }),
    importFile: (assetsDir, name, bytes) =>
      invoke('audio_import_file', new Uint8Array(bytes), {
        headers: { 'x-opennote-import': encodeURIComponent(JSON.stringify({ assetsDir, name })) },
      }) as Promise<{ entry: RecordingEntry; durationNs: number }>,
    meetingPoll: (enabled, neverFor, recording) => call('meeting_poll', { enabled, neverFor, recording }),
    snap: (kind) => call('snap', { kind }),
  };
}

/** What a recording's entry keeps beside the host's fields (they ride along in the entry's extras). */
export interface EntryExtras {
  /** The voice-enhanced copy of the audio. Its tracks have the original's timelines, so nothing else moves. */
  enhanced?: { tracks: TrackEntry[] };
  /** Which audio plays: the original unless this says `enhanced`. */
  listen?: 'original' | 'enhanced';
  /** Which audio the transcript is made from. */
  transcribeWith?: 'original' | 'enhanced';
  /** The audio was removed to save space. The flags and the transcript stay. */
  audioRemoved?: boolean;
  /** Screen snaps: the image block, and the capture time it was taken at. */
  snaps?: { block: string; captureNs: number }[];
  /** The calendar event of the meeting note it was recorded on (New meeting note), so both name the same meeting. */
  calendarEvent?: { source: string; id: string; title: string; start: string };
}

export const extrasOf = (entry: RecordingEntry): EntryExtras => entry as unknown as EntryExtras;

/** The tracks of an entry's enhanced copy, or none. */
export function enhancedTracks(entry: RecordingEntry | null | undefined): TrackEntry[] {
  const tracks = entry ? extrasOf(entry).enhanced?.tracks : undefined;
  return Array.isArray(tracks) ? tracks : [];
}

/** Whether the person listens to the enhanced copy. */
export const listensEnhanced = (entry: RecordingEntry): boolean =>
  extrasOf(entry).listen === 'enhanced' && enhancedTracks(entry).length > 0;

/** The entry to play: the original, or the original with the enhanced copy's tracks, which share its timelines. */
export const playable = (
  entry: RecordingEntry,
  which: 'original' | 'enhanced' = listensEnhanced(entry) ? 'enhanced' : 'original',
): RecordingEntry =>
  which === 'enhanced' && enhancedTracks(entry).length > 0 ? { ...entry, tracks: enhancedTracks(entry) } : entry;

/** Whether the audio is gone and only the flags and transcript are left. */
export const audioIsRemoved = (entry: RecordingEntry): boolean => entry.tracks.length === 0;

/** The entry without its enhanced copy and the choices about it, for after an edit that makes the copy stale. */
export function withoutEnhanced(entry: RecordingEntry): RecordingEntry {
  const { enhanced: _copy, listen: _listen, transcribeWith: _with, ...rest } = entry as RecordingEntry & EntryExtras;
  return rest as RecordingEntry;
}
