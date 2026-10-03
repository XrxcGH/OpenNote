import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { announcements, expectNoAxeViolations, renderUi } from '../test';
import { TextField } from './TextField';
import type { TextFieldProps } from './TextField';

function Fixture(props: Partial<TextFieldProps> & { start?: string }) {
  const [value, setValue] = useState(props.start ?? 'Mitosis');
  return (
    <main>
      <TextField label="Page name" {...props} value={value} onChange={setValue} />
    </main>
  );
}

const input = () => screen.getByRole('textbox', { name: 'Page name' }) as HTMLInputElement;

describe('TextField rendering', () => {
  it('is a textbox named by its label above it', () => {
    renderUi(<Fixture />);
    expect(input().value).toBe('Mitosis');
    const label = screen.getByText('Page name');
    expect(label.getBoundingClientRect().bottom).toBeLessThanOrEqual(input().getBoundingClientRect().top);
  });

  it('links help and error text with aria-describedby, and marks an error invalid', () => {
    renderUi(<Fixture help="Names can be 100 characters." error="A page named “Mitosis” already exists." />);
    const description = input()
      .getAttribute('aria-describedby')
      ?.split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(description).toEqual(['A page named “Mitosis” already exists.', 'Names can be 100 characters.']);
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('has no description and isn’t invalid without help or an error', () => {
    renderUi(<Fixture />);
    expect(input().hasAttribute('aria-describedby')).toBe(false);
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('meets 32 px with the mouse and 44 px with touch', () => {
    renderUi(<Fixture />);
    expect(input().getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    document.documentElement.dataset.density = 'touch';
    expect(input().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    delete document.documentElement.dataset.density;
  });

  it('doesn’t change a read-only value', async () => {
    renderUi(<Fixture readOnly />);
    await userEvent.type(input(), 'x');
    expect(input().value).toBe('Mitosis');
  });

  it('selects the text when it mounts with autoSelect', () => {
    renderUi(<Fixture autoSelect />);
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe('Mitosis'.length);
  });
});

describe('TextField keyboard', () => {
  it('types, commits on Enter, and cancels on Escape', async () => {
    const [onCommit, onCancel] = [vi.fn(), vi.fn()];
    renderUi(<Fixture onCommit={onCommit} onCancel={onCancel} />);
    await userEvent.click(input());
    await userEvent.keyboard('{End}s');
    expect(input().value).toBe('Mitosiss');
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape alone when nothing cancels', () => {
    renderUi(<Fixture />);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input().dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });

  it('ignores Enter and Escape that belong to an input method’s composition', () => {
    const [onCommit, onCancel] = [vi.fn(), vi.fn()];
    renderUi(<Fixture onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input(), { key: 'Escape', isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('announces a new error, and keeps focus in the field', async () => {
    const { rerender } = renderUi(<TextField label="Page name" value="a/b" onChange={() => {}} />);
    input().focus();
    rerender(<TextField label="Page name" value="a/b" error="Names can’t include a slash." onChange={() => {}} />);
    expect(announcements()).toEqual(['Names can’t include a slash.']);
    expect(document.activeElement).toBe(input());
  });
});

describe('TextField accessibility', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`passes axe in the ${theme} theme, plain, with help, with an error, and read-only`, async () => {
      renderUi(
        <main>
          <TextField label="Notebook name" value="Biology" onChange={() => {}} />
          <TextField label="Section name" value="Cells" help="Up to 100 characters." onChange={() => {}} />
          <TextField label="Page name" value="a/b" error="Names can’t include a slash." onChange={() => {}} />
          <TextField label="Folder" value="C:\Notes" readOnly onChange={() => {}} />
        </main>,
        { theme },
      );
      await expectNoAxeViolations(document.body);
    });
  }
});
