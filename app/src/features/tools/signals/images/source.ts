// The image the lab's tabs share, held in memory for this visit: a file the student opens (PNG or JPEG, scaled to
// at most 256 pixels on a side so each step stays quick), or the built-in examples. Bands are the color channels of
// an opened file, or of the example scene.
import { useSyncExternalStore } from 'react';
import { seededRandom } from '../shared/num';
import { fromRgba, gray, type Gray } from './engine';

export const MAX_SIDE = 256;

export interface Picture {
  name: string;
  image: Gray;
  /** Single-band images of the same size: red, green, blue for a file; NIR, red, green for the example scene. Names are keys. */
  bands: Gray[];
  bandNames: string[];
}

/** A seeded field of bright disks on a dim, noisy background: something to count. */
function exampleCells(): Gray {
  const size = 96;
  const img = gray(size, size);
  const random = seededRandom(11);
  const disks = Array.from({ length: 14 }, () => ({ x: 8 + random() * 80, y: 8 + random() * 80, r: 3 + random() * 4 }));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let v = 0.15 + 0.05 * random();
      for (const d of disks) if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r ** 2) v = 0.75 + 0.1 * random();
      img.data[y * size + x] = v;
    }
  }
  return img;
}

/** A small scene of vegetation, water, and bare ground in NIR, red, and green bands. */
function exampleScene(): Gray[] {
  const size = 64;
  const nir = gray(size, size);
  const red = gray(size, size);
  const green = gray(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const water = (x - 45) ** 2 + (y - 20) ** 2 < 150;
      const plants = !water && x < 32;
      [nir.data[i], red.data[i], green.data[i]] = water
        ? [0.05, 0.08, 0.12]
        : plants
          ? [0.5, 0.08, 0.15]
          : [0.3, 0.25, 0.22];
    }
  }
  return [nir, red, green];
}

const EXAMPLE: Picture = {
  name: 'example',
  image: exampleCells(),
  bands: exampleScene(),
  bandNames: ['nir', 'red', 'green'],
};
let current = EXAMPLE;
const listeners = new Set<() => void>();

export function setPicture(next: Picture): void {
  current = next;
  listeners.forEach((listen) => listen());
}

export const usePicture = (): Picture =>
  useSyncExternalStore(
    (listen) => {
      listeners.add(listen);
      return () => listeners.delete(listen);
    },
    () => current,
  );

/** Decodes a PNG or JPEG file on a canvas, scaled down to at most MAX_SIDE pixels on its longer side. */
export async function readImageFile(file: File): Promise<Picture> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { luma, r, g, b } = fromRgba(context.getImageData(0, 0, width, height).data, width, height);
  return { name: file.name, image: luma, bands: [r, g, b], bandNames: ['red', 'green', 'blue'] };
}
