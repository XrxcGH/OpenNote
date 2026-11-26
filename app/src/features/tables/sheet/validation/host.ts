// What the table editor gives the validation commands: it knows the selection and the page, so it opens the dialog,
// the list, and the circles. The sheet-integration lane sets it when a table takes focus and clears it on blur.
export interface ValidationHost {
  /** Opens the Data validation dialog for the selected cells. */
  openDialog(): void;
  /** Opens the active cell's list (Alt+Down). Returns false when the cell has no list. */
  openList(): boolean;
  /** Turns the circles of invalid data on or off for the table. */
  circle(on: boolean): void;
  /** True while the circles show. */
  circled(): boolean;
}

let host: ValidationHost | null = null;

export function setValidationHost(next: ValidationHost | null): void {
  host = next;
}

export const validationHost = (): ValidationHost | null => host;
