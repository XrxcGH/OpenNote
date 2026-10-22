// The 3D graph view, the parametric trace, and the math tool windows, in a real browser.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { INSERT_EVENT } from '../../tools/flags';
import { GraphView } from '../graph/GraphView';
import { Graph3DView } from './Graph3DView';
import { ProjectileTool } from './tools/ProjectileTool';
import { SolidsTool } from './tools/SolidsTool';
import { VectorsTool } from './tools/VectorsTool';

/** A graph block's view with its text kept in state, as the editor keeps it in the block. */
function Block({ start, three, onText }: { start: string; three?: boolean; onText?: (text: string) => void }) {
  const [text, setText] = useState(start);
  const View = three ? Graph3DView : GraphView;
  return (
    <View
      source={text}
      editable
      onSource={(next) => {
        setText(next);
        onText?.(next);
      }}
    />
  );
}

const inserted: { text?: string; graph?: string }[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; graph?: string; handled: boolean }>).detail;
  inserted.push({
    ...(detail.text === undefined ? {} : { text: detail.text }),
    ...(detail.graph === undefined ? {} : { graph: detail.graph }),
  });
  detail.handled = true;
};
window.addEventListener(INSERT_EVENT, listen);
afterEach(() => {
  inserted.splice(0);
  vi.restoreAllMocks();
});

describe('the 3D graph', () => {
  it('draws a surface, turns with the keys, and keeps the turn in its text', async () => {
    const texts: string[] = [];
    const { container } = renderUi(<Block three start={'@3d\nz = x^2 - y^2'} onText={(text) => texts.push(text)} />);
    const plot = screen.getByRole('application', { name: '3D graph of 1 item' });
    expect(plot.querySelectorAll('polygon').length).toBe(900);
    plot.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(texts.at(-1)).toContain('@angle -50 25');
    await expectNoAxeViolations(container);
  });

  it('switches to the contour plot and shows the tangent plane with its equation', async () => {
    renderUi(<Block three start={'@3d\nz = 2x^2 + y^2'} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tangent plane' }));
    expect(screen.getByText(/Tangent plane at \(1, 1, 3\): z = 3 \+ 4\(x − 1\) \+ 2\(y − 1\)/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Contour' }));
    const plot = screen.getByRole('application');
    expect(plot.querySelectorAll('polygon').length).toBe(0);
    expect(plot.querySelectorAll('line').length).toBeGreaterThan(100);
    expect(screen.getByRole('button', { name: 'Contour' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('says what is wrong with a line it cannot read', async () => {
    renderUi(<Block three start={'@3d\nvector <1>'} />);
    expect(screen.getByRole('status').textContent).toContain('Write a vector as');
  });
});

describe('the parametric trace', () => {
  it('moves a dot along the curve with the slider and plays it', async () => {
    const { container } = renderUi(<Block start={'(cos t, sin t)\n@view -2 2 -1.2 1.2'} />);
    const slider = screen.getByRole('slider', { name: 'Trace position, t' });
    fireEvent.change(slider, { target: { value: String(Math.PI / 2) } });
    expect(screen.getByText(/At t = 1.571: x = 0, y = 1/)).toBeTruthy();
    const play = screen.getByRole('button', { name: 'Play trace' });
    await userEvent.click(play);
    expect(screen.getByRole('button', { name: 'Pause trace' }).getAttribute('aria-pressed')).toBe('true');
    await expectNoAxeViolations(container);
  });

  it('has no Play button when the system asks for reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('reduce'), media: query }) as unknown as MediaQueryList,
    );
    renderUi(<Block start={'r = 1 + cos θ'} />);
    expect(screen.queryByRole('button', { name: 'Play trace' })).toBeNull();
    expect(screen.getByRole('slider', { name: 'Trace position, t' })).toBeTruthy();
  });
});

describe('the math tool windows', () => {
  it('work the vector products and insert them with a plot', async () => {
    const { container } = renderUi(<VectorsTool />);
    const results = screen.getByRole('group', { name: 'Results' });
    expect(within(results).getByText('⟨-43, 13, 1⟩')).toBeTruthy();
    expect(within(results).getByText('3')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert into page' }));
    expect(inserted[0].text).toContain('a · b = 3');
    expect(inserted[1].graph).toContain('vector <-43, 13, 1>');
    await expectNoAxeViolations(container);
  });

  it('find the distance between skew lines', async () => {
    renderUi(<VectorsTool />);
    await userEvent.click(screen.getByRole('tab', { name: 'Lines and planes' }));
    expect(screen.getByText('They are skew: not parallel, and they never meet.')).toBeTruthy();
    expect(screen.getByText('Distance: 0.527504')).toBeTruthy();
  });

  it('find the volume of a solid of revolution with steps', async () => {
    const { container } = renderUi(<SolidsTool />);
    expect(screen.getByText(/Volume: 25.132741/).textContent).toContain('Exactly 8π');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
    expect(document.querySelectorAll('polygon').length).toBeGreaterThan(500);
    await expectNoAxeViolations(container);
  });

  it('fly a projectile and insert its graph and values', async () => {
    const { container } = renderUi(<ProjectileTool />);
    expect(screen.getByText('Range: 40.77 m')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Launch' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(document.querySelector('circle')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Insert into page' }));
    expect(inserted[0].text).toContain('Range: 40.77 m');
    expect(inserted[1].graph).toMatch(/^\(14\.1421 t, 14\.1421 t - 4\.905 t\^2\)/);
    await expectNoAxeViolations(container);
  });
});
