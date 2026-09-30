import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { documents, markdownSource } from './arbitrary';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

// 400 runs keep the suite quick. Set FC_RUNS=100000 for the nightly depth of the Phase 4 design.
const RUNS = Number(process.env.FC_RUNS ?? 400);
const TIMEOUT = 600_000;
const { doc, block } = documents();

describe('round trips (SPEC 7.8)', () => {
  it(
    'parse(serialize(d)) equals d for every canonical document',
    () => {
      fc.assert(
        fc.property(doc, (d) => {
          const markdown = serializeTextBlock(d);
          const back = parseTextBlock(markdown);
          expect(back.toJSON(), markdown).toEqual(d.toJSON());
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'serialize(parse(m)) equals m for every canonical m',
    () => {
      fc.assert(
        fc.property(doc, (d) => {
          const markdown = serializeTextBlock(d);
          expect(serializeTextBlock(parseTextBlock(markdown))).toBe(markdown);
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );

  it('keeps a single block alone in a document', () => {
    fc.assert(
      fc.property(block, (b) => {
        const markdown = serializeTextBlock(b.type.schema.nodes.doc.create(null, b));
        expect(parseTextBlock(markdown).childCount).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('any input', () => {
  it(
    'parses to a valid document, and writing it is stable',
    () => {
      fc.assert(
        fc.property(markdownSource, (source) => {
          const parsed = parseTextBlock(source);
          parsed.check();
          const once = serializeTextBlock(parsed);
          expect(serializeTextBlock(parseTextBlock(once)), `${JSON.stringify(source)} -> ${JSON.stringify(once)}`).toBe(
            once,
          );
        }),
        { numRuns: RUNS },
      );
    },
    TIMEOUT,
  );
});
