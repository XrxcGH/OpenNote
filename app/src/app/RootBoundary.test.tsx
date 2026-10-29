import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTestPlatform, renderUi } from '../test';
import { RootBoundary } from './RootBoundary';

function Broken(): never {
  throw new Error('no section named Holiday plans');
}

describe('RootBoundary', () => {
  it('renders the page while nothing fails', () => {
    const platform = createTestPlatform();
    renderUi(
      <RootBoundary platform={platform}>
        <p>The page</p>
      </RootBoundary>,
    );
    expect(screen.getByText('The page')).toBeTruthy();
    expect(platform.window.calls.captionLayout).toEqual([]);
  });

  it('gives the window back its native frame when the page fails to render', () => {
    const platform = createTestPlatform();
    const log = vi.spyOn(platform, 'log');
    // React reports the caught error on the console too; keep the test output quiet.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderUi(
      <RootBoundary platform={platform}>
        <Broken />
      </RootBoundary>,
    );
    consoleError.mockRestore();
    expect(screen.getByRole('alert').textContent).toContain("can't show this window");
    expect(platform.window.calls.captionLayout).toEqual([null]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0])).not.toContain('Holiday');
  });
});
