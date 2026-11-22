// Fit width with the desk gutter (shell/layout/deskGutter.ts): a fitted page leaves no spare width, so the gutter then
// settles to 0 and the viewport grows by twice its width. The fit therefore measures the viewport plus both strips.
import { afterEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import { createMemoryPageService } from '../../../services/pages/memory';
import { mountPage } from '../mount';
import type { MountedPage } from '../mount';
import { textPageFixture } from '../test/fixtures';
import { canFitPageWidth, fitPageWidth } from '../zoom';

const shown: { mounted: MountedPage; main: HTMLElement }[] = [];

afterEach(async () => {
  for (const { mounted, main } of shown.splice(0)) {
    await mounted.destroy();
    main.remove();
  }
});

async function openInMain() {
  initFlags('dev', { 'page.editor': true });
  const fixture = textPageFixture('A short page.');
  const service = createMemoryPageService([fixture]);
  const page = await service.open(fixture.page.id, { viewport: null });
  const main = document.body.appendChild(document.createElement('main'));
  Object.assign(main.style, { position: 'fixed', left: '0', top: '0', width: '1000px', height: '500px' });
  const mounted = mountPage(main, page, { classNames: { viewport: '', world: '', underlay: '' }, shown: false });
  shown.push({ mounted, main });
  return { mounted, main };
}

/** What fitWidthZoom makes of a width and the content's right edge. */
const fitted = (width: number, right: number) => Math.floor((width / right) * 100) / 100;

describe('Fit width with the desk gutter', () => {
  it('measures the viewport plus twice the shown gutter', async () => {
    const { mounted, main } = await openInMain();
    const right = mounted.flow.element.offsetLeft + mounted.flow.extent().w;
    const width = mounted.viewport.camera().viewport.w;
    const plain = mounted.flow.fitWidth();
    expect(plain).toBe(fitted(width, right));
    main.dataset.deskGutter = '24';
    expect(mounted.flow.fitWidth()).toBe(fitted(width + 48, right));
    expect(mounted.flow.fitWidth()).toBeGreaterThan(plain);
  });

  it('ignores a gutter of 0', async () => {
    const { mounted, main } = await openInMain();
    const plain = mounted.flow.fitWidth();
    main.dataset.deskGutter = '0';
    expect(mounted.flow.fitWidth()).toBe(plain);
  });
});

describe('the Fit page to width command', () => {
  it('zooms the shown page to the zoom that fits it', async () => {
    initFlags('dev', { 'page.editor': true });
    const fixture = textPageFixture('A short page.');
    const service = createMemoryPageService([fixture]);
    const page = await service.open(fixture.page.id, { viewport: null });
    const main = document.body.appendChild(document.createElement('main'));
    Object.assign(main.style, { position: 'fixed', left: '0', top: '0', width: '1000px', height: '500px' });
    const mounted = mountPage(main, page, { classNames: { viewport: '', world: '', underlay: '' }, shown: true });
    shown.push({ mounted, main });
    // The store holds the function, not what it returned when the page was mounted.
    expect(canFitPageWidth()).toBe(true);
    const expected = mounted.flow.fitWidth();
    expect(expected).toBeGreaterThan(1);
    fitPageWidth();
    expect(mounted.viewport.camera().zoom).toBeCloseTo(expected, 2);
  });
});
