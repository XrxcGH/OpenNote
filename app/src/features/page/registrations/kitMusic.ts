// The music and studio kit's commands: one to open the window, and one per tool that opens it on that tool.
import type { MusicToolId } from '../../tools';
import { MUSIC_TOOLS } from '../../tools/flags';
import { addCommand } from './qolStudy';

// The kit's window and opener load on first use, so start-up holds only these definitions.
const openMusicKit = async (tool?: MusicToolId) => (await import('../../tools')).openMusicKit(tool);

addCommand({
  id: 'tools.kitmusic',
  title: 'kitMusic.open',
  keywords: 'kitMusic.openKeywords',
  category: 'general',
  icon: 'MusicNotes',
  flag: 'tools.music',
  anywhere: true,
  run: () => openMusicKit(),
});

for (const tool of MUSIC_TOOLS) {
  addCommand({
    id: `kits.music.${tool.id}`,
    title: `kitMusic.t.${tool.id}.title`,
    keywords: `kitMusic.t.${tool.id}.keywords`,
    category: 'general',
    icon: tool.icon,
    flag: 'tools.music',
    anywhere: true,
    run: () => openMusicKit(tool.id),
  });
}
