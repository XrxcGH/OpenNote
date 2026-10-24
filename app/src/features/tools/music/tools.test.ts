// checks-disable-file brand-consistency: color values are data here, not styling
import { describe, expect, it } from 'vitest';
import { spec as camera } from './camera/tool';
import { initialValues, runTool } from './spec';
import type { ToolSpec } from './spec';
import { spec as studio } from './studio/tool';

/** Runs a tool in a mode with a few fields changed from their starting values. */
function run(tool: ToolSpec, mode: string, changes: Record<string, string> = {}) {
  return runTool(tool, { ...initialValues(tool), mode, ...changes });
}

const rowOf = (result: ReturnType<typeof run>, key: string): string | undefined =>
  result.ok ? result.rows.find((r) => r.key === key)?.value : undefined;

describe('the camera tool as a student uses it', () => {
  it('reads a shutter time typed as a fraction', () => {
    expect(rowOf(run(camera, 'exposure', { aperture: '8', shutter: '1/125' }), 'ev100')).toBe('12.97');
  });
  it('gives the equivalent shutter for another aperture', () => {
    const result = run(camera, 'exposure', { aperture: '8', shutter: '1/125', newAperture: '4' });
    expect(rowOf(result, 'equivShutter')).toBe('1/500 s');
    expect(rowOf(result, 'stopsChange')).toBe('−2.00');
  });
  it('gives the depth of field in feet when asked', () => {
    const result = run(camera, 'depth', { focal: '50', aperture: '8', distance: '10', units: 'ft' });
    expect(rowOf(result, 'hyperfocal')).toContain('ft');
    expect(rowOf(result, 'cocUsed')).toBe('0.03 mm');
  });
  it('shows infinity past the hyperfocal distance', () => {
    expect(rowOf(run(camera, 'depth', { distance: '20' }), 'farLimit')).toBe('∞');
  });
  it('counts drop-frame frames and turns them back into timecode', () => {
    expect(rowOf(run(camera, 'timecode', { tc: '01:00:00;00' }), 'frameCount')).toBe('107,892');
    expect(rowOf(run(camera, 'timecode', { frames: '107892' }), 'timecodeOut')).toBe('01:00:00;00');
  });
  it('says when a drop-frame number does not exist', () => {
    const result = run(camera, 'timecode', { tc: '00:01:00;00' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('camTimecodeDropped');
  });
  it.each([
    ['timecode', { tc: 'soon' }, 'camTimecodeFormat'],
    ['timecode', { tc: '00:00:00:99', rate: '30' }, 'camTimecodeRange'],
    ['timecode', { frames: '1.5' }, 'camFramesInteger'],
    ['shutter', { angle: '400' }, 'camAngleRange'],
    ['exposure', { aperture: '' }, 'number'],
    ['exposure', { aperture: '-2' }, 'positive'],
    ['depth', { distance: '0.01' }, 'camFocusClose'],
    ['ratio', { key: '50', fill: '100' }, 'camFillBright'],
    ['beam', { spread: '180' }, 'camSpreadRange'],
  ])('rejects %s with %j as %s', (mode, changes, error) => {
    const result = run(camera, mode, changes);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe(error);
  });
  it('plans animation on twos and lights at a distance', () => {
    expect(rowOf(run(camera, 'animation', { seconds: '2', fps: '24', hold: '2' }), 'drawingCount')).toBe('24');
    expect(rowOf(run(camera, 'inverse', { lux0: '100', d1: '10', d2: '20', units: 'ft' }), 'levelLux')).toBe(
      '269.1 lux',
    );
    expect(rowOf(run(camera, 'color', { k1: '3200', k2: '5600' }), 'miredShift')).toBe('−133.93');
  });
  it('stores a bit rate and an uncompressed recording', () => {
    expect(rowOf(run(camera, 'media', { mbps: '50', seconds: '3600' }), 'storage')).toBe('22.5 GB');
    expect(rowOf(run(camera, 'media', { media: 'raw', seconds: '1' }), 'audioRate')).toBe('2.304 Mb/s');
  });
});

describe('the studio tool as a student uses it', () => {
  it('scales a length both ways', () => {
    expect(
      rowOf(run(studio, 'scale', { scaleText: '1:50', length: '3.5', lengthUnit: 'm', outUnit: 'mm' }), 'scaleResult'),
    ).toBe('70 mm');
    const back = run(studio, 'scale', {
      scaleText: '1:50',
      length: '70',
      lengthUnit: 'mm',
      outUnit: 'm',
      direction: 'toReal',
    });
    expect(rowOf(back, 'scaleResult')).toBe('3.5 m');
    const architect = run(studio, 'scale', {
      scaleText: '1/4 in = 1 ft',
      length: '12',
      lengthUnit: 'ft',
      outUnit: 'in',
    });
    expect(rowOf(architect, 'scaleResult')).toBe('3 in');
  });
  it('enlarges a sketch by a factor of 6', () => {
    expect(rowOf(run(studio, 'enlarge'), 'enlargeWidth')).toBe('6');
  });
  it('checks contrast with a verdict for each level', () => {
    const result = run(studio, 'contrast', { fg: '#777777', bg: '#fff' });
    expect(rowOf(result, 'contrastRatio')).toBe('4.48 : 1');
    expect(result.ok && result.rows.find((r) => r.key === 'aaNormal')?.word).toBe('wordFail');
    expect(run(studio, 'contrast').ok && 'ok').toBe('ok');
  });
  it('gives the type scale from the base', () => {
    const result = run(studio, 'typescale', { tsBase: '16', tsRatio: '1.25', tsDown: '0', tsUp: '3' });
    expect(result.ok && result.rows.map((r) => r.value)).toEqual(['16', '20', '25', '31.25']);
  });
  it('turns a recipe into a unity formula and a batch', () => {
    const result = run(studio, 'glaze', { recipe: 'CaO.CO2 100.0869\nK2O.Al2O3.6SiO2 556.6718', batch: '' });
    expect(rowOf(result, 'unityAlkali')).toBe('0.500');
    expect(rowOf(result, 'silicaAlumina')).toBe('6.00');
  });
  it.each([
    ['scale', { scaleText: 'tiny' }, 'stuScaleFormat'],
    ['scale', { length: '0' }, 'positive'],
    ['cutlist', { cuts: '120 x 2' }, 'stuTooLong'],
    ['cutlist', { cuts: '' }, 'stuNoPieces'],
    ['cutlist', { cuts: '48 x' }, 'stuBadPiece'],
    ['cutlist', { kerf: '-1' }, 'nonNegative'],
    ['convert', { color: 'chartreuse' }, 'stuColorFormat'],
    ['contrast', { bg: '#12' }, 'stuColorFormat'],
    ['typescale', { tsRatio: '1' }, 'stuRatioOne'],
    ['typescale', { tsUp: '1.5' }, 'stuStepsWhole'],
    ['typescale', { tsUp: '30' }, 'stuTooManySteps'],
    ['perspective', { pHorizon: '1' }, 'stuHorizonRange'],
    ['perspective', { pLines: '1' }, 'stuLinesRange'],
    ['yardage', { pieces: '60 x 10', nap: 'yes' }, 'stuTooWide'],
    ['yardage', { pieces: '20' }, 'stuBadFabric'],
    ['glaze', { recipe: 'SiO2 30' }, 'stuNoFlux'],
    ['glaze', { recipe: 'Unobtainium 4' }, 'stuBadMaterial'],
    ['glaze', { recipe: '' }, 'stuNoRecipe'],
  ])('rejects %s with %j as %s', (mode, changes, error) => {
    const result = run(studio, mode, changes);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe(error);
  });
  it('weighs a marble block and finds fabric for four pieces', () => {
    expect(rowOf(run(studio, 'sculpture'), 'massKg')).toBe('2.7 kg');
    const fabric = run(studio, 'yardage', { pieces: '20 x 30 x 4', fabric: '45' });
    expect(rowOf(fabric, 'fabricLength')).toBe('60 in');
    expect(rowOf(fabric, 'fabricYards')).toBe('1.667 yd');
  });
});
