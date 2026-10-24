// The music and studio kit's commands: one to open the window, and one per tool that opens it on that tool.
import { MUSIC_TOOLS, openMusicKit } from '../../tools';
import { addCommand } from './qolStudy';

addCommand({
  id: 'tools.music',
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
