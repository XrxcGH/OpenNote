// The conflict view registry (ADR 0089): a block type's own view shows for its changed blocks, and every other
// block keeps the side-by-side text.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { resetFakeShell, setFakeShell } from '../../../platform/shellqol';
import { pressChord, renderApp } from '../../../test';
import { openConflictDialog } from '../ConflictDialog';
import { registerConflictView, type ConflictViewProps } from './registry';

const PAGE = '01m3sa12426sg32pmtyffjaqcf';
const FIRST = { revision: '01m3sa12426sg32pmtyffjaqc9', device: { label: 'Laptop' }, savedAt: '2026-10-01T10:00:00Z' };
const TEXTS = { mine: 'Mine says hello', theirs: 'Theirs says goodbye' };
const block = (id: string, type: string) => ({ id, type, mine: { data: { n: 1 } }, theirs: { data: { n: 2 } } });

function TestView(props: ConflictViewProps) {
  const n = (side: unknown) => (side as { data: { n: number } }).data.n;
  return (
    <section aria-label={`Test compare ${props.block.id}`}>
      <p>
        Here {n(props.block.mine)}, on {props.otherDevice} {n(props.block.theirs)}
      </p>
      <button type="button" onClick={() => props.resolve('keepTheirs')}>
        Take theirs
      </button>
    </section>
  );
}

let unregister: (() => void) | undefined;

afterEach(async () => {
  unregister?.();
  unregister = undefined;
  for (let i = 0; i < 3 && document.querySelector('[role="dialog"]'); i += 1) await pressChord('Escape');
  resetFakeShell();
});

async function open(blocks: unknown) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  setFakeShell((name, args) => {
    calls.push([name, args]);
    if (name === 'conflict.text') return { ...TEXTS, blocks };
    if (name === 'conflict.resolve') return { ok: true };
    return null;
  });
  await renderApp();
  const closed = openConflictDialog(PAGE, FIRST, 1);
  const dialog = await screen.findByRole('dialog', { name: 'Two versions of this page' });
  return { calls, closed, dialog };
}

describe('the conflict view registry', () => {
  it('shows the registered view for its block type and resolves through it', async () => {
    unregister = registerConflictView('test.view', TestView);
    const { calls, closed, dialog } = await open([block('b1', 'test.view')]);
    const view = await within(dialog).findByRole('region', { name: 'Test compare b1' });
    expect(within(view).getByText('Here 1, on Laptop 2')).toBeTruthy();
    expect(within(dialog).queryByText(TEXTS.mine)).toBeNull();
    await userEvent.click(within(view).getByRole('button', { name: 'Take theirs' }));
    await closed;
    expect(calls.find(([name]) => name === 'conflict.resolve')?.[1]).toEqual({
      pageId: PAGE,
      revision: FIRST.revision,
      choice: 'keepTheirs',
    });
  });

  it('keeps the text view for block types without a view', async () => {
    unregister = registerConflictView('test.view', TestView);
    const { dialog } = await open([block('b1', 'test.view'), block('b2', 'text')]);
    expect(await within(dialog).findByRole('region', { name: 'Test compare b1' })).toBeTruthy();
    expect(within(dialog).queryByRole('region', { name: 'Test compare b2' })).toBeNull();
    expect(within(dialog).getByText(TEXTS.mine)).toBeTruthy();
    expect(within(dialog).getByText(TEXTS.theirs)).toBeTruthy();
  });

  it('shows only the text view when no type registered a view', async () => {
    const { dialog } = await open([block('b1', 'test.view')]);
    expect(await within(dialog).findByText(TEXTS.mine)).toBeTruthy();
    expect(within(dialog).queryByRole('region', { name: /^Test compare/ })).toBeNull();
  });
});
