// The recording edits in the palette: Split recording, Enhance voice, Export as WAV and Opus, and Remove a part. They
// are the commands behind the More menu, with the same flags and the same strings, so the menu and the palette agree.
import { describe, expect, it } from 'vitest';
import { commands } from '../../../registries';
import { t } from '../../../strings/t';
import '../registrations/audioMore';

const EXPECTED = [
  { id: 'audio.split', title: 'Split the recording here', flag: 'audio.trim' },
  { id: 'audio.enhance', title: 'Enhance the voice of the recording', flag: 'audio.enhance' },
  { id: 'audio.exportWav', title: 'Save the recording as a WAV file', flag: 'audio.export' },
  { id: 'audio.exportOpus', title: 'Save the recording as an Opus file', flag: 'audio.export' },
  { id: 'audio.removePart', title: 'Remove a part', flag: 'audio.trim' },
] as const;

describe('the recording edits in the palette', () => {
  it.each(EXPECTED)('registers $id behind the flag of its More menu item', ({ id, title, flag }) => {
    const command = commands.get(id);
    expect(command, id).toBeDefined();
    expect(command?.flag).toBe(flag);
    expect(command?.category).toBe('insert');
    expect(t(command?.title as Parameters<typeof t>[0])).toBe(title);
  });

  it('finds them by the words people search for', () => {
    const words = t('audioMore.commands.keywords');
    for (const word of ['split', 'enhance', 'export', 'wav']) expect(words).toContain(word);
  });
});
