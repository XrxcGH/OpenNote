import type { ReactElement } from 'react';
import { cdp } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../test';
import { drawn } from '../../test/drawing';
import { Books, Candle, DeskScene, EmptyArt, Glint, InkStroke, Notebook, Plant, StarField, Window } from './index';

const MOTIFS = {
  'Window by day': <Window sky="day" />,
  'Window by night': <Window sky="night" />,
  Plant: <Plant />,
  Candle: <Candle />,
  Books: <Books />,
  Notebook: <Notebook />,
  'Ink stroke': <InkStroke />,
  'Star field': <StarField />,
  'Desk scene by day': <DeskScene sky="day" />,
  'Desk scene by night': <DeskScene sky="night" />,
  'Notebooks shelf': <EmptyArt kind="notebooks" />,
  'Open notebook with a candle': <EmptyArt kind="page" />,
  'Candle beside a stack': <EmptyArt kind="trash" />,
  'Sun glint': <Glint kind="sun" />,
  'Moon glint': <Glint kind="moon" />,
} as const;

/** A color as the browser computes it, from a token or a system color, for comparing with what a drawing paints. */
function colorOf(value: string): string {
  const probe = document.body.appendChild(document.createElement('div'));
  probe.style.color = value.startsWith('--') ? `var(${value})` : value;
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('every drawing', () => {
  for (const [name, element] of Object.entries(MOTIFS)) {
    it(`${name} is hidden from screen readers, can't take focus, and uses only tokens`, () => {
      const { container } = renderUi(element);
      const svg = drawn(container);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.textContent).toBe('');
      const markup = svg.outerHTML;
      expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b(?![^<]*>.*url)/i);
      expect(markup.replace(/url\(#[^)]*\)/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(markup).not.toMatch(/rgba?\(|hsla?\(/i);
      expect(markup).not.toContain('style=');
      expect(markup).not.toMatch(/<(filter|animate|animateTransform|image|foreignObject)/i);
    });

    it(`${name} is under 6 KB of markup`, () => {
      const { container } = renderUi(element);
      expect(drawn(container).outerHTML.length).toBeLessThan(6144);
    });
  }

  it('shows the desk at one and a half times its drawn size, the empty states at 176 px, and a 50 px plant', () => {
    const size = (element: ReactElement) => {
      const { container, unmount } = renderUi(element);
      const box = drawn(container).getBoundingClientRect();
      unmount();
      return [box.width, box.height];
    };
    expect(size(<DeskScene sky="day" />)).toEqual([360, 225]);
    for (const kind of ['notebooks', 'page', 'trash'] as const) expect(size(<EmptyArt kind={kind} />)[0]).toBe(176);
    expect(size(<Plant />)).toEqual([42, 50]);
  });

  for (const [name, element] of Object.entries(MOTIFS).filter(([name]) => name !== 'Star field')) {
    it(`${name} is never wider than the desk scene or taller than it`, () => {
      const box = drawn(renderUi(element).container).getBoundingClientRect();
      expect(box.width).toBeLessThanOrEqual(360);
      expect(box.height).toBeLessThanOrEqual(225);
    });
  }

  it('draws its lines 1.5 px wide at any size', () => {
    const { container } = renderUi(<Plant />);
    const line = container.querySelector('path') as SVGPathElement;
    expect(getComputedStyle(line).strokeWidth).toBe('1.5px');
    expect(getComputedStyle(line).vectorEffect).toBe('non-scaling-stroke');
  });
});

describe('in both themes', () => {
  it.each(['light', 'dark'] as const)('paints the window with the %s theme tokens', (theme) => {
    document.documentElement.dataset.theme = theme;
    const stops = (container: HTMLElement) =>
      [...container.querySelectorAll('stop')].map((stop) => getComputedStyle(stop).stopColor);
    const day = renderUi(<Window sky="day" />);
    const [sky, hills] = [...day.container.querySelectorAll('path')];
    const sun = day.container.querySelector('circle') as Element;
    // A sunset band: paper light at the top, then candle amber behind the sun and dusk rose at the hills.
    expect(getComputedStyle(sky).fill).toMatch(/^url\(/);
    expect(stops(day.container)).toEqual(
      ['--color-accent-candle-subtle', '--color-accent-candle-subtle', '--color-art-candle', '--color-art-dusk'].map(
        colorOf,
      ),
    );
    expect(getComputedStyle(sun).fill).toBe(colorOf('--color-ambient-spark'));
    expect(getComputedStyle(sun).stroke).toBe(colorOf('--color-accent-candle'));
    expect(getComputedStyle(hills).fill).toBe(colorOf('--color-art-moss'));
    day.unmount();
    const night = renderUi(<Window sky="night" />);
    const [, stars, moon, dusk] = [...night.container.querySelectorAll('path')];
    expect(stops(night.container)).toEqual(
      ['--color-accent-night-subtle', '--color-accent-night-subtle', '--color-art-night'].map(colorOf),
    );
    expect(getComputedStyle(stars).stroke).toBe(colorOf('--color-ambient-spark'));
    expect(getComputedStyle(moon).fill).toBe(colorOf('--color-ambient-spark'));
    expect(getComputedStyle(moon).stroke).toBe(colorOf('--color-accent-night'));
    expect(getComputedStyle(dusk).fill).toBe(colorOf('--color-art-dusk'));
  });

  it('draws lines in the control border color, so they read below the text', () => {
    for (const theme of ['light', 'dark'] as const) {
      document.documentElement.dataset.theme = theme;
      const { container, unmount } = renderUi(<Books />);
      expect(getComputedStyle(container.querySelector('path') as Element).stroke).toBe(
        colorOf('--color-border-control'),
      );
      unmount();
    }
  });

  it('gives the two themes different sky colors', () => {
    document.documentElement.dataset.theme = 'light';
    const light = colorOf('--color-ambient-canvas-top');
    document.documentElement.dataset.theme = 'dark';
    expect(colorOf('--color-ambient-canvas-top')).not.toBe(light);
  });
});

describe('in color', () => {
  it.each(['light', 'dark'] as const)('fills the spines, the pot, and the glow with the %s tints', (theme) => {
    document.documentElement.dataset.theme = theme;
    const fills = (element: ReactElement, selector: string) => {
      const { container, unmount } = renderUi(element);
      const found = [...container.querySelectorAll(selector)].map((shape) => getComputedStyle(shape).fill);
      unmount();
      return found;
    };
    // Every book has its own colored spine, never the paper behind it.
    const spines = fills(<Books />, 'path[class]').slice(0, 4);
    expect(spines).toEqual(
      ['--color-art-dusk', '--color-art-moss', '--color-art-night', '--color-art-candle'].map(colorOf),
    );
    // The pot and the candle dish are clay, and the leaves are moss.
    expect(fills(<Plant />, 'path')[0]).toBe(colorOf('--color-art-clay'));
    expect(fills(<Plant />, 'g g path')).toContain(colorOf('--color-art-moss'));
    const candle = renderUi(<Candle />);
    const dish = candle.container.querySelectorAll('path')[4];
    expect(getComputedStyle(dish).fill).toBe(colorOf('--color-art-clay'));
    // The glow is the candle tint at the flame, fading to nothing at its edge.
    const glow = [...candle.container.querySelectorAll('radialGradient stop')].map((stop) => getComputedStyle(stop));
    expect(glow[0].stopColor).toBe(colorOf('--color-art-candle'));
    expect(glow.at(-1)?.stopOpacity).toBe('0');
    candle.unmount();
  });

  it('keeps every drawing tint distinct from the paper it sits on', () => {
    for (const theme of ['light', 'dark'] as const) {
      document.documentElement.dataset.theme = theme;
      const paper = colorOf('--color-surface-page');
      const tints = ['moss', 'clay', 'candle', 'dusk', 'night'].map((tint) => colorOf(`--color-art-${tint}`));
      expect(new Set(tints).size).toBe(5);
      expect(tints).not.toContain(paper);
    }
  });
});

describe('the evening sky', () => {
  it('lights twenty-five stars, three of them larger, none brighter than 80 percent', () => {
    const stars = [...renderUi(<StarField />).container.querySelectorAll('circle')];
    const radii = stars.map((star) => Number(star.getAttribute('r')));
    const opacities = stars.map((star) => Number(star.getAttribute('opacity')));
    expect(stars).toHaveLength(25);
    expect(radii.filter((r) => r >= 1.7)).toHaveLength(3);
    expect(Math.max(...radii)).toBeLessThanOrEqual(1.8);
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(0.75);
    expect(Math.min(...opacities)).toBeGreaterThanOrEqual(0.45);
    expect(Math.max(...opacities)).toBeLessThanOrEqual(0.8);
    // The larger stars are the brightest, so the field has a few points of light and no clutter.
    const big = stars.filter((_, i) => radii[i] >= 1.7).map((star) => Number(star.getAttribute('opacity')));
    expect(Math.min(...big)).toBeGreaterThanOrEqual(0.75);
  });
});

describe('motion', () => {
  it('fades in once over the fast duration and never loops', () => {
    const { container } = renderUi(<DeskScene sky="day" />);
    const style = getComputedStyle(drawn(container));
    expect(style.animationIterationCount).toBe('1');
    expect(style.animationDuration).toBe('0.15s');
    expect(style.animationName).not.toBe('none');
  });

  it('does not fade in with reduced motion', () => {
    document.documentElement.dataset.motion = 'reduce';
    const { container } = renderUi(<Candle />);
    expect(getComputedStyle(drawn(container)).animationName).toBe('none');
    delete document.documentElement.dataset.motion;
  });

  it('stays behind the page and out of the way of the pointer', () => {
    const { container } = renderUi(<StarField />);
    const style = getComputedStyle(drawn(container));
    expect(style.pointerEvents).toBe('none');
    expect(Number(style.zIndex)).toBeLessThan(0);
  });
});

describe('under a Windows contrast theme', () => {
  const emulate = (value: 'active' | 'none') =>
    cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value }] });

  afterEach(() => emulate('none'));

  it('draws plain outlines in the text color, with no fills', async () => {
    await emulate('active');
    const { container } = renderUi(<DeskScene sky="day" />);
    const shapes = [...container.querySelectorAll('path, circle')];
    const text = colorOf('CanvasText');
    expect(shapes.length).toBeGreaterThan(10);
    for (const shape of shapes) {
      expect(getComputedStyle(shape).fill).toBe('none');
      expect(getComputedStyle(shape).stroke).toBe(text);
    }
    // A glow would be an outlined circle around each flame, so it goes.
    const halos = [...container.querySelectorAll('circle[fill^="url"]')];
    expect(halos.length).toBeGreaterThan(0);
    for (const halo of halos) expect(getComputedStyle(halo).display).toBe('none');
  });

  it('hides the stars, which the evening theme otherwise shows', async () => {
    document.documentElement.dataset.theme = 'dark';
    const shown = renderUi(<StarField />);
    expect(getComputedStyle(drawn(shown.container)).display).toBe('block');
    shown.unmount();
    await emulate('active');
    const hidden = renderUi(<StarField />);
    expect(getComputedStyle(drawn(hidden.container)).display).toBe('none');
  });
});
