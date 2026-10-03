// Phase 9's flags (audio recording). Each feature is on once it works end to end in the app; the rest stay off,
// hidden rather than disabled. app/flags.ts joins these to the other flags, so they load at start-up.
import type { FlagDef, FlagId } from '../../app/flags';

export type AudioFlagId = Extract<FlagId, `audio.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const on = { dev: true, nightly: true, beta: true, stable: true };
const off = { dev: false, nightly: false, beta: false, stable: false };

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
  flag('audio.meetingPrompt', 'The prompt that offers to record when another app uses the microphone.', off),
];
