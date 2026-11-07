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

// Whether a Word export leaves out the names of authors and the dates. Off until the person turns it on, and the
// choice is remembered on this device.

const PERSONAL_KEY = 'opennote.export.removePersonal';

export function removePersonalOn(): boolean {
  try {
    return localStorage.getItem(PERSONAL_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setRemovePersonal(on: boolean): void {
  try {
    localStorage.setItem(PERSONAL_KEY, String(on));
  } catch {
    // The choice just is not remembered.
  }
}
