// @vitest-environment jsdom
// The text block's static page draws what its editor will draw: the block's list definitions and paragraph data are
// applied to it, so mounting an editor changes no label.
import { afterEach, describe, expect, it } from 'vitest';
import { textPageFixture } from '../test/fixtures';
import { cleanupPages, renderPage } from '../test/harness';
import '../register';

afterEach(cleanupPages);

describe('the text block before an editor mounts', () => {
  it('labels list items from the block list definitions', async () => {
    const fixture = textPageFixture('1. one\n2. two');
    const data = fixture.page.blocks[0].data as Record<string, unknown>;
    data.ids = ['a', 'b'];
    data.paras = { a: { list: { id: 'l1' } }, b: { list: { id: 'l1' } } };
    data.lists = { l1: { levels: [{ format: 'upperRoman', text: '%1)' }] } };
    const page = await renderPage({ fixture });
    const items = [...page.wrapper(fixture.page.blocks[0].id).querySelectorAll('li')];
    expect(items.map((item) => item.style.getPropertyValue('--list-label'))).toEqual(['"I) "', '"II) "']);
  });
});
