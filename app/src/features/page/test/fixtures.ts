// Deterministic pages for tests and benchmarks (PLAN.md section 3.15, owned by WP0). They are built in
// services/pages/fixtures.ts, so the web platform's ?fixture= reaches them too, and each is made on first use.
import { pageFixture } from '../../../services/pages/fixtures';
import type { PageFixture } from '../../../services/pages/memory';

export type { PageFixture } from '../../../services/pages/memory';
export { longNoteMarkdown } from '../../../services/pages/fixtures';

export const pageFixtures: {
  /** Every node, mark, and callout type, a table, code, images, and a cropped image. */
  readonly sampler: PageFixture;
  readonly short: PageFixture;
  /** ADR 0005's 20-page note, in one text block. */
  readonly twentyPage: PageFixture;
  /** One bulleted list of about 1,200 items, four levels deep. */
  readonly twentyPageOutline: PageFixture;
  /** The 20-page note inside one callout. */
  readonly twentyPageCallout: PageFixture;
  /** Eight floating text boxes, one of them the 20-page note. */
  readonly freeform8: PageFixture;
  /** 500 blocks with 20 photos, 5 tables, and 10 code blocks. */
  readonly budget500: PageFixture;
} = {
  get sampler() {
    return pageFixture('sampler');
  },
  get short() {
    return pageFixture('short');
  },
  get twentyPage() {
    return pageFixture('twentyPage');
  },
  get twentyPageOutline() {
    return pageFixture('twentyPageOutline');
  },
  get twentyPageCallout() {
    return pageFixture('twentyPageCallout');
  },
  get freeform8() {
    return pageFixture('freeform8');
  },
  get budget500() {
    return pageFixture('budget500');
  },
};

/** A page with one text block holding `markdown`. */
export function textPageFixture(markdown: string): PageFixture {
  const at = '2026-10-01T09:00:00.000Z';
  const block = { id: '01k6f0000000000000000t0001', type: 'text', order: 'a0', created: at, modified: at };
  return {
    page: {
      id: '01k6f0000000000000000p0001',
      title: 'Test page',
      created: at,
      modified: at,
      tags: [],
      view: {},
      blocks: [{ ...block, data: { markdown } }],
      assets: {},
    },
  };
}
