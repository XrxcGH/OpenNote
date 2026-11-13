// @vitest-environment jsdom

// The page settings an editor reads from the page's `view.text` (format spec 5.4.2). The defaults are the spec's:
// no automatic hyphenation and a tab stop every 36 points. An invalid value reads as missing (R-VIEW-4).
import { describe, expect, it } from 'vitest';
import { pageSettingsOf } from './editorHost';

describe('page settings for the editor', () => {
  it('reads hyphenate and defaultTab from view.text', () => {
    expect(pageSettingsOf({ text: { hyphenate: true, defaultTab: 18 } })).toEqual({
      text: { hyphenate: true, defaultTab: 18 },
    });
  });

  it('uses the defaults when the page sets nothing or sets an invalid value', () => {
    const defaults = { text: { hyphenate: false, defaultTab: 36 } };
    expect(pageSettingsOf(undefined)).toEqual(defaults);
    expect(pageSettingsOf({})).toEqual(defaults);
    expect(pageSettingsOf({ text: 'yes' })).toEqual(defaults);
    expect(pageSettingsOf({ text: { hyphenate: 'yes', defaultTab: -4 } })).toEqual(defaults);
  });
});
