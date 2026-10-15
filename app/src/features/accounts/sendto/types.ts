// Send to Google Drive and OneDrive: the words the parts share.

export type SendService = 'drive' | 'onedrive';
export type SendScope = 'selection' | 'page' | 'section' | 'notebook';
/** `gdoc`, `gsheet`, and `gslides` are Office files that Drive turns into Google's own as it takes them. */
export type SendFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'gdoc' | 'gsheet' | 'gslides' | 'png';

export interface RemoteFolder {
  id: string;
  name: string;
}

/** A file made on this PC, in the transfer folder, ready to send. */
export interface LocalFile {
  /** A name in the transfer folder, or a path inside it. */
  file: string;
  name: string;
  mime: string;
}

export interface Sent {
  id: string;
  name: string;
  link: string;
}

/** A service as the Send to flow uses it. */
export interface Destination {
  service: SendService;
  /** The folders inside a folder; null is the top. */
  folders(parent: string | null): Promise<RemoteFolder[]>;
  /** Sends a new file. `convertTo` is the type of Google file an Office file becomes, or null to keep it as it is. */
  send(local: LocalFile, folder: string | null, convertTo: string | null): Promise<Sent>;
  /** Replaces the content of a file sent before. */
  replace(local: LocalFile, remote: string): Promise<Sent>;
}

/** A page, section, or notebook that is linked to the file it was sent as. */
export interface SentCopy {
  service: SendService;
  remote: string;
  name: string;
  link: string;
  /** The page, section, or notebook that was sent. */
  node: string;
  scope: Exclude<SendScope, 'selection'>;
  format: SendFormat;
  folder: string;
  sentAt: string;
}

export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** What each Office type is as a file, and the Google file Drive makes of it. */
export const OFFICE: Record<'docx' | 'xlsx' | 'pptx', { mime: string; convertTo: string }> = {
  docx: { mime: DOCX, convertTo: 'application/vnd.google-apps.document' },
  xlsx: { mime: XLSX, convertTo: 'application/vnd.google-apps.spreadsheet' },
  pptx: { mime: PPTX, convertTo: 'application/vnd.google-apps.presentation' },
};

/** The Office type a format is made from, and whether Drive converts it. Null for a PDF or a picture. */
export function officeOf(format: SendFormat): { type: 'docx' | 'xlsx' | 'pptx'; convert: boolean } | null {
  switch (format) {
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return { type: format, convert: false };
    case 'gdoc':
      return { type: 'docx', convert: true };
    case 'gsheet':
      return { type: 'xlsx', convert: true };
    case 'gslides':
      return { type: 'pptx', convert: true };
    default:
      return null;
  }
}
