import { beforeEach, describe, expect, it } from 'vitest';
import { resetStores } from '../../../state/store';
import { buttonsOf, DEFAULT_PEN_DEVICE, inkPrefs, notePen, penDevice, penKeyOf, sanitizePen, updatePen } from './prefs';

beforeEach(() => resetStores());

describe('the ink choices of this device', () => {
  it('replaces anything that is not a choice with the default', () => {
    expect(sanitizePen(null)).toEqual(DEFAULT_PEN_DEVICE);
    const odd = sanitizePen({ curve: 'bouncy', barrel: 'teleport', steady: 99.4, minWidth: -3, customCurve: [1, 2] });
    expect(odd).toMatchObject({ curve: 'normal', barrel: 'lasso', steady: 10, minWidth: 0, customCurve: null });
  });

  it('keeps each pen to its own choices and falls back to the default pen', () => {
    updatePen('default', { barrel: 'pan' });
    updatePen('77', { eraserEnd: 'partialEraser' });
    expect(buttonsOf('77')).toEqual({ barrel: 'pan', eraserEnd: 'partialEraser' });
    expect(buttonsOf('99')).toEqual({ barrel: 'pan', eraserEnd: 'strokeEraser' });
    expect(penDevice('99').barrel).toBe('pan');
  });

  it('turns the settings words into the actions the pen tool decides by', () => {
    updatePen('1', { barrel: 'rightClick', eraserEnd: 'nothing' });
    expect(buttonsOf('1')).toEqual({ barrel: 'rightClickMenu', eraserEnd: 'none' });
  });

  it('remembers the pens it has seen, once each', () => {
    notePen(penKeyOf({ persistentDeviceId: 42 }));
    notePen('42');
    expect(inkPrefs.get().seenPens).toEqual(['default', '42']);
    expect(inkPrefs.get().lastPen).toBe('42');
    expect(penKeyOf({})).toBe('default');
  });
});
