// A page's strokes as the records say they are (spec 9.2 and 9.5). A stroke record adds a stroke or replaces the one
// with the same ID. A property record changes some of a stroke's properties, and a remove record deletes it. The
// engine folds the records of a page's segments, in order, into this table. It applies later records the same way.

import type { InkRecord, StrokeProps } from '../../../core/ink/codec';
import type { Matrix } from '../geometry/types';
import { isKnownToolCode, toolFromCode } from '../pens/tools';
import { strokeFromRecord } from './convert';
import type { InkStroke } from './types';

export type StrokeTable = Map<string, InkStroke>;

/** The stroke with a property record applied. Fields the record leaves out stay as they are. */
export function applyProps(stroke: InkStroke, props: StrokeProps): InkStroke {
  const next: { -readonly [K in keyof InkStroke]: InkStroke[K] } = { ...stroke };
  if (props.style) {
    next.tool = toolFromCode(props.style.tool);
    if (isKnownToolCode(props.style.tool)) delete next.toolCode;
    else next.toolCode = props.style.tool;
    next.slot = props.style.palette;
    next.color = props.style.color;
    next.width = props.style.width;
  }
  if (props.transform === 'remove') delete next.transform;
  else if (props.transform) next.transform = props.transform as unknown as Matrix;
  if (props.block) next.block = props.block;
  return next;
}

/** Applies one record to a table. A property record or a remove for an unknown stroke changes nothing. */
export function applyRecord(table: StrokeTable, record: InkRecord): void {
  if (record.kind === 'stroke') {
    table.set(record.stroke.id, strokeFromRecord(record.stroke));
  } else if (record.kind === 'remove') {
    table.delete(record.id);
  } else {
    const stroke = table.get(record.props.id);
    if (stroke) table.set(stroke.id, applyProps(stroke, record.props));
  }
}

/** The table that results from applying records in order, on top of an existing table when one is given. */
export function foldRecords(records: Iterable<InkRecord>, table: StrokeTable = new Map()): StrokeTable {
  for (const record of records) applyRecord(table, record);
  return table;
}
