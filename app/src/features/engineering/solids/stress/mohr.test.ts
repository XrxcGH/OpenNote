import '../text';
import { describe, expect, it } from 'vitest';
import { en } from '../../../../strings/en';
import { PAGE } from '../kit/picture';
import { mohrSvg } from './mohr';

const say = (key: string) =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en) as string;

describe('Mohr circle axes', () => {
  it('draws the axes with words, never with text keys', () => {
    const svg = mohrSvg(
      {
        kind: 'stress',
        circles: [{ c: 20, r: 65 }],
        points: [{ x: 80, y: 40, label: 'x' }],
        axes: { x: 'kitSolids.stress.plot.sigma', y: 'kitSolids.stress.plot.tau' },
      },
      { system: 'si', palette: PAGE, say },
    );
    expect(svg).toContain('Normal stress, σ');
    expect(svg).toContain('Shear stress, τ (down is positive)');
    expect(svg).not.toContain('kitSolids');
  });
});
