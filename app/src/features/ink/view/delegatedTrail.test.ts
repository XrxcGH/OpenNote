// checks-disable-file brand-consistency: the test colors are inputs to the code under test, not design colors
import { describe, expect, it, vi } from 'vitest';
import { createTrail, requestPresenter } from './delegatedTrail';
import type { InkPresenter } from './delegatedTrail';

const event = (trusted: boolean) => ({ isTrusted: trusted }) as PointerEvent;

describe('the delegated ink trail', () => {
  it('asks the browser for a presenter over the area, and reports none where there is no ink API', async () => {
    const area = {} as Element;
    const presenter: InkPresenter = { updateInkTrailStartPoint: vi.fn() };
    const requestPresenterFn = vi.fn().mockResolvedValue(presenter);
    expect(await requestPresenter(area, { requestPresenter: requestPresenterFn })).toBe(presenter);
    expect(requestPresenterFn).toHaveBeenCalledWith({ presentationArea: area });
    expect(await requestPresenter(area, { requestPresenter: () => Promise.reject(new Error('no')) })).toBeNull();
    expect(await requestPresenter(area)).toBeNull(); // this test environment has no navigator.ink
  });

  it('passes the trusted pen event with the pen color and a diameter of at least a pixel, and counts the time', () => {
    const update = vi.fn();
    let clock = 0;
    const trail = createTrail({ updateInkTrailStartPoint: update }, () => (clock += 0.5));
    const e = event(true);
    trail.update(e, '#2b2521', 0.2);
    trail.update(e, '#2b2521', 4);
    expect(update).toHaveBeenNthCalledWith(1, e, { color: '#2b2521', diameter: 1 });
    expect(update).toHaveBeenNthCalledWith(2, e, { color: '#2b2521', diameter: 4 });
    expect(trail.stats()).toEqual({ supported: true, updates: 2, skipped: 0, totalMs: 1, maxMs: 0.5 });
  });

  it('skips synthetic events and a presenter that throws, and does nothing without a presenter', () => {
    const trail = createTrail({
      updateInkTrailStartPoint: () => {
        throw new Error('refused');
      },
    });
    trail.update(event(false), 'red', 3);
    trail.update(event(true), 'red', 3);
    expect(trail.stats()).toMatchObject({ updates: 0, skipped: 2 });
    const none = createTrail(null);
    none.update(event(true), 'red', 3);
    expect(none.stats()).toEqual({ supported: false, updates: 0, skipped: 0, totalMs: 0, maxMs: 0 });
  });
});
