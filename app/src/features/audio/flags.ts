// Phase 9's flags (audio recording). Each feature is on once it works end to end in the app; the rest stay off,
// hidden rather than disabled. app/flags.ts joins these to the other flags, so they load at start-up.
import type { FlagDef, FlagId } from '../../app/flags';

export type AudioFlagId = Extract<FlagId, `audio.${string}` | `transcripts.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };

const flag = (id: AudioFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const AUDIO_FLAGS: readonly FlagDef[] = [
  flag('audio.record', 'Recording from the microphone, the recording block, and playback.', on),
  flag('audio.stamps', 'Time stamps on typed text, and tapping a word to hear it.', on),
  flag('audio.flags', 'Flags that mark moments of a recording.', on),
  flag('audio.trim', 'Trimming silence and removing parts of a recording.', on),
  flag('audio.systemAudio', 'Recording the PC’s sound along with the microphone, for meetings.', on),
  flag('audio.meetingPrompt', 'The setting and prompt that offer to record when another app uses the microphone.', on),
  flag('audio.enhance', 'Enhance voice on a copy of a recording, and switching between the two.', on),
  flag('audio.storage', 'The list of what recordings take, with Compress and Remove audio.', on),
  flag('audio.snap', 'Snapping the screen, a window, or a region onto the page while recording.', on),
  flag('audio.import', 'Audio and video files dropped onto a page become recordings.', on),
  flag('audio.export', 'Saving a recording as an audio file.', on),
  flag('transcripts.block', 'The transcript of a recording, with a summary, times, and click to listen.', on),
  flag('transcripts.speakers', 'Speaker labels in a transcript, and renaming them.', on),
  flag('transcripts.notes', 'Copying transcript lines into the notes as a quote with a time link.', on),
  flag('transcripts.actions', 'Finding action items and making chapters from a transcript.', on),
  flag('transcripts.recap', 'Copying a meeting recap.', on),
];
