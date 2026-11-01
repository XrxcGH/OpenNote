# Image memory (spike S3)

[ADR 0025](../adr/0025-paste-and-images.md) gave images 12 MB of the 40 MB the page may use. It kept display-size renditions as a fallback behind `page.imageRenditions`, to turn on only if images went above that share. This page records the measurement and the decision.

## What was measured

`spikes/s3-images/run.ts` drives Microsoft Edge 156, which has WebView2's engine, through a column of 12-megapixel JPEG photos. Each photo is an `img` with lazy loading and asynchronous decoding at 640 pixels wide, as the page shows an image. The script scrolls the column in steps, then returns to the top and waits. It sums the working sets of every browser process of the run and reports what they gained over the empty page.

Two cases: the original 12-megapixel photo as the source (what the page does today), and a 1280-pixel-wide copy as the source (what renditions would add).

| Run       | Case      | Peak while scrolling | Visible at the end | Settled at the top |
| --------- | --------- | -------------------- | ------------------ | ------------------ |
| 24 photos | Original  | +97 MB               | +4 MB              | +30 MB             |
| 24 photos | Rendition | +108 MB              | +18 MB             | +25 MB             |
| 8 photos  | Original  | +88 MB               | +46 MB             | -4 MB              |
| 8 photos  | Rendition | +99 MB               | +75 MB             | +65 MB             |

The numbers are noisy. They move by tens of megabytes between runs because the browser's other processes (GPU, utility, network) grow and shrink on their own. The raw files are `spikes/results/s3-images.json` and `spikes/results/s3-images-8.json`.

## What it shows

- The original photos cost no more than the renditions. The rendition case is higher in three of four columns, within the noise. Chromium decodes only the images near the viewport, at the size they are shown, and drops decoded pictures it no longer needs. Shrinking the source file does not change that.
- Memory does not grow with the number of photos on the page. Eight photos peaked at the same level as 24.
- The page already loads lazily and decodes asynchronously (`features/page/blocks/imageBlock.ts`), and the import path reads size from the file header and never decodes a full photo in the page.

## Decision

Renditions are not built, and the flag `page.imageRenditions` is removed. A cache and a scheme to maintain would add cost with no measured gain. ADR 0025 is updated to say so. If a measurement on a real device ever shows images above their share, the ADR's revisit note covers it.

The measurement runs on a development PC, not on the owner's Surface, and measures process working sets, not the 40 MB page budget itself. It supports "renditions do not help". It does not prove the page stays under 40 MB on every device.

## Run it again

```sh
node spikes/s3-images/run.ts --images 24
```
