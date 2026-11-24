// Walk fixes VA-19, VA-22 and VB-102: these controls follow the density's target size, not a fixed token.
import { describe, expect, it } from 'vitest';
import { renderUi } from '../test';
import canvas from '../features/canvas/canvas.module.css';
import commandBar from '../shell/commandbar/CommandBar.module.css';
import graph from '../features/graph/graph.module.css';
import readAloud from '../features/page/readAloud/readAloud.module.css';

const height = (element: Element) => element.getBoundingClientRect().height;

describe('target sizes', () => {
  it('keeps the style gallery tiles at the touch size with touch density (VA-19)', () => {
    const view = renderUi(<button className={commandBar.tile}>Normal text</button>, { density: 'touch' });
    expect(height(view.container.querySelector('button')!)).toBeGreaterThanOrEqual(44);
  });

  it('keeps the read-aloud selects at the touch size with touch density (VA-22)', () => {
    const view = renderUi(<select className={readAloud.select} aria-label="Speed" />, { density: 'touch' });
    expect(height(view.container.querySelector('select')!)).toBeGreaterThanOrEqual(44);
  });

  it('makes the graph and canvas disclosure summaries at least 24 px tall (VB-102)', () => {
    const view = renderUi(
      <div>
        <details className={graph.unlinked}>
          <summary>Pages with no links, 1</summary>
        </details>
        <details className={canvas.json}>
          <summary>JSON Canvas</summary>
        </details>
      </div>,
    );
    for (const summary of view.container.querySelectorAll('summary')) {
      expect(height(summary)).toBeGreaterThanOrEqual(24);
    }
  });
});
