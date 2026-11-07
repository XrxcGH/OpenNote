// Opening a file into a text box: what happened to the last file, for the status line under the box. A file that is
// not text (a picture, a zip, a damaged file) is not put in the box.
import { useState } from 'react';
import { looksBinary } from '../data/file';

/** The last file: its name when it was read, 'failed' when it could not be, null when none is shown. */
export type FileStatus = { name: string } | 'failed' | null;

export function useFileRead(onText: (text: string) => void) {
  const [status, setStatus] = useState<FileStatus>(null);
  const read = async (picked: File) => {
    try {
      const text = await picked.text();
      if (looksBinary(text)) throw new Error('not text');
      onText(text);
      setStatus({ name: picked.name });
    } catch {
      setStatus('failed');
    }
  };
  /** Forgets the status, as when the text is typed over or replaced. */
  const clear = () => setStatus(null);
  return { status, read, clear };
}
