// Send to Google Drive and OneDrive: the words the parts share.

export type SendService = 'drive' | 'onedrive';
export type SendScope = 'selection' | 'page' | 'section' | 'notebook';
/** `gdoc` is a Word file that Drive turns into a Google Doc as it takes it. */
export type SendFormat = 'pdf' | 'docx' | 'gdoc' | 'png';

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
  /** Sends a new file. `convert` turns a Word file into the service's own document. */
  send(local: LocalFile, folder: string | null, convert: boolean): Promise<Sent>;
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
