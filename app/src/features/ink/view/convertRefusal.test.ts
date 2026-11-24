// Convert to text never does nothing: with the feature off it offers to turn it on, and every other refusal says why.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as flags from '../../../app/flags';
import { t } from '../../../strings/t';
import { convertSelection } from './handwriting';
import type { InkHost } from './host';
import type { InkSurface } from './surface';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../../../ui', async (original) => ({ ...(await original<object>()), showToast: toast }));

/** A drawn stroke has point times; a shape's points have none. */
const written = { id: 's', points: [{ x: 0, y: 0, time: 0 }] };
const surface = (readOnly = false) => ({ readOnly, strokes: () => [written] }) as unknown as InkSurface;
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
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: t('ink.handwriting.unavailable') }));
  });

  it('tells the person to select handwriting first', async () => {
    vi.spyOn(flags, 'isEnabled').mockReturnValue(true);
    await convertSelection(
      hostWith(() => Promise.resolve(true), []),
      { ...surface(), strokes: () => [] } as never,
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: t('ink.handwriting.selectFirst') }));
  });

  it('says a read-only page cannot be changed', async () => {
    vi.spyOn(flags, 'isEnabled').mockReturnValue(true);
    await convertSelection(
      hostWith(() => Promise.resolve(true)),
      surface(true),
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: t('ink.handwriting.readOnly') }));
  });

  it('reads no shape as text, and says no handwriting was found (walk 9, T1-D03-9)', async () => {
    vi.spyOn(flags, 'isEnabled').mockReturnValue(true);
    const ensure = vi.fn(() => Promise.resolve(true));
    const host = hostWith(ensure);
    const rectangle = { id: 's', points: [0, 1, 2, 3, 4].map((i) => ({ x: i % 2, y: i > 1 ? 1 : 0 })) };
    await convertSelection(host, { ...surface(), strokes: () => [rectangle] } as never);
    expect(host.handwriting!.recognize).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: t('ink.handwriting.none') }));
  });
});
