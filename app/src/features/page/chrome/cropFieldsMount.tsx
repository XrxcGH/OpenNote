// Mounts the crop fields (images/CropFields) inside the "Size and position" popover of an image, so cropping
// works from the keyboard and without dragging. The popover itself is plain DOM; the fields are React.
import { createRoot } from 'react-dom/client';
import type { ImageHandle } from '../blocks/imageBlock';
import { CropFields } from '../images/CropFields';
import { applyCrop } from '../images/cropMode';
import { cropOf } from '../images/geometry';
import styles from './sizePosition.module.css';

/**
 * Adds the crop fields to `form`. Each change is one undo step through applyCrop, then `done` runs (the popover
 * closes, since the image's frame changed with the crop). Returns a function that unmounts the fields.
 */
export function mountCropFields(form: HTMLElement, handle: ImageHandle, done: () => void): () => void {
  const host = form.ownerDocument.createElement('div');
  host.className = styles.cropHost;
  // Enter inside a crop field commits the crop; it must not also submit the popover's size fields.
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  form.append(host);
  const root = createRoot(host);
  // Enter and the blur that follows both commit; the second must not send the same crop again.
  let sent = false;
  const render = () =>
    root.render(
      <CropFields
        crop={cropOf(handle.block().data)}
        onChange={(crop) => {
          if (sent) return;
          sent = true;
          void applyCrop(handle, crop).then(done);
        }}
      />,
    );
  render();
  return () => queueMicrotask(() => root.unmount());
}
