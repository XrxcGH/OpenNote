import { describe, expect, it } from 'vitest';
import {
  RATES,
  SENSORS,
  angleOfView,
  animation,
  apertureStops,
  audioBitRate,
  beamDiameter,
  circleOfConfusion,
  cropFactor,
  depthOfField,
  equivalentShutter,
  exposureValue,
  exposureValueAtIso,
  feetAndFrames,
  framesToTimecode,
  inverseSquare,
  LUX_PER_FOOTCANDLE,
  miredShift,
  parseTimecode,
  ratioStops,
  reciprocityTime,
  shutterAngle,
  shutterTime,
  spacing,
  storageBytes,
  timecodeText,
  timecodeToFrames,
  validTimecode,
  videoBitRate,
} from './engine';

const rate = (key: string) => RATES[key]!;
const sensor = (key: string) => SENSORS[key]!;

describe('exposure', () => {
  it('gives the exposure value of two nearly equivalent settings', () => {
    expect(exposureValue(8, 1 / 125)).toBeCloseTo(12.97, 2);
    expect(exposureValue(5.6, 1 / 250)).toBeCloseTo(12.94, 2);
  });
  it('raises the value with the ISO', () => {
    expect(exposureValueAtIso(8, 1 / 125, 400)).toBeCloseTo(exposureValue(8, 1 / 125) + 2, 9);
  });
  it('finds the equivalent shutter for a wider aperture', () => {
    // f/8 to f/4 is two stops: the shutter must be four times shorter.
    expect(equivalentShutter(1 / 60, 8, 4)).toBeCloseTo(1 / 240, 9);
    expect(apertureStops(8, 4)).toBeCloseTo(-2, 9);
  });
  it('applies the reciprocity exponent', () => {
    expect(reciprocityTime(10, 1.31)).toBeCloseTo(20.42, 2);
    expect(reciprocityTime(10, 1)).toBe(10);
  });
});

describe('depth of field', () => {
  it('matches the hand-worked 50 mm f/8 case', () => {
    const d = depthOfField(50, 8, 0.03, 3000);
    expect(d.hyperfocal / 1000).toBeCloseTo(10.467, 3);
    expect(d.near / 1000).toBeCloseTo(2.338, 3);
    expect(d.far / 1000).toBeCloseTo(4.185, 3);
  });
  it('reaches infinity at the hyperfocal distance', () => {
    expect(depthOfField(50, 8, 0.03, 10467).far).toBe(Infinity);
  });
  it('uses the sensor to choose the circle of confusion', () => {
    expect(circleOfConfusion(sensor('fullframe'))).toBeCloseTo(0.03, 3);
  });
});

describe('field of view', () => {
  it('gives the horizontal angle of a 50 mm lens on 36 mm', () => {
    expect((angleOfView(36, 50) * 180) / Math.PI).toBeCloseTo(39.598, 3);
  });
  it('has a crop factor of 1 for full frame and about 1.5 for APS-C', () => {
    expect(cropFactor(sensor('fullframe'))).toBeCloseTo(1, 9);
    expect(cropFactor(sensor('apsc'))).toBeCloseTo(1.527, 2);
  });
});

describe('shutter angle', () => {
  it('is 1/48 s for 180 degrees at 24 fps and back', () => {
    expect(shutterTime(180, 24)).toBeCloseTo(1 / 48, 12);
    expect(shutterAngle(1 / 48, 24)).toBeCloseTo(180, 9);
  });
});

describe('timecode', () => {
  it('counts 107 892 frames in an hour of 29.97 drop-frame', () => {
    expect(timecodeToFrames(parseTimecode('01:00:00;00')!, rate('29.97df'))).toBe(107892);
  });
  it('counts 108 000 frames in an hour of non-drop 30', () => {
    expect(timecodeToFrames(parseTimecode('01:00:00:00')!, rate('30'))).toBe(108000);
  });
  it('skips frame numbers 00 and 01 at minute one of drop-frame but not at minute ten', () => {
    const df = rate('29.97df');
    expect(timecodeText(framesToTimecode(1800, df), true)).toBe('00:01:00;02');
    expect(timecodeText(framesToTimecode(17981, df), true)).toBe('00:09:59;29');
    expect(timecodeText(framesToTimecode(17982, df), true)).toBe('00:10:00;00');
    expect(validTimecode(parseTimecode('00:01:00;00')!, df)).toBe(false);
    expect(validTimecode(parseTimecode('00:10:00;00')!, df)).toBe(true);
  });
  it('round-trips frames across many minute boundaries', () => {
    for (const key of ['29.97df', '59.94df', '24']) {
      for (let n = 0; n < 40000; n += 7) {
        expect(timecodeToFrames(framesToTimecode(n, rate(key)), rate(key))).toBe(n);
      }
    }
  });
  it('rejects text that is not a timecode and frames past the rate', () => {
    expect(parseTimecode('hello')).toBeNull();
    expect(validTimecode(parseTimecode('00:00:00:30')!, rate('30'))).toBe(false);
  });
});

describe('film footage', () => {
  it('runs 90 ft of 35 mm per minute at 24 fps and 36 ft of 16 mm', () => {
    expect(feetAndFrames(24 * 60, 16)).toEqual({ feet: 90, frames: 0 });
    expect(feetAndFrames(24 * 60, 40)).toEqual({ feet: 36, frames: 0 });
    expect(feetAndFrames(100, 16)).toEqual({ feet: 6, frames: 4 });
  });
});

describe('animation', () => {
  it('needs 24 drawings over 48 frames for 2 seconds on twos', () => {
    const a = animation(2, 24, 2);
    expect(a.frames).toBe(48);
    expect(a.drawings).toBe(24);
    expect(a.sheet[1]).toEqual({ drawing: 2, from: 3, to: 4 });
  });
  it('counts a partial last drawing', () => {
    expect(animation(1, 25, 3).drawings).toBe(9);
    expect(animation(1, 25, 3).sheet[8]).toEqual({ drawing: 9, from: 25, to: 25 });
  });
  it('spaces an ease in by squares and an in-out symmetrically', () => {
    expect(spacing(4, 'in')).toEqual([0, 0.0625, 0.25, 0.5625, 1]);
    const inout = spacing(4, 'inout');
    expect(inout[2]).toBe(0.5);
    expect(inout[1]! + inout[3]!).toBeCloseTo(1, 12);
  });
});

describe('lighting', () => {
  it('quarters the illuminance when the distance doubles', () => {
    const fc = inverseSquare(100, 10, 20);
    expect(fc).toBe(25);
    expect(fc * LUX_PER_FOOTCANDLE).toBeCloseTo(269.1, 1);
  });
  it('is two stops for a 4:1 ratio', () => {
    expect(ratioStops(4, 1)).toBe(2);
  });
  it('shifts -133.93 mired from 3200 K to 5600 K', () => {
    expect(miredShift(3200, 5600)).toBeCloseTo(-133.93, 2);
  });
  it('gives the beam width at a throw', () => {
    expect(beamDiameter(10, 90)).toBeCloseTo(20, 9);
  });
});

describe('media', () => {
  it('stores 50 Mb/s for an hour in 22.5 GB', () => {
    expect(storageBytes(50e6, 3600) / 1e9).toBeCloseTo(22.5, 9);
  });
  it('rates uncompressed 1080p 8-bit RGB and 48 kHz stereo', () => {
    expect(videoBitRate(1920, 1080, 24, 24) / 1e6).toBeCloseTo(1194.39, 2);
    expect(audioBitRate(48000, 24, 2)).toBe(2304000);
  });
});
