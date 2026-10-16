import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initFlags } from '../../app/flags';
import { renderUi } from '../../test';
import { DragRegion, titleBarDragProps } from '.';

const appRegion = (element: Element) => getComputedStyle(element).getPropertyValue('app-region');

function TitleBar({ customFrame }: { customFrame: boolean }) {
  return (
    <header data-testid="bar" style={{ display: 'flex' }} {...titleBarDragProps(customFrame)}>
      <span>Lectures › Cell structure</span>
      <DragRegion />
      <button type="button">Dark mode</button>
    </header>
  );
}

describe('DragRegion in a dragging title bar', () => {
  it('drags from the gap and the bar, while the text and controls stay page content', () => {
    initFlags('dev', { 'shell.customFrame': true });
    renderUi(<TitleBar customFrame />);
    const gap = document.querySelector('[aria-hidden][data-app-region]');
    expect(gap && appRegion(gap)).toBe('drag');
    expect(appRegion(screen.getByTestId('bar'))).toBe('drag');
    expect(appRegion(screen.getByText('Lectures › Cell structure'))).toBe('no-drag');
    expect(appRegion(screen.getByRole('button', { name: 'Dark mode' }))).toBe('no-drag');
  });

  it('is ordinary layout with the flag off', () => {
    initFlags('dev', { 'shell.customFrame': false });
    renderUi(<TitleBar customFrame={false} />);
    expect(document.querySelector('[data-app-region]')).toBeNull();
    expect(appRegion(screen.getByTestId('bar'))).not.toBe('drag');
  });
});
