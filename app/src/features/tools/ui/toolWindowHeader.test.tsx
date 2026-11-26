// The tool window header keeps its room for the title: Keep on top and Open in its own window are icon buttons
// with tooltips, and the title carries its full text as a tooltip (walk 9, W9-VB-1).
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { ToolWindow } from './ToolWindow';
import { TOOLS } from './tools';

describe('tool window header', () => {
  it('shows Keep on top and Open in its own window as icon buttons, not text', () => {
    renderUi(
      <ToolWindow
        tool={TOOLS[0]}
        width={320}
        right={0}
        overlay
        stack={1}
        onRaise={() => {}}
        maxWidth={600}
        onResize={() => {}}
        pinned={false}
        onPin={() => {}}
        onClose={() => {}}
        onPopOut={() => {}}
      >
        <p>body</p>
      </ToolWindow>,
    );
    for (const name of ['Keep on top', 'Open in its own window']) {
      const button = screen.getByRole('button', { name });
      expect(button.textContent, name).toBe('');
      expect(button.querySelector('svg'), name).not.toBeNull();
    }
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.getAttribute('title')).toBe(heading.textContent);
  });
});
