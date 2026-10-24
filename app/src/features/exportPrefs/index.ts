// Whether print and PDF export put the page title at the top of the first sheet. It is on until the person turns it
// off, and the choice is remembered on this device.

const KEY = 'opennote.export.pageTitle';

export function pageTitleOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setPageTitle(on: boolean): void {
  try {
    localStorage.setItem(KEY, String(on));
  } catch {
    // The choice just is not remembered.
  }
}
