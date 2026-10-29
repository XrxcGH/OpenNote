// Convert to text never does nothing: with the feature off it offers to turn it on, and every other refusal says why.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as flags from '../../../app/flags';
import { t } from '../../../strings/t';
import { convertSelection } from './handwriting';
import type { InkHost } from './host';
import type { InkSurface } from './surface';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../../../ui', async (original) => ({ ...(await original<object>()), showToast: toast }));

const surface = (readOnly = false) => ({ readOnly, strokes: () => [{ id: 's', points: [] }] }) as unknown as InkSurface;
const hostWith = (ensure: () => Promise<boolean>, selected = ['s']) =>
  ({
    selection: { get: () => ({ strokes: selected }) },
    queue: { get: () => ({}) },
    handwriting: { ensure, recognize: vi.fn(() => Promise.resolve(null)), tidy: vi.fn() },
  }) as unknown as InkHost;

describe('Convert to text when it cannot run', () => {
  beforeEach(() => toast.mockClear());

  it('offers to turn handwriting reading on when it is off, and says so when declined', async () => {
    vi.spyOn(flags, 'isEnabled').mockImplementation((flag) => flag !== 'intel.handwriting');
    const ensure = vi.fn(() => Promise.resolve(false));
    await convertSelection(hostWith(ensure), surface());
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ message: t('ink.handwriting.unavailable') });
  });

  it('tells the person to select handwriting first', async () => {
    vi.spyOn(flags, 'isEnabled').mockReturnValue(true);
    await convertSelection(
      hostWith(() => Promise.resolve(true), []),
      { ...surface(), strokes: () => [] } as never,
    );
    expect(toast).toHaveBeenCalledWith({ message: t('ink.handwriting.selectFirst') });
  });

  it('says a read-only page cannot be changed', async () => {
    vi.spyOn(flags, 'isEnabled').mockReturnValue(true);
    await convertSelection(
      hostWith(() => Promise.resolve(true)),
      surface(true),
    );
    expect(toast).toHaveBeenCalledWith({ message: t('ink.handwriting.readOnly') });
  });
});
