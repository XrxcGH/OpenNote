// The series a page belongs to. A series id is a page property named "Series", kept in the page's own file, so the
// list of a series' pages follows the notebook. The property's value is a short id shared by every page in the series.
import { newId } from '../../../editor/ids';
import { fieldNamed, readFields, viewPatch } from '../../search';
import type { Field } from '../../search';
import type { PagesClient } from '../../../platform/types';

export const SERIES_PROPERTY = 'Series';

/** What the list needs to know about a page. */
export interface SeriesRow {
  page: string;
  title: string;
  created: number;
  fields: readonly Field[];
}

/** A new series id: short, readable in the properties header, and unlikely to repeat. */
export function newSeriesId(): string {
  return newId().slice(-8).toLowerCase();
}

/** The series id the fields carry, or null. */
export function seriesIdOf(fields: readonly Field[]): string | null {
  const value = fieldNamed(fields, SERIES_PROPERTY)?.value;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The series id in a page's `view`, or null. */
export function seriesIdInView(view: Record<string, unknown> | undefined | null): string | null {
  return seriesIdOf(readFields(view));
}

/** Every page of the series, oldest first, with ties broken by title. */
export function seriesPages<R extends SeriesRow>(rows: readonly R[], id: string): R[] {
  return rows
    .filter((row) => seriesIdOf(row.fields) === id)
    .sort((a, b) => a.created - b.created || a.title.localeCompare(b.title, undefined, { numeric: true }));
}

/** The fields of a row from the search index's page facts. */
export function rowOf(fact: { page: string; title: string; created: number; properties?: unknown }): SeriesRow {
  return {
    page: fact.page,
    title: fact.title,
    created: fact.created,
    fields: readFields({ properties: fact.properties }),
  };
}

/** Sets the page's series property. */
export async function setSeries(pages: PagesClient, page: string, id: string): Promise<void> {
  const open = await pages.open(page, { viewport: null });
  try {
    const fields = readFields(open.initial.view);
    const found = fieldNamed(fields, SERIES_PROPERTY);
    const next: Field[] = found
      ? fields.map((field) => (field === found ? { ...field, value: id } : field))
      : [...fields, { id: `series-${fields.length}`, name: SERIES_PROPERTY, type: 'text', value: id }];
    await open.send({ edits: [{ edit: 'setPage', view: viewPatch(next) }] });
  } finally {
    await open.close();
  }
}
