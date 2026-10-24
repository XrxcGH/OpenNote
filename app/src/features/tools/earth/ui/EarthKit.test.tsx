// The earth sciences kit in a real browser: no axe violations in either theme, answers in a status region that
// follow what is typed, pictures with names, and Insert that hands the page the answer.
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../flags';
import { chooseMode, chooseTool } from '../state';
import { EarthKit } from './EarthKit';

const answer = () => document.querySelector('[data-earth-answer]')!.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  chooseTool('geophysics');
  chooseMode('geophysics', 'reduction');
});
afterEach(() => localStorage.clear());

describe('the earth sciences kit', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations in the ${theme} theme`, async () => {
      const { container } = renderUi(<EarthKit />, { theme });
      await screen.findByLabelText('Calculation');
      await expectNoAxeViolations(container);
    });
  }

  it('answers as the person types and names an empty field', async () => {
    renderUi(<EarthKit />);
    await screen.findByLabelText('Calculation');
    expect(answer()).toContain('Normal gravity: 9.806197769 m/s²');
    fireEvent.change(screen.getByLabelText('Observed gravity'), { target: { value: '980629.78' } });
    expect(answer()).toMatch(/Simple Bouguer anomaly: 29\.6\d+ mGal/);
    fireEvent.change(screen.getByLabelText('Latitude (degrees)'), { target: { value: '' } });
    expect(answer()).toContain('Fill in Latitude (degrees) to see the answer.');
  });

  it('draws a named picture and inserts the answer into the page', async () => {
    chooseMode('geophysics', 'bodies');
    renderUi(<EarthKit />);
    expect(await screen.findByRole('img', { name: 'Gravity profile' })).toBeTruthy();
    expect(answer()).toContain('Peak anomaly: 0.349466 mGal');
    let inserted = '';
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; handled: boolean }>).detail;
      inserted = detail.text ?? '';
      detail.handled = true;
    };
    window.addEventListener(INSERT_EVENT, listen);
    fireEvent.click(screen.getByRole('button', { name: 'Insert answer' }));
    window.removeEventListener(INSERT_EVENT, listen);
    expect(inserted).toBe('Peak anomaly: 0.349466 mGal');
  });
});
