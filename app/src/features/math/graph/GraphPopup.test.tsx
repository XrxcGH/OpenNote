// The graph beside an equation in a real browser: it opens 2D or 3D as the equation needs, Insert graph hands its
// text to the page, Close shuts it, and it has no axe violations.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../test';
import { graphOfLatex } from '../actions/actions';
import { closeGraphPopup, openGraphPopup } from './GraphPopup';

function anchor(): HTMLElement {
  const button = document.createElement('button');
  button.textContent = 'Equation';
  document.body.append(button);
  return button;
}

afterEach(() => {
  closeGraphPopup();
  document.body.replaceChildren();
});

describe('the graph beside an equation', () => {
  it('opens a 2D graph for y = x^2 and inserts it', async () => {
    const inserted: string[] = [];
    const graph = graphOfLatex('y = x^2')!;
    openGraphPopup({ source: graph.source, anchor: anchor(), equation: 'y = x^2', insert: (s) => inserted.push(s) });
    expect(await screen.findByRole('application', { name: 'Graph of 1 function' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert graph' }));
    expect(inserted).toEqual(['y = x^2']);
    await waitFor(() => expect(document.querySelector('[data-graph-popup]')).toBeNull());
  });

  it('opens a 3D graph for an expression in x and y, and Close shuts it', async () => {
    const graph = graphOfLatex('x y')!;
    expect(graph.three).toBe(true);
    openGraphPopup({ source: graph.source, anchor: anchor(), equation: 'x y' });
    expect(await screen.findByRole('application', { name: '3D graph of 1 function' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close graph' }));
    await waitFor(() => expect(document.querySelector('[data-graph-popup]')).toBeNull());
  });

  it('has no axe violations', async () => {
    openGraphPopup({ source: 'y = sin(x)', anchor: anchor(), equation: 'y = sin(x)' });
    await screen.findByRole('application', { name: 'Graph of 1 function' });
    await expectNoAxeViolations(document.body);
  });
});
