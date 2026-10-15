import { describe, expect, it } from 'vitest';
import { decodeRecords, encodeRecords } from '../../../core/ink/codec';
import { createStrokeIndex } from '../geometry/strokeIndex';
import { inkStroke, TEST_BLOCK } from '../model/fixtures';
import { recordFromStroke } from '../model/convert';
import { layerRecords, exportOnlyLayer } from './exportSource';
import {
  addLayerPatch,
  applyLayersPatch,
  BASE_LAYER,
  deletePatch,
  drawableLayer,
  excludedFromExport,
  importedLayerPatch,
  inkLayers,
  isHiddenStroke,
  isLockedStroke,
  layerOfStroke,
  layersEdit,
  layersOf,
  moveStrokesPatch,
  movePatch,
  noLayers,
  setLayerPatch,
} from './layers';

const three = () => {
  let layers = noLayers();
  layers = applyLayersPatch(layers, addLayerPatch(layers, 'Tracing', 'L1')!);
  layers = applyLayersPatch(layers, addLayerPatch(layers, 'Notes', 'L2')!);
  return layers;
};

describe('ink layers', () => {
  it('starts with the base layer, and reads a damaged view without throwing', () => {
    expect(layersOf(undefined).order).toEqual([BASE_LAYER]);
    const layers = layersOf({
      inkLayers: {
        order: ['L2', 'gone', 'L2', 'L1'],
        layers: { L1: { name: 'A', hidden: true }, L2: { name: 'B', locked: true }, bad: 7 },
        assign: { s1: 'L1', s2: 'nope', s3: BASE_LAYER },
      },
    });
    expect(layers.order).toEqual([BASE_LAYER, 'L2', 'L1']);
    expect(layers.defs.get('L1')?.hidden).toBe(true);
    expect([...layers.assign]).toEqual([['s1', 'L1']]);
  });

  it('adds, renames, hides, locks, reorders and deletes layers as view patches', () => {
    let layers = three();
    expect(layers.order).toEqual([BASE_LAYER, 'L1', 'L2']);
    layers = applyLayersPatch(layers, setLayerPatch(layers, 'L1', { name: ' Sketch ', hidden: true })!);
    expect(layers.defs.get('L1')).toMatchObject({ name: 'Sketch', hidden: true });
    layers = applyLayersPatch(layers, movePatch(layers, 'L2', 'down')!);
    expect(layers.order).toEqual([BASE_LAYER, 'L2', 'L1']);
    expect(movePatch(layers, 'L1', 'up')).toBeNull();
    layers = applyLayersPatch(layers, moveStrokesPatch(['s1', 's2'], 'L1'));
    expect(layerOfStroke(layers, { id: 's1' })).toBe('L1');
    expect(deletePatch(layers, BASE_LAYER)).toBeNull();
    const del = deletePatch(layers, 'L1')!;
    expect(del.assign).toEqual({ s1: null, s2: null });
    layers = applyLayersPatch(layers, del);
    expect(layers.order).toEqual([BASE_LAYER, 'L2']);
    expect(layerOfStroke(layers, { id: 's1' })).toBe(BASE_LAYER);
    expect(layersEdit({ order: ['a'], assign: { s: null } })).toEqual({
      edit: 'setPage',
      view: { inkLayers: { order: ['a'], assign: { s: null } } },
    });
  });

  it('keeps a piece of a partly erased stroke on its layer, and holds the most layers', () => {
    const layers = applyLayersPatch(three(), moveStrokesPatch(['whole'], 'L2'));
    expect(layerOfStroke(layers, { id: 'piece', origin: 'whole' })).toBe('L2');
    let many = noLayers();
    for (let i = 0; i < 40; i++) {
      const patch = addLayerPatch(many, `L${i}`, `id${i}`);
      if (patch) many = applyLayersPatch(many, patch);
    }
    expect(many.order.length).toBe(24);
  });

  it('puts new ink on the active layer unless it is hidden or locked', () => {
    let layers = three();
    expect(drawableLayer(layers, 'L1')).toBe('L1');
    layers = applyLayersPatch(layers, setLayerPatch(layers, 'L1', { locked: true })!);
    expect(drawableLayer(layers, 'L1')).toBe('L2');
    layers = applyLayersPatch(layers, setLayerPatch(layers, 'L2', { hidden: true })!);
    expect(drawableLayer(layers, 'L1')).toBe(BASE_LAYER);
  });

  it('makes one locked imported layer at the bottom, and keeps it there', () => {
    const layers = applyLayersPatch(three(), importedLayerPatch(three(), 'IMP')!);
    expect(layers.order).toEqual(['IMP', BASE_LAYER, 'L1', 'L2']);
    expect(layers.defs.get('IMP')).toMatchObject({ locked: true, imported: true });
    expect(importedLayerPatch(layers)).toBeNull();
    expect(movePatch(layers, BASE_LAYER, 'down')).toBeNull();
  });

  it('hides and locks strokes in the index so no tool reaches them, while painting still sees locked ones', () => {
    let layers = three();
    layers = applyLayersPatch(layers, moveStrokesPatch(['hidden', 'locked'], 'L1'));
    layers = applyLayersPatch(layers, setLayerPatch(layers, 'L1', { hidden: true })!);
    const index = createStrokeIndex([inkStroke(1), inkStroke(2)]);
    const [a, b] = [...index.all()];
    const marks = new Map([
      [a.id, 'hidden'],
      [b.id, 'locked'],
    ]);
    const via = applyLayersPatch(layers, { assign: { [a.id]: 'L1', [b.id]: 'L2' } });
    const rules = applyLayersPatch(via, setLayerPatch(via, 'L2', { locked: true })!);
    index.exclude((s) => isHiddenStroke(rules, s) || isLockedStroke(rules, s));
    const everything = { minX: -1e5, minY: -1e5, maxX: 1e5, maxY: 1e5 };
    expect(index.query(everything)).toHaveLength(0);
    expect(index.queryAll(everything)).toHaveLength(2);
    index.exclude(null);
    expect(index.query(everything)).toHaveLength(2);
    expect(marks.size).toBe(2);
  });

  it('leaves hidden layers out of print and export, and exports one layer alone', () => {
    const strokes = [
      inkStroke(1, 20, { block: TEST_BLOCK }),
      inkStroke(2, 20, { block: TEST_BLOCK }),
      inkStroke(3, 20, { block: TEST_BLOCK }),
    ];
    const bytes = encodeRecords(
      strokes.map((stroke) => ({ kind: 'stroke' as const, stroke: recordFromStroke(stroke) })),
    );
    let layers = three();
    layers = applyLayersPatch(layers, { assign: { [strokes[1].id]: 'L1', [strokes[2].id]: 'L2' } });
    layers = applyLayersPatch(layers, setLayerPatch(layers, 'L1', { hidden: true })!);
    expect([...excludedFromExport(layers, strokes)]).toEqual([strokes[1].id]);
    expect([...excludedFromExport(layers, strokes, 'L2')].sort()).toEqual([strokes[0].id, strokes[1].id].sort());
    inkLayers.set(layers);
    try {
      const ids = (b: Uint8Array) =>
        decodeRecords(b, { verify: false }).map((r) => (r.kind === 'stroke' ? r.stroke.id : ''));
      expect(ids(layerRecords(bytes))).toEqual([strokes[0].id, strokes[2].id]);
      exportOnlyLayer('L2');
      expect(ids(layerRecords(bytes))).toEqual([strokes[2].id]);
    } finally {
      exportOnlyLayer(undefined);
      inkLayers.set(noLayers());
    }
    expect(layerRecords(bytes)).toBe(bytes);
  });
});
