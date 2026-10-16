// The Draw tab's tools and pens, and Settings, Pen and touch: every control has a role and a name, choosing a tool
// or a pen slot presses it, Color and Width change the active slot, and the settings write the palm filter's choices.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { getSettings, settingsStore } from '../../../state/settings';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { DrawPens, DrawTools } from './DrawBar';
import PenSettings from './PenSettings';
import { deletePenSet, drawState, MAX_PEN_SETS, savePenSet, setSlotTool, updateSlot } from './state';

const toolProps = { tabIndex: -1, 'data-tool': '' } as const;
const original = settingsStore.get();

afterEach(() => {
  settingsStore.set(original);
  drawState.set({ tool: 'select', previous: 'select', slot: 'p1' });
});

describe('the Draw tab', () => {
  it('presses the chosen tool, and the chosen pen slot picks the pen tool', async () => {
    renderUi(
      <main>
        <div role="toolbar" aria-label="Draw">
          <DrawTools toolProps={toolProps} />
          <DrawPens toolProps={toolProps} />
        </div>
      </main>,
    );
    const select = screen.getByRole('button', { name: 'Select and type' });
    expect(select.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Stroke eraser' }));
    expect(drawState.get().tool).toBe('eraser');
    await userEvent.click(screen.getByRole('button', { name: 'Highlighter, Honey, 4 mm' }));
    expect(drawState.get()).toMatchObject({ tool: 'pen', previous: 'eraser', slot: 'h1' });
    expect(screen.getByRole('button', { name: 'Highlighter, Honey, 4 mm' }).getAttribute('aria-pressed')).toBe('true');
    expect(select.getAttribute('aria-pressed')).toBe('false');
    await expectNoAxeViolations(document.body);
  });

  it('changes the active slot’s width and color from their menus', async () => {
    renderUi(
      <main>
        <div role="toolbar" aria-label="Draw">
          <DrawPens toolProps={toolProps} />
        </div>
      </main>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pen, Indigo, 0.5 mm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Width' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: '2 mm' }));
    await expect.poll(() => getSettings().ink.pens.find((pen) => pen.id === 'p2')?.width).toBe(2);
    await userEvent.click(screen.getByRole('button', { name: 'Color' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Plum' }));
    await expect.poll(() => getSettings().ink.pens.find((pen) => pen.id === 'p2')?.color).toBe('plum');
    expect(screen.getByRole('button', { name: 'Pen, Plum, 2 mm' })).toBeTruthy();
  });

  it('changes the active pen to a library pen, and saves, applies and deletes a pen set', async () => {
    renderUi(
      <main>
        <div role="toolbar" aria-label="Draw">
          <DrawPens toolProps={toolProps} />
        </div>
      </main>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Pen, Indigo/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Width' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Calligraphy pen' }));
    await expect.poll(() => getSettings().ink.pens.find((pen) => pen.id === 'p2')?.tool).toBe('calligraphy');
    expect(screen.getByRole('button', { name: /^Calligraphy pen, Indigo/ })).toBeTruthy();
    await savePenSet('Drawing');
    expect(getSettings().ink.penSets?.map((set) => set.name)).toEqual(['Drawing']);
    await updateSlot('p2', { width: 5 });
    await userEvent.click(screen.getByRole('button', { name: 'Width' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Drawing' }));
    // The set keeps the width calligraphy took: the 0.7 mm preset nearest the pen's 0.5 mm.
    await expect.poll(() => getSettings().ink.pens.find((pen) => pen.id === 'p2')?.width).toBe(0.7);
    await deletePenSet(getSettings().ink.penSets?.[0].id ?? '');
    expect(getSettings().ink.penSets).toEqual([]);
  });
});

describe('the pen library', () => {
  const width = () => getSettings().ink.pens.find((pen) => pen.id === 'p2')?.width;

  it('gives a pen type the nearest width it has, and the plain pen its own back (Beta 5 walk W2-9)', async () => {
    await updateSlot('p2', { width: 0.5 });
    await setSlotTool('p2', 'calligraphy');
    expect(width()).toBe(0.7);
    await setSlotTool('p2', 'dashed');
    expect(width()).toBe(0.5);
    await setSlotTool('p2', 'calligraphy');
    await setSlotTool('p2', 'pen');
    expect(width()).toBe(0.5);
  });

  it('refuses a new set when the library is full, and still replaces one by name (Beta 5 walk W2-8)', async () => {
    for (let i = 0; i < MAX_PEN_SETS; i++) expect(await savePenSet(`Set ${i}`)).toBe(true);
    expect(await savePenSet('One more')).toBe(false);
    const names = getSettings().ink.penSets?.map((set) => set.name) ?? [];
    expect(names).toHaveLength(MAX_PEN_SETS);
    expect(names[0]).toBe('Set 0');
    expect(new Set(getSettings().ink.penSets?.map((set) => set.id)).size).toBe(MAX_PEN_SETS);
    expect(await savePenSet('Set 0')).toBe(true);
    expect(getSettings().ink.penSets).toHaveLength(MAX_PEN_SETS);
  });
});

describe('Settings, Pen and touch', () => {
  it('sets the writing hand and when a finger draws', async () => {
    renderUi(
      <main>
        <PenSettings />
      </main>,
    );
    const hand = screen.getByRole('radiogroup', { name: 'Writing hand' });
    await userEvent.click(within(hand).getByRole('radio', { name: 'Detect' }));
    await expect.poll(() => getSettings().ink.handedness).toBe('auto');
    const finger = screen.getByRole('radiogroup', { name: 'Draw with a finger' });
    await userEvent.click(within(finger).getByRole('radio', { name: 'Always' }));
    await expect.poll(() => getSettings().ink.touch).toMatchObject({ finger: 'on', draws: true });
    await userEvent.click(within(finger).getByRole('radio', { name: 'Never' }));
    await expect.poll(() => getSettings().ink.touch).toMatchObject({ finger: 'off', draws: false });
    await expectNoAxeViolations(document.body);
  });
});

describe('Settings, Pen and touch, Palm lab', () => {
  it('shows the Palm lab, and starts only after consent', async () => {
    renderUi(
      <main>
        <PenSettings />
      </main>,
    );
    const lab = screen.getByRole('group', { name: 'Palm lab' });
    const start = within(lab).getByRole('button', { name: 'Start recording' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await userEvent.click(within(lab).getByRole('switch', { name: /agree to save a recording/ }));
    expect(start.disabled).toBe(false);
    await userEvent.click(start);
    expect(within(lab).getByRole('button', { name: 'Stop recording' })).toBeTruthy();
    await userEvent.click(within(lab).getByRole('button', { name: 'Stop recording' }));
    expect(lab.querySelector('[data-palm-lab-result]')).toBeTruthy();
  });
});
