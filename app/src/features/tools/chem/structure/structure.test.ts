// Structure drawing: SMILES reading, hydrogens, layout geometry, and the SVG.
import { describe, expect, it } from 'vitest';
import { hillFormula, molarMass } from '../calc/formula';
import { layout } from './layout';
import { draw, drawSmiles, labelText, toSvg } from './render';
import { composition, parseSmiles } from './smiles';
import { TEMPLATES } from './templates';

const formulaOf = (smiles: string): string => {
  const r = parseSmiles(smiles);
  if (!r.ok) throw new Error(`${smiles}: ${r.reason}`);
  return hillFormula(composition(r.molecule));
};

describe('reading SMILES', () => {
  it('counts implicit hydrogens', () => {
    expect(formulaOf('c1ccccc1')).toBe('C6H6');
    expect(formulaOf('CCO')).toBe('C2H6O');
    expect(formulaOf('CC(=O)Oc1ccccc1C(=O)O')).toBe('C9H8O4');
    expect(formulaOf('CC(=O)O')).toBe('C2H4O2');
    expect(formulaOf('C#C')).toBe('C2H2');
    expect(formulaOf('c1ccncc1')).toBe('C5H5N');
    expect(formulaOf('c1ccoc1')).toBe('C4H4O');
    expect(formulaOf('c1ccc2ccccc2c1')).toBe('C10H8');
    expect(formulaOf('[NH4+]')).toBe('H4N');
    expect(formulaOf('ClC(Cl)Cl')).toBe('CHCl3');
  });
  it('gives benzene three double bonds', () => {
    const r = parseSmiles('c1ccccc1');
    expect(r.ok && r.molecule.bonds.filter((b) => b.order === 2).length).toBe(3);
  });
  it('matches textbook molar masses', () => {
    const r = parseSmiles('CC(=O)Oc1ccccc1C(=O)O');
    expect(r.ok && molarMass(hillFormula(composition(r.molecule)))).toBeCloseTo(180.16, 1);
  });
  it('says what is wrong', () => {
    expect(parseSmiles('C(C').ok).toBe(false);
    expect(parseSmiles('C1CC').ok).toBe(false);
    expect(parseSmiles('CX').ok).toBe(false);
    expect(parseSmiles('').ok).toBe(false);
  });
});

describe('layout', () => {
  it('keeps every bond one unit long and no two atoms on top of each other', () => {
    for (const template of TEMPLATES) {
      const parsed = parseSmiles(template.smiles);
      if (!parsed.ok) throw new Error(template.id);
      const { positions } = layout(parsed.molecule);
      for (const bond of parsed.molecule.bonds) {
        const a = positions[bond.a];
        const b = positions[bond.b];
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${template.id} bond`).toBeCloseTo(1, 5);
      }
      for (let i = 0; i < positions.length; i += 1) {
        for (let j = i + 1; j < positions.length; j += 1) {
          expect(
            Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y),
            `${template.id} ${i}-${j}`,
          ).toBeGreaterThan(0.85);
        }
      }
    }
  });
  it('draws a chain as a zigzag and a triple bond straight', () => {
    const r = parseSmiles('CCCC');
    const { positions } = layout(r.ok ? r.molecule : { atoms: [], bonds: [] });
    expect(positions[1].y).not.toBeCloseTo(positions[2].y, 3);
    expect(positions[0].y).toBeCloseTo(positions[2].y, 5);
    const t = parseSmiles('CC#CC');
    const q = layout(t.ok ? t.molecule : { atoms: [], bonds: [] }).positions;
    // All four atoms lie on one line.
    const cross = (a: number, b: number) =>
      (q[a].x - q[0].x) * (q[b].y - q[0].y) - (q[a].y - q[0].y) * (q[b].x - q[0].x);
    expect(cross(1, 2)).toBeCloseTo(0, 5);
    expect(cross(1, 3)).toBeCloseTo(0, 5);
  });
  it('draws a six-ring as a regular hexagon', () => {
    const r = parseSmiles('C1CCCCC1');
    const { positions } = layout(r.ok ? r.molecule : { atoms: [], bonds: [] });
    const cx = positions.reduce((s, p) => s + p.x, 0) / 6;
    const cy = positions.reduce((s, p) => s + p.y, 0) / 6;
    for (const p of positions) expect(Math.hypot(p.x - cx, p.y - cy)).toBeCloseTo(1, 5);
  });
});

describe('drawing', () => {
  it('draws carbon as corners and heteroatoms with letters', () => {
    const r = drawSmiles('CCO');
    expect(r.ok && r.drawing.labels.map((l) => l.text)).toEqual(['OH']);
    const acid = drawSmiles('CC(=O)O');
    expect(acid.ok && acid.drawing.labels.map((l) => l.text).sort()).toEqual(['O', 'OH'].sort());
    const water = drawSmiles('O');
    expect(water.ok && water.drawing.labels[0].text).toBe('OH₂');
  });
  it('puts hydrogens first when the bond runs to the right', () => {
    expect(labelText('O', 1, 0, true)).toBe('HO');
    expect(labelText('N', 2, 0, false)).toBe('NH₂');
    expect(labelText('N', 4, 1, false)).toBe('NH₄⁺');
  });
  it('draws a double bond as two lines and a triple bond as three', () => {
    const d = drawSmiles('C=C');
    expect(d.ok && d.drawing.segments.length).toBe(2);
    const t = drawSmiles('C#C');
    expect(t.ok && t.drawing.segments.length).toBe(3);
    const benzene = drawSmiles('c1ccccc1');
    expect(benzene.ok && benzene.drawing.segments.length).toBe(9);
  });
  it('writes an SVG with a line for each segment and a title', () => {
    const r = drawSmiles('CCO');
    const svg = r.ok ? toSvg(r.drawing, { title: 'Ethanol <test>' }) : '';
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<line /g) ?? []).length).toBe(2);
    expect(svg).toContain('OH');
    expect(svg).toContain('Ethanol &lt;test&gt;');
  });
  it('draws every template', () => {
    for (const template of TEMPLATES) {
      const parsed = parseSmiles(template.smiles);
      expect(parsed.ok, template.id).toBe(true);
      if (parsed.ok) expect(draw(parsed.molecule).segments.length, template.id).toBeGreaterThanOrEqual(0);
    }
  });
});
