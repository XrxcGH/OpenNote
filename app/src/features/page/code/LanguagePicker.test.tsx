// The code language picker in a real browser (PLAN.md section 10.5). It has no axe violations in either theme.
// Typing filters the list, and arrow keys move the highlight. Enter or a click chooses, and Escape closes.
import { fireEvent, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { installLayerEscape } from '../../../state/layers';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { LanguagePicker } from './LanguagePicker';

function Harness({
  current,
  onPick,
  onClose,
}: {
  current: string | null;
  onPick(id: string | null): void;
  onClose(): void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={anchor} type="button">
        Python
      </button>
      <LanguagePicker anchor={anchor} current={current} onPick={onPick} onClose={onClose} />
    </div>
  );
}

const filter = () => screen.getByRole('combobox', { name: 'Filter languages' });
const highlighted = () => document.getElementById(filter().getAttribute('aria-activedescendant') ?? '');

describe('the language picker', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations in the ${theme} theme`, async () => {
      renderUi(<Harness current="python" onPick={vi.fn()} onClose={vi.fn()} />, { theme });
      await vi.waitFor(() => expect(document.activeElement).toBe(filter()));
      await expectNoAxeViolations(document.body);
    });
  }

  it('starts on the block’s language, written as an alias or not', async () => {
    renderUi(<Harness current="py" onPick={vi.fn()} onClose={vi.fn()} />);
    await vi.waitFor(() => expect(highlighted()?.textContent).toBe('Python'));
    expect(screen.getByRole('listbox', { name: 'Code language' })).toBeTruthy();
  });

  it('filters by name or alias, moves with arrows, and chooses with Enter', async () => {
    const onPick = vi.fn();
    renderUi(<Harness current={null} onPick={onPick} onClose={vi.fn()} />);
    await vi.waitFor(() => expect(document.activeElement).toBe(filter()));
    fireEvent.change(filter(), { target: { value: 'ts' } });
    expect(highlighted()?.textContent).toBe('TypeScript');
    fireEvent.keyDown(filter(), { key: 'ArrowDown' });
    expect(highlighted()?.textContent).not.toBe('TypeScript');
    fireEvent.keyDown(filter(), { key: 'Home' });
    fireEvent.keyDown(filter(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('typescript');
  });

  it('chooses plain text, and says when nothing matches', async () => {
    const onPick = vi.fn();
    renderUi(<Harness current="js" onPick={onPick} onClose={vi.fn()} />);
    fireEvent.change(filter(), { target: { value: 'zzz' } });
    expect(screen.getByRole('status').textContent).toBe('No language matches “zzz”.');
    fireEvent.change(filter(), { target: { value: '' } });
    fireEvent.change(filter(), { target: { value: 'plain' } });
    fireEvent.click(screen.getByRole('option', { name: 'Plain text' }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('closes on Escape without a choice', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    // The shell listens for Escape on the window and closes the top layer.
    const stop = installLayerEscape();
    try {
      renderUi(<Harness current={null} onPick={onPick} onClose={onClose} />);
      await vi.waitFor(() => expect(document.activeElement).toBe(filter()));
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalled();
      expect(onPick).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});
