import { describe, expect, it } from 'vitest';
import { mapSvg, wrapLines } from './exportMap';
import { mapFileName } from './exportActions';
import type { MapNode } from './tree';

const map: MapNode = {
  id: 'r',
  text: 'Cell <biology> & more',
  children: [
    { id: 'a', text: 'Nucleus', children: [{ id: 'a1', text: 'DNA', children: [] }] },
    { id: 'b', text: 'A long branch name that has to wrap onto several lines', children: [], folded: true },
  ],
};

describe('mind map picture', () => {
  it('lays the map out left to right and describes it for screen readers', () => {
    const { svg, width, height } = mapSvg(map, 'Cell biology');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title>Cell biology</title>');
    expect(svg).toContain('<desc>');
    expect(svg).toContain('Nucleus');
    expect(svg).toContain('DNA');
    expect(svg).toContain('Cell &lt;biology&gt; &amp; more');
    expect(svg).not.toContain('<biology>');
    expect(svg.match(/<path /g)).toHaveLength(3);
    expect(svg.match(/<rect /g)).toHaveLength(5);
    expect(width).toBeGreaterThan(300);
    expect(height).toBeGreaterThan(100);
    // The tree reads from left to right: a deeper level sits further right.
    const xs = [...svg.matchAll(/<rect x="(\d+(?:\.\d+)?)" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="16"/g)].map(
      (m) => Number(m[1]),
    );
    expect(Math.min(...xs)).toBe(24);
    expect(Math.max(...xs)).toBeGreaterThan(200);
  });

  it('keeps folded branches in the picture and wraps long text', () => {
    expect(mapSvg(map, 'x').svg).toContain('A long branch name');
    expect(wrapLines('A long branch name that has to wrap onto several lines', 20)).toEqual([
      'A long branch name',
      'that has to wrap',
      'onto several lines',
    ]);
    expect(wrapLines('   ')).toEqual(['']);
  });

  it('names the file from the main idea', () => {
    expect(mapFileName(map, 'png')).toBe('Cell-biology-more.png');
    expect(mapFileName({ id: 'x', text: '  ', children: [] }, 'svg')).toMatch(/\.svg$/);
  });
});
