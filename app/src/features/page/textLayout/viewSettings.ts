// What the Header, footer, and page numbers dialog edits, and the merge patch of the page's view that saving sends.
// The patch is RFC 7396: a part left empty is sent as null, so it is removed from a band that had it.
import type { PageNumberFormat } from '../../pages';

type Parts = { left: string; center: string; right: string };

/** A header or a footer with its first-page band. `first` is null when the first sheet shows the band itself. */
export interface FooterForm extends Parts {
  first: Parts | null;
}

export interface HeaderFooterForm {
  header: FooterForm;
  footer: FooterForm;
  format: PageNumberFormat;
  /** Text, as typed. */
  start: string;
  lines: boolean;
  countBy: string;
  lineStart: string;
  restart: 'page' | 'continuous';
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function partsPatch(parts: Parts): Record<string, string | null> {
  return {
    left: parts.left === '' ? null : parts.left,
    center: parts.center === '' ? null : parts.center,
    right: parts.right === '' ? null : parts.right,
  };
}

const empty = (parts: Parts): boolean => parts.left === '' && parts.center === '' && parts.right === '';

/** A band's patch. Null (no band) when nothing is left in it. An empty first-page band stays: it hides the band. */
function bandPatch(band: FooterForm): Record<string, unknown> | null {
  if (empty(band) && band.first === null) return null;
  return { ...partsPatch(band), firstPage: band.first === null ? null : partsPatch(band.first) };
}

/**
 * The patch for `view` that makes the page's saved settings match the form. A setting at its default is removed, so
 * a page that never used the feature stays as it was.
 */
export function viewPatch(form: HeaderFooterForm, view: unknown): Record<string, unknown> {
  const text = isObject(view) && isObject(view.text) ? view.text : {};
  const start = Number(form.start);
  const defaultNumbers = form.format === 'decimal' && start === 1;
  const lineNumbers = form.lines
    ? {
        start: Number(form.lineStart) === 1 ? null : Number(form.lineStart),
        countBy: Number(form.countBy) === 1 ? null : Number(form.countBy),
        restart: form.restart === 'page' ? null : form.restart,
      }
    : null;
  return {
    print: { header: bandPatch(form.header), footer: bandPatch(form.footer) },
    text: {
      pageNumbers: defaultNumbers ? null : { format: form.format, start },
      ...(lineNumbers !== null || isObject(text.lineNumbers) ? { lineNumbers } : {}),
    },
  };
}
