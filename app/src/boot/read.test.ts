import { describe, expect, it } from 'vitest';
import { applyMergePatch } from '../platform/mergePatch';
import { DEFAULT_SETTINGS } from '../state/settings';
import { defaultBootData, mergeBoot } from './defaults';
import { readBoot, readDevOptions } from './read';

describe('boot data', () => {
  it('falls back to web defaults without a payload from Rust', () => {
    const boot = readBoot();
    expect(boot.bootVersion).toBe(1);
    expect(boot.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('merges partial overrides key by key', () => {
    const boot = mergeBoot(defaultBootData(), { os: { dark: true }, settings: { appearance: { theme: 'dark' } } });
    expect(boot.os).toMatchObject({ dark: true, zoom: 1 });
    expect(boot.settings.appearance).toMatchObject({ theme: 'dark', textSize: 100 });
  });

  it('reads development options from the address', () => {
    expect(readDevOptions('?fixture=large&pseudo')).toEqual({ fixture: 'large', pseudo: true });
    expect(readDevOptions('?fixture=nope')).toEqual({ fixture: undefined, pseudo: false });
  });
});

describe('applyMergePatch', () => {
  it('follows RFC 7396', () => {
    const target = { a: { b: 1, c: 2 }, list: [1, 2], keep: true };
    expect(applyMergePatch(target, { a: { b: null, d: 3 }, list: [3] })).toEqual({
      a: { c: 2, d: 3 },
      list: [3],
      keep: true,
    });
    expect(target).toEqual({ a: { b: 1, c: 2 }, list: [1, 2], keep: true });
    expect(applyMergePatch({ a: 1 }, 'text')).toBe('text');
  });
});
