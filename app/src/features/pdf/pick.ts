// Choosing files through the webview's own file chooser. The person picks each file, and the page gets only that file's
// bytes, never a path, so nothing else on disk is reachable from here.

/** Opens the file chooser. Resolves with the chosen files, or an empty list when the person cancels. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    input.dataset.testid = 'pdf-file-input';
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done([...(input.files ?? [])]));
    input.addEventListener('cancel', () => done([]));
    document.body.append(input);
    input.click();
  });
}

/** The file's bytes, refused when it is bigger than `max`. */
export async function readBytes(file: Blob, max: number): Promise<Uint8Array | null> {
  if (file.size > max) return null;
  return new Uint8Array(await file.arrayBuffer());
}
