// The header, footer, and page numbers form and the merge patch it sends. The patch is applied with RFC 7396 and the
// result is read back the way print reads it, so the dialog and the print plan agree.
import { describe, expect, it } from 'vitest';
import { readLineNumbers, readPageNumbers, readSavedBands } from '../../pages';
import { formFrom, validForm } from './HeaderFooterDialog';
import { viewPatch } from './viewSettings';

type Json = Record<string, unknown>;

/** RFC 7396 merge patch. */
function merge(target: unknown, patch: unknown): unknown {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
  const out: Json = typeof target === 'object' && target !== null && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch as Json)) {
    if (value === null) delete out[key];
    else out[key] = merge(out[key], value);
  }
  return out;
}

describe('the header and footer form', () => {
  it('fills from the saved view and saves the same view back', () => {
    const view = {
      print: {
        header: { left: 'Left', firstPage: { center: 'Title page' } },
        footer: { center: '{page}' },
      },
      text: { pageNumbers: { format: 'lowerRoman', start: 3 }, lineNumbers: { countBy: 5 } },
    };
    const form = formFrom(view);
    expect(form.header.first).toEqual({ left: '', center: 'Title page', right: '' });
    expect(form.footer.first).toBeNull();
    expect(form).toMatchObject({ format: 'lowerRoman', start: '3', lines: true, countBy: '5', restart: 'page' });
    const again = merge(view, viewPatch(form, view));
    expect(readSavedBands(again)).toEqual(readSavedBands(view));
    expect(readPageNumbers(again)).toEqual({ format: 'lowerRoman', start: 3 });
    expect(readLineNumbers(again)).toEqual({ start: 1, countBy: 5, restart: 'page' });
  });

  it('removes what is cleared, and removes settings that are back at their defaults', () => {
    const view = {
      print: { header: { left: 'Old', center: 'Old' }, footer: { center: 'x' } },
      text: { pageNumbers: { format: 'upperRoman', start: 4 }, lineNumbers: {} },
    };
    const form = formFrom(view);
    form.header.left = '';
    form.footer.center = '';
    form.format = 'decimal';
    form.start = '1';
    form.lines = false;
    const next = merge(view, viewPatch(form, view)) as { print: Json; text: Json };
    expect(next.print.header).toEqual({ center: 'Old' });
    expect(next.print.footer).toBeUndefined();
    expect(next.text.pageNumbers).toBeUndefined();
    expect(next.text.lineNumbers).toBeUndefined();
  });

  it('keeps an empty first-page band, which hides the band on the first sheet', () => {
    const form = formFrom({ print: { header: { center: 'Hello' } } });
    form.header.first = { left: '', center: '', right: '' };
    const next = merge({ print: { header: { center: 'Hello' } } }, viewPatch(form, {}));
    expect(readSavedBands(next).header).toEqual({ center: 'Hello', firstPage: {} });
  });

  it('writes line numbers with only the keys that differ from the defaults', () => {
    const form = formFrom({});
    form.lines = true;
    form.countBy = '10';
    form.restart = 'continuous';
    form.lineStart = '1';
    const next = merge({}, viewPatch(form, {}));
    expect((next as { text: Json }).text.lineNumbers).toEqual({ countBy: 10, restart: 'continuous' });
  });

  it('refuses text past 200 characters and numbers out of range (R-PRN-1, R-VIEW-2, R-VIEW-3)', () => {
    const ok = formFrom({});
    expect(validForm(ok)).toBe(true);
    expect(validForm({ ...ok, header: { ...ok.header, left: 'x'.repeat(201) } })).toBe(false);
    expect(validForm({ ...ok, header: { ...ok.header, left: 'x'.repeat(200) } })).toBe(true);
    expect(validForm({ ...ok, start: '32768' })).toBe(false);
    expect(validForm({ ...ok, start: '0' })).toBe(true);
    expect(validForm({ ...ok, start: '1.5' })).toBe(false);
    expect(validForm({ ...ok, lines: true, countBy: '0' })).toBe(false);
    expect(validForm({ ...ok, lines: true, countBy: '100', lineStart: '32767' })).toBe(true);
  });
});
