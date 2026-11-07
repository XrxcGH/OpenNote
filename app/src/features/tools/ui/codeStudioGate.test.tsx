// The code studio's tool window follows code.studio: while the flag is off, a window that names the studio
// (a popped window URL with tool=code) renders nothing and never loads the studio's chunk.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../app/flags';
import { renderUi } from '../../../test';
import { ToolBody } from './host';

const load = vi.hoisted(() => vi.fn());
vi.mock('../../codestudio', () => ({ loadCodeStudioWindow: load }));

afterEach(() => initFlags('dev'));

describe('the code studio window gate', () => {
  it('loads nothing while code.studio is off', async () => {
    initFlags('dev', { 'code.studio': false });
    const { container } = renderUi(<ToolBody tool="code" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(load).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('loads the studio window while code.studio is on', async () => {
    load.mockResolvedValue({ CodeStudioWindow: () => <p>Studio body</p> });
    initFlags('dev', { 'code.studio': true });
    renderUi(<ToolBody tool="code" />);
    expect(await screen.findByText('Studio body')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
