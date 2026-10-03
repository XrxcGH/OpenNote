import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYERS_CSS, layerOrderStatement, withLayerOrder } from './layer-order.ts';

describe('layerOrderStatement', () => {
  it('reads the order from styles/layers.css', () => {
    expect(layerOrderStatement(readFileSync(LAYERS_CSS, 'utf8'))).toBe('@layer tokens,base,components,states,forced;');
  });

  it('skips a block @layer and finds the order statement', () => {
    const css = '@layer base { a { color: red; } }\n@layer one,\n  two;';
    expect(layerOrderStatement(css)).toBe('@layer one,two;');
  });

  it('throws when the file has no order statement, so the build fails instead of shipping the wrong order', () => {
    expect(() => layerOrderStatement('@layer base { a { color: red; } }')).toThrow(/no @layer order/);
  });
});

describe('withLayerOrder', () => {
  const statement = '@layer tokens,base,components,states,forced;';

  it('puts the order in front of a sheet that opens with a later layer', () => {
    const css = '@layer components{._row_1{outline-offset:-2px}}';
    expect(withLayerOrder(css, statement)).toBe(`${statement}${css}`);
  });

  it('leaves a sheet that already starts with the order as it is', () => {
    const css = `${statement}@layer base{a{color:red}}`;
    expect(withLayerOrder(css, statement)).toBe(css);
  });
});
