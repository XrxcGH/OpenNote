// A file dropped outside a place that takes it would make the browser open it in place of the app. The shell
// refuses that navigation too; this keeps the drop from starting it, and shows the "no" cursor.

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Cancels the browser's own handling of dragged files; places that take files still see the events first. */
export function installDropGuard(target: Window = window): () => void {
  const guard = (raised: Event) => {
    const event = raised as DragEvent;
    if (!hasFiles(event)) return;
    if (!event.defaultPrevented) {
      event.preventDefault();
      if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    }
  };
  target.addEventListener('dragover', guard);
  target.addEventListener('drop', guard);
  return () => {
    target.removeEventListener('dragover', guard);
    target.removeEventListener('drop', guard);
  };
}
