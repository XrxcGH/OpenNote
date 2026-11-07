// The web fakes of the font list and the notebook styles.

import { describe, expect, it } from 'vitest';
import { FAKE_FONTS, createWebFonts, createWebNotebookStyles } from './fonts';

describe('the fake font list', () => {
  it('is fixed, sorted by name, and has a monospace family and four faces each', async () => {
    const list = await createWebFonts().list();
    expect(list).toBe(FAKE_FONTS);
    expect(list.map((f) => f.name)).toEqual([...list.map((f) => f.name)].sort());
    expect(list.filter((f) => f.monospace).map((f) => f.name)).toEqual(['Fake Mono']);
    for (const family of list) expect(family.faces.map((f) => [f.weight, f.style])).toHaveLength(4);
  });
});

describe('the fake notebook styles', () => {
  it('returns what was set, by copy, and an empty object clears it', async () => {
    const client = createWebNotebookStyles();
    expect(await client.get('n1')).toEqual({});
    const styles = { Normal: { size: 11.5 } };
    await client.set('n1', styles);
    const back = await client.get('n1');
    expect(back).toEqual(styles);
    expect(back).not.toBe(styles);
    expect(await client.get('n2')).toEqual({});
    await client.set('n1', {});
    expect(await client.get('n1')).toEqual({});
  });
});
