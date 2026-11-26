// Array values for the formula engine (ADR 0059). This module builds arrays and fits a result into a block of cells.
// It also broadcasts operators and scalar functions over arrays. Pure functions, no table access.
//
// Broadcasting follows Excel's documented rules. Two arrays of the same size pair item by item. A single value, a
// single row, or a single column stretches across the other operand. Where the sizes do not match, the result is
// as large as the larger size in each direction, and the items outside the smaller operand are #N/A.

import { err, isArray, toScalar, type ArrayValue, type Scalar, type Value } from '../values';

/** An array of `rows` by `cols` from row-major items. A 1 by 1 array stays an array; see `collapse`. */
export function makeArray(rows: number, cols: number, data: readonly Scalar[]): ArrayValue {
  return { kind: 'array', rows, cols, data };
}

/** A one-by-one array stands for its single value. Larger arrays are kept. */
export function collapse(value: ArrayValue): Value {
  return value.rows === 1 && value.cols === 1 ? value.data[0] : value;
}

/** Any value as an array: a scalar is 1 by 1. */
export function asArray(value: Value): ArrayValue {
  return isArray(value) ? value : makeArray(1, 1, [toScalar(value)]);
}

/** The item at (r, c) when `value` is stretched to a larger size, or #N/A outside it. */
export function itemAt(value: ArrayValue, r: number, c: number): Scalar {
  const row = value.rows === 1 ? 0 : r;
  const col = value.cols === 1 ? 0 : c;
  if (row >= value.rows || col >= value.cols) return err('NA');
  return value.data[row * value.cols + col];
}

/** Applies `f` to every item. */
export function map1(value: ArrayValue, f: (v: Scalar) => Value): ArrayValue {
  const data = new Array<Scalar>(value.data.length);
  for (let i = 0; i < data.length; i++) data[i] = toScalar(f(value.data[i]));
  return makeArray(value.rows, value.cols, data);
}

/** Applies `f` to paired items of two values, at least one an array, with broadcasting. */
export function map2(a: Value, b: Value, f: (x: Scalar, y: Scalar) => Value): ArrayValue {
  const left = asArray(a);
  const right = asArray(b);
  const rows = Math.max(left.rows, right.rows);
  const cols = Math.max(left.cols, right.cols);
  const data = new Array<Scalar>(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) data[r * cols + c] = toScalar(f(itemAt(left, r, c), itemAt(right, r, c)));
  }
  return makeArray(rows, cols, data);
}

/** Applies `f` to the items of several values at once, any of them arrays, with broadcasting. */
export function mapN(values: readonly Value[], f: (items: Scalar[]) => Value): ArrayValue {
  const arrays = values.map(asArray);
  let rows = 1;
  let cols = 1;
  for (const a of arrays) {
    rows = Math.max(rows, a.rows);
    cols = Math.max(cols, a.cols);
  }
  const data = new Array<Scalar>(rows * cols);
  const items = new Array<Scalar>(arrays.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let i = 0; i < arrays.length; i++) items[i] = itemAt(arrays[i], r, c);
      data[r * cols + c] = toScalar(f(items));
    }
  }
  return makeArray(rows, cols, data);
}

/**
 * Fits an array into a block of a fixed size, as a legacy array formula entered over a block does: items beyond the
 * array are #N/A, except that a single row or column repeats across the block.
 */
export function fitTo(value: Value, rows: number, cols: number): ArrayValue {
  const source = asArray(value);
  const data = new Array<Scalar>(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r * cols + c] = itemAt(source, r, c);
  return makeArray(rows, cols, data);
}
