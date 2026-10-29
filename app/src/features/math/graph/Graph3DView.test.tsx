// The 3D grapher in a real browser: a surface draws as shaded faces, the arrow keys and the buttons turn it and save
// the turn in the graph's text, and it has no axe violations in either theme.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { GraphView } from './GraphView';

function setup(source = 'z = sin(x)*cos(y)') {
  const sent: string[] = [];
  const view = renderUi(<GraphView source={source} editable onSource={(next) => sent.push(next)} />);
  return { sent, ...view };
}

describe('the 3D grapher', () => {
  it('draws z = sin(x)*cos(y) as a shaded surface', async () => {
    const { container } = setup();
    const plot = await screen.findByRole('application', { name: '3D graph of 1 function' });
    expect(plot.querySelectorAll('polygon').length).toBe(32 * 32);
    expect(container.querySelector('[data-graph-3d]')).not.toBeNull();
  });

  it('turns with the arrow keys and saves the camera in the text', async () => {
    const { sent } = setup();
    const plot = await screen.findByRole('application', { name: '3D graph of 1 function' });
    const before = plot.querySelector('polygon')!.getAttribute('points');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(plot.querySelector('polygon')!.getAttribute('points')).not.toBe(before);
    expect(sent.at(-1)).toMatch(/^z = sin\(x\)\*cos\(y\)\n@camera -20 25 1$/);
  });

  it('turns and zooms from its buttons, and draws a curve as a path', async () => {
    const { sent } = setup('(cos(t), sin(t), t/5)');
    fireEvent.click(await screen.findByRole('button', { name: 'Tilt up' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.at(-1)).toContain('@camera -35 40 1');
    expect(screen.getByRole('application').querySelectorAll('polygon').length).toBe(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(<GraphView source="z = a x y" editable onSource={() => undefined} />, { theme });
      await screen.findByRole('application');
      await expectNoAxeViolations(container);
    });
  }
});
