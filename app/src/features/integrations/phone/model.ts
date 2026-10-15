// Insert > From phone (flag integrations.phoneScan; docs/help/phone-scan.md): what the dialog asks the shell for,
// and how a photo lands on the open page. The shell listens on this PC's network address only while the dialog is
// open; see app/src-tauri/src/api/phone.rs and crates/api/src/phone.rs.
import { fromBase64 } from '../share/receive';

export interface PhoneSession {
  url: string;
  /** Rows of '1' (dark) and '0' (light). */
  qr: string[];
  /** SHA-256 of the session's certificate, as colon-separated pairs. */
  fingerprint: string;
  expiresAt: number;
}

export type PhoneState = 'open' | 'stopped' | 'expired' | 'tooManyTries' | 'full' | 'none';

export interface PhonePhoto {
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  /** Base64. */
  data: string;
}

/** The SVG path of a QR code: one square for each dark module, offset by the quiet zone. */
export function qrPath(rows: readonly string[], quiet = 4): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '1') parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
  });
  return parts.join('');
}

/** Minutes left, to the nearest one and at least 1 while any time is left, for "stops in {minutes} min". */
export function minutesLeft(expiresAt: number, now = Date.now()): number {
  const left = expiresAt - now;
  return left <= 0 ? 0 : Math.max(1, Math.round(left / 60_000));
}

/** The files a paste of the photos carries, named the way a phone would. */
export function photoFiles(photos: readonly PhonePhoto[], at = new Date()): File[] {
  const stamp = at.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return photos
    .filter((photo) => photo.mime === 'image/jpeg' || photo.mime === 'image/png')
    .map(
      (photo, index) =>
        new File(
          [fromBase64(photo.data)],
          `Phone ${stamp}-${index + 1}.${photo.mime === 'image/png' ? 'png' : 'jpg'}`,
          {
            type: photo.mime,
          },
        ),
    );
}

/** Pastes the photos onto the page; false when no page can take them. */
export function pastePhotos(
  target: EventTarget | null,
  files: readonly File[],
  make: () => DataTransfer = () => new DataTransfer(),
): boolean {
  if (!target || !files.length) return false;
  const data = make();
  for (const file of files) data.items.add(file);
  const init = { bubbles: true, cancelable: true };
  const event =
    typeof ClipboardEvent === 'function'
      ? new ClipboardEvent('paste', { ...init, clipboardData: data })
      : Object.assign(new Event('paste', init), { clipboardData: data });
  target.dispatchEvent(event);
  return true;
}
