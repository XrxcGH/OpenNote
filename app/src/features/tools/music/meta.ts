// The tools of the music and studio kit, in tab order. The window and the palette registration both read this list.
import type { IconName } from '../../../ui/icons';

export const MUSIC_TOOLS = [
  { id: 'camera', icon: 'Camera' },
  { id: 'studio', icon: 'Palette' },
  { id: 'rhythm', icon: 'Metronome' },
] as const satisfies readonly {
  id: string;
  icon: IconName;
}[];

export type MusicToolId = (typeof MUSIC_TOOLS)[number]['id'];
