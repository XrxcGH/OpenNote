// Mounts the crop fields (images/CropFields) inside the "Size and position" popover of an image, so cropping
// works from the keyboard and without dragging. The popover itself is plain DOM; the fields are React.
import { createRoot } from 'react-dom/client';
import type { ImageHandle } from '../blocks/imageBlock';
import { CropFields } from '../images/CropFields';
import { applyCrop } from '../images/cropMode';
import { cropOf } from '../images/geometry';
import type { Crop } from '../images/geometry';
import styles from './sizePosition.module.css';

/** The mounted crop fields: the crop typed so far, sent only when the popover applies. */
export interface MountedCropFields {
  /** Sends the typed crop, if it changed, as one undo step. Resolves whether anything changed. */
  apply(): Promise<boolean>;
  unmount(): void;
}

/**
 * Adds the crop fields to `form`. A field only records its value: moving between fields must not close the
 * popover or send half a crop. Apply (or Enter in any field) submits the form, which calls `apply`.
 */
export function mountCropFields(form: HTMLFormElement, handle: ImageHandle): MountedCropFields {
  const host = form.ownerDocument.createElement('div');
  host.className = styles.cropHost;
  // Enter inside a crop field submits the popover once React has recorded the field's value.
  host.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    setTimeout(() => form.isConnected && form.requestSubmit(), 0);
  });
  form.append(host);
  const root = createRoot(host);
  let pending: { crop: Crop | null } | null = null;
  root.render(
    <CropFields
      crop={cropOf(handle.block().data)}
      onChange={(crop) => {
        pending = { crop };
      }}
    />,
  );
  return {
    apply: () => (pending ? applyCrop(handle, pending.crop) : Promise.resolve(false)),
    unmount: () => queueMicrotask(() => root.unmount()),
  };
}
