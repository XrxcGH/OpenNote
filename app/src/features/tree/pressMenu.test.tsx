import { fireEvent, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test';
import { useMenuTriggers } from './pressMenu';

function Row() {
  const row = useRef<HTMLDivElement>(null);
  const press = useMenuTriggers(row, () => ({ label: 'Row menu', items: [{ id: 'one', label: 'One' }] }));
  return (
    <div ref={row} data-testid="row" {...press}>
      Row
    </div>
  );
}

describe('useMenuTriggers', () => {
  it('opens the menu from a pen barrel press', async () => {
    renderUi(<Row />);
    fireEvent.pointerDown(screen.getByTestId('row'), { pointerType: 'pen', button: 2, buttons: 2 });
    expect(await screen.findByRole('menu', { name: 'Row menu' })).toBeTruthy();
  });

  it('opens the menu from a touch press and hold', async () => {
    renderUi(<Row />);
    fireEvent.pointerDown(screen.getByTestId('row'), { pointerType: 'touch', button: 0, clientX: 5, clientY: 5 });
    expect(await screen.findByRole('menu', { name: 'Row menu' }, { timeout: 3000 })).toBeTruthy();
  });

  it('leaves a mouse press alone', async () => {
    renderUi(<Row />);
    fireEvent.pointerDown(screen.getByTestId('row'), { pointerType: 'mouse', button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
