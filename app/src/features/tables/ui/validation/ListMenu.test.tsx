import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { Chips, ListMenu } from './ListMenu';

const ITEMS = ['Red', 'Green', 'Blue'];

function open(extra: Partial<Parameters<typeof ListMenu>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  renderUi(
    <main>
      <ListMenu address="B4" items={ITEMS} picked={[]} multi={false} onPick={onPick} onClose={onClose} {...extra} />
    </main>,
  );
  return { onPick, onClose, list: screen.getByRole('listbox', { name: 'Choices for B4' }) };
}

describe('ListMenu', () => {
  it('offers every item as an option and passes axe', async () => {
    open();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(ITEMS);
    await expectNoAxeViolations(document.body);
  });

  it('moves with the arrow keys and picks with Enter', () => {
    const { list, onPick } = open();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('Green');
  });

  it('starts on the value the cell holds, and Escape closes without picking', () => {
    const { list, onPick, onClose } = open({ picked: ['Blue'] });
    expect(list.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2].id);
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('picks with a click, and marks the picked values', () => {
    const { onPick } = open({ picked: ['Red', 'Blue'], multi: true });
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'true',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Green' }));
    expect(onPick).toHaveBeenCalledWith('Green');
  });

  it('says so when the list is empty', () => {
    renderUi(<ListMenu address="A1" items={[]} picked={[]} multi={false} onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByText('The list has no items.')).toBeTruthy();
  });
});

describe('Chips', () => {
  it('removes a chip by its button', () => {
    const onRemove = vi.fn();
    renderUi(<Chips names={['a', 'b']} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove b' }));
    expect(onRemove).toHaveBeenCalledWith('b');
  });
});
