// Cards can be made from a section (tree menu and palette) and from a transcript (a button on the block).
import { describe, expect, it } from 'vitest';
import { transcriptActions } from '../../page';
import { commands, contextMenus } from '../../../registries';
import { renderApp } from '../../../test';

describe('making cards from a section and a transcript', () => {
  it('puts "Make flashcards from this section" in the section menu and the palette', async () => {
    await renderApp();
    const command = commands.get('study.generateSection');
    expect(command?.title).toBe('study.generate.section');
    expect(command?.palette).not.toBe(false);
    const item = contextMenus.list().find((one) => one.command === 'study.generateSection');
    expect(item?.menu).toBe('tree.section');
  });

  it('adds a "Make cards" action to the transcript block, behind the study flag', async () => {
    await renderApp();
    const action = transcriptActions.get('study.cards');
    expect(action?.label).toBe('study.generate.transcript');
    expect(action?.flag).toBe('study.cards');
  });
});
