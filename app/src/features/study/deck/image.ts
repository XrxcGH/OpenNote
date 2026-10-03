// Pictures for image cards drawn on a canvas, for places that cannot show a hidden part (an exported package).
import type { OcclusionBox } from './types';

async function load(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image'));
    image.src = src;
  });
  return image;
}

export const dataUri = {
  /** The picture as it is, and again with each hidden part painted over. */
  async occluded(image: {
    src: string;
    boxes: readonly OcclusionBox[];
  }): Promise<{ covered: string; original: string }> {
    const loaded = await load(image.src);
    const canvas = document.createElement('canvas');
    canvas.width = loaded.naturalWidth;
    canvas.height = loaded.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(loaded, 0, 0);
    const original = canvas.toDataURL('image/png');
    context.fillStyle = '#222222';
    for (const box of image.boxes) {
      context.fillRect(
        (box.x / 100) * canvas.width,
        (box.y / 100) * canvas.height,
        (box.w / 100) * canvas.width,
        (box.h / 100) * canvas.height,
      );
    }
    return { covered: canvas.toDataURL('image/png'), original };
  },
};
