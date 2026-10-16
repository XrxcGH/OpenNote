import { describe, expect, it } from 'vitest';
import {
  applyLinks,
  isWebAddress,
  linksEdit,
  linksOf,
  linksTouched,
  liveLinks,
  makeLinkChange,
  removeLinkChange,
} from './inkLinks';

const page = { kind: 'page', page: 'P1' } as const;

describe('links on handwriting', () => {
  it('reads links from a page view and skips what is not a link', () => {
    const links = linksOf({
      inkLinks: {
        a: {
          block: 'B1',
          strokes: ['s1', 's2'],
          target: { kind: 'page', page: 'P1', heading: 'Intro' },
          label: 'Intro',
        },
        b: { block: 'B1', strokes: [], target: page, label: 'empty' },
        c: { block: 'B1', strokes: ['s3'], target: { kind: 'url', url: 'javascript:alert(1)' }, label: 'bad' },
        d: { block: 'B1', strokes: ['s4'], target: { kind: 'recording' }, label: 'Rec' },
        e: 'nope',
      },
    });
    expect([...links.keys()]).toEqual(['a', 'd']);
    expect(links.get('a')?.target).toEqual({ kind: 'page', page: 'P1', heading: 'Intro' });
    expect(linksOf(null).size).toBe(0);
    expect(linksOf({ inkLinks: [] }).size).toBe(0);
  });

  it('accepts only web and mail addresses', () => {
    expect(isWebAddress('https://example.com/a?b=1')).toBe(true);
    expect(isWebAddress('mailto:me@example.com')).toBe(true);
    expect(isWebAddress('file:///C:/secret')).toBe(false);
    expect(isWebAddress('javascript:alert(1)')).toBe(false);
  });

  it('makes a link, replaces the links its strokes were in, and removes it, each as one view patch', () => {
    const first = makeLinkChange(new Map(), ['s1', 's2'], 'B1', page, 'Notes', 'L1');
    expect(first).not.toBeNull();
    let links = applyLinks(new Map(), first!);
    expect(linksTouched(links, ['s2'])).toEqual(['L1']);
    const second = makeLinkChange(links, ['s2', 's3'], 'B1', { kind: 'url', url: 'https://example.com' }, 'Site', 'L2');
    expect(second).toMatchObject({ L1: null });
    links = applyLinks(links, second!);
    expect([...links.keys()]).toEqual(['L2']);
    expect(linksEdit(second!)).toEqual({
      edit: 'setPage',
      view: {
        inkLinks: {
          L1: null,
          L2: {
            block: 'B1',
            strokes: ['s2', 's3'],
            target: { kind: 'url', url: 'https://example.com' },
            label: 'Site',
          },
        },
      },
    });
    expect(removeLinkChange(links, ['s9'])).toBeNull();
    expect(removeLinkChange(links, ['s3'])).toEqual({ L2: null });
    expect(makeLinkChange(links, [], 'B1', page, 'x')).toBeNull();
  });

  it('lists only the links whose writing is still on the page', () => {
    const links = linksOf({
      inkLinks: {
        a: { block: 'B', strokes: ['s1', 's2'], target: page, label: 'A' },
        b: { block: 'B', strokes: ['s3'], target: page, label: 'B' },
      },
    });
    const live = liveLinks(links, (id) => id !== 's3' && id !== 's2');
    expect(live.map(([id, link]) => [id, link.strokes])).toEqual([['a', ['s1']]]);
  });
});
