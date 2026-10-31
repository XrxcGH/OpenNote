// An image on a canvas, scaled up with crisp pixels: grayscale (values 0 to 1, or stretched from their range), a
// label map in distinct colors, or an RGB composite. It inserts into the page as a PNG with its description.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { PlotHandle } from '../shared/Plot';
import styles from '../shared/kit.module.css';
import type { Gray } from './engine';

export type ImageContent =
  | { kind: 'gray'; image: Gray; stretch?: boolean }
  | { kind: 'labels'; width: number; height: number; labels: ArrayLike<number> }
  | { kind: 'rgb'; r: Gray; g: Gray; b: Gray };

const size = (content: ImageContent) =>
  content.kind === 'gray'
    ? [content.image.width, content.image.height]
    : content.kind === 'labels'
      ? [content.width, content.height]
      : [content.r.width, content.r.height];

function paint(canvas: HTMLCanvasElement, content: ImageContent) {
  const [width, height] = size(content) as [number, number];
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const pixels = context.createImageData(width, height);
  const put = (i: number, r: number, g: number, b: number) => {
    pixels.data[4 * i] = r;
    pixels.data[4 * i + 1] = g;
    pixels.data[4 * i + 2] = b;
    pixels.data[4 * i + 3] = 255;
  };
  if (content.kind === 'gray') {
    let lo = 0;
    let hi = 1;
    if (content.stretch) {
      lo = Infinity;
      hi = -Infinity;
      for (const v of content.image.data) if (Number.isFinite(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
    }
    const span = hi - lo || 1;
    content.image.data.forEach((v, i) => {
      const g = Math.round(255 * Math.min(1, Math.max(0, (v - lo) / span)));
      put(i, g, g, g);
    });
  } else if (content.kind === 'labels') {
    for (let i = 0; i < width * height; i += 1) {
      const l = content.labels[i]!;
      // Golden-angle hues keep neighboring labels apart; label 0 is background.
      const hue = (l * 137.508) % 360;
      const [r, g, b] = l ? labelColor(hue) : [24, 24, 24];
      put(i, r, g, b);
    }
  } else {
    for (let i = 0; i < width * height; i += 1) {
      const c = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v)));
      put(i, c(content.r.data[i]!), c(content.g.data[i]!), c(content.b.data[i]!));
    }
  }
  context.putImageData(pixels, 0, 0);
}

function labelColor(hue: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (0.55 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

export const ImageView = forwardRef<PlotHandle, { content: ImageContent; title: string; description: string }>(
  function ImageView({ content, title, description }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
      if (canvas.current) paint(canvas.current, content);
    }, [content]);
    useImperativeHandle(ref, () => ({
      picture: async (name) => {
        const node = canvas.current;
        if (!node) return null;
        const blob = await new Promise<Blob | null>((resolve) => node.toBlob(resolve, 'image/png'));
        return blob
          ? { bytes: await blob.arrayBuffer(), name: `${name}.png`, alt: `${title}. ${description}`, mime: 'image/png' }
          : null;
      },
    }));
    return (
      <figure className={styles.figure}>
        <canvas ref={canvas} className={styles.pixels} role="img" aria-label={`${title}. ${description}`} />
        <figcaption className={styles.note}>{title}</figcaption>
      </figure>
    );
  },
);
