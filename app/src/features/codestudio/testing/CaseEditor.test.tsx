// The case editor's keyboard and screen reader behavior: focus goes into the form, a disabled Save says why, and
// Delete asks once more.
import { screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { renderUi } from '../../../test';
import { CaseEditor, draftOf } from './CaseEditor';

const props = (over: Partial<Parameters<typeof CaseEditor>[0]> = {}) => ({
  draft: draftOf(null, 1),
  existing: false,
  canCall: true,
  onChange: () => {},
  onSave: () => {},
  onCancel: () => {},
  onDelete: () => {},
  ...over,
});

describe('CaseEditor', () => {
  it('moves focus into the Name field when it opens', async () => {
    renderUi(<CaseEditor {...props()} />);
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')));
  });

  it('says why Save is disabled', () => {
    renderUi(<CaseEditor {...props({ draft: { ...draftOf(null, 1), kind: 'call', fn: '' } })} />);
    const save = screen.getByRole('button', { name: 'Save case' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    const why = document.getElementById(save.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent).toMatch(/function a name/);
  });

  it('deletes only after a second press', async () => {
    const onDelete = vi.fn();
    renderUi(<CaseEditor {...props({ existing: true, onDelete })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete case' }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
