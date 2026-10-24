// The one error type the control engines throw. The code is a key under kitControl.errors and the values fill
// its placeholders, so the interface can say what went wrong in a full sentence.

export class ControlError extends Error {
  constructor(
    readonly code: string,
    readonly vars: Readonly<Record<string, string>> = {},
  ) {
    super(code);
  }
}

/** A LaTeX bmatrix from rows of LaTeX cells. */
export const matTex = (cells: readonly (readonly string[])[]): string =>
  `\\begin{bmatrix} ${cells.map((row) => row.join(' & ')).join(' \\\\ ')} \\end{bmatrix}`;

/** Splits matrix text into rows of cell text: rows by new lines or semicolons, cells by spaces, or commas. */
export function splitMatrixText(text: string): string[][] {
  return text
    .replace(/[[\]]/g, ' ')
    .split(/[\n;]+/)
    .map((line) =>
      line
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean),
    )
    .filter((row) => row.length > 0);
}

/** Reads a matrix of plain numbers. Throws 'matrixEmpty', 'matrixNumber' or 'matrixRagged'. */
export function readNumberMatrix(text: string): number[][] {
  const cells = splitMatrixText(text);
  if (!cells.length) throw new ControlError('matrixEmpty');
  const k = cells[0].length;
  if (cells.some((row) => row.length !== k)) throw new ControlError('matrixRagged');
  return cells.map((row) =>
    row.map((cell) => {
      const v = Number(cell.replace(/−/g, '-'));
      if (!Number.isFinite(v)) throw new ControlError('matrixNumber', { cell });
      return v;
    }),
  );
}

/** Reads a list of numbers separated by spaces, commas, or new lines. Throws 'listNumber' for a bad entry. */
export function readNumberList(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((cell) => {
      const v = Number(cell.replace(/−/g, '-'));
      if (!Number.isFinite(v)) throw new ControlError('listNumber', { cell });
      return v;
    });
}
