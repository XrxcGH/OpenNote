// How many elements the browser restyles each time a long table's window moves (sheet-tables.perf.spec.ts). The
// count comes from a trace: each style pass reports the elements it restyled.
import type { JSHandle, Page } from '@playwright/test';

type TraceEvent = {
  name: string;
  ph: string;
  ts: number;
  args?: { elementCount?: number; data?: { message?: string } };
};

/**
 * Scrolls `scroller` down in steps of 80 pixels, two frames each, and returns, for each step that moved the window
 * (the table body gained or lost a row), the elements the browser restyled in that step. Each step starts with a
 * `console.timeStamp`, which the trace keeps on the page's own clock.
 */
export async function restylesPerMove(page: Page, scroller: JSHandle<HTMLElement>, steps: number): Promise<number[]> {
  const client = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  client.on('Tracing.dataCollected', ({ value }) => events.push(...(value as unknown as TraceEvent[])));
  await client.send('Tracing.start', { categories: 'devtools.timeline' });
  const moved = await scroller.evaluate(async (element, steps) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    let changes = 0;
    const seen = new MutationObserver(() => (changes += 1));
    seen.observe(document.querySelector('main table tbody')!, { childList: true });
    const out: number[] = [];
    for (let step = 0; step < steps; step += 1) {
      console.timeStamp(`step${step}`);
      const before = changes;
      element.scrollTop += 80;
      await frame();
      await frame();
      if (changes > before) out.push(step);
    }
    console.timeStamp(`step${steps}`);
    seen.disconnect();
    return out;
  }, steps);
  const done = new Promise((resolve) => client.once('Tracing.tracingComplete', resolve));
  await client.send('Tracing.end');
  await done;
  await client.detach();
  const marks = new Map(
    events
      .filter((e) => e.name === 'TimeStamp' && /^step\d+$/.test(e.args?.data?.message ?? ''))
      .map((e) => [e.args!.data!.message!, e.ts]),
  );
  return moved.map((step) => {
    const from = marks.get(`step${step}`)!;
    const to = marks.get(`step${step + 1}`)!;
    return events
      .filter((e) => e.name === 'UpdateLayoutTree' && e.ph === 'X' && e.ts >= from && e.ts < to)
      .reduce((sum, e) => sum + (e.args?.elementCount ?? 0), 0);
  });
}
