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

To size that noise, the 8-photo run was repeated three more times on the same machine (four runs in all, the first being the table's). Medians, with the range across the four runs in brackets:

| Case      | Peak while scrolling | Visible at the end | Settled at the top |
| --------- | -------------------- | ------------------ | ------------------ |
| Original  | +76 MB (47 to 88)    | +9 MB (-9 to 46)   | -9 MB (-41 to 4)   |
| Rendition | +53 MB (35 to 99)    | +35 MB (16 to 75)  | +32 MB (-59 to 65) |

Run to run, the spread is larger than the gap between the cases, so the data cannot say renditions cost more. It does say they do not cost less where it matters: after scrolling, the original photos settle at or below the empty page, and renditions settle above it in three of four runs.

## What it shows

- The original photos cost no more than the renditions. The rendition case is higher in three of four columns, within the noise. Chromium decodes only the images near the viewport, at the size they are shown, and drops decoded pictures it no longer needs. Shrinking the source file does not change that.
- Memory does not grow with the number of photos on the page. Eight photos peaked at the same level as 24.
- The page already loads lazily and decodes asynchronously (`features/page/blocks/imageBlock.ts`), and the import path reads size from the file header and never decodes a full photo in the page.

## Decision

Renditions are not built, and the flag `page.imageRenditions` is removed. A cache and a scheme to maintain would add cost with no measured gain. ADR 0025 is updated to say so. If a measurement on a real device ever shows images above their share, the ADR's revisit note covers it.

The measurement runs on a development PC, not on the owner's Surface, and measures process working sets, not the 40 MB page budget itself. It also drives plain Edge from a script, not the app's image block inside WebView2. It supports "renditions do not help". It does not prove the page stays under 40 MB on every device.

## The 12 MB share is exceeded

State it plainly: in both cases the images exceed their 12 MB share of the page budget at some point. The scrolling peak is +76 MB for the originals (median), and the single 24-photo run settled at +30 MB (+46 MB visible in the 8-photo run of the table). Only the 8-photo medians at rest (+9 MB visible, -9 MB settled) fit. A rendition would not fix that, because it showed no saving, so the decision to drop renditions stands but the share is not shown to hold. The follow-up, recorded in ADR 0025's revisit note, is one of these:

1. Re-measure on the owner's Surface in WebView2, with the app's own image block, so the number is the real one.
2. If it still exceeds the share, revisit the budget (give images a larger share) or add an unload-offscreen policy that drops the `src` of images far from the viewport.

## Run it again

```sh
node spikes/s3-images/run.ts --images 24
```
