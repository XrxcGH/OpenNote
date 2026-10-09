// The part of a screenshot a person dragged over, in the screenshot's own pixels. The overlay reports the drag in
// CSS pixels of the window; the screenshot is that window at the device's pixel ratio.

/** The crop box in screenshot pixels, clamped to the picture, or null when it is too small to be a choice. */
export function cropBox(rect, ratio, imageWidth, imageHeight) {
  if (!rect || !(ratio > 0)) return null;
  const x = Math.max(0, Math.round(Math.min(rect.x, rect.x + rect.width) * ratio));
  const y = Math.max(0, Math.round(Math.min(rect.y, rect.y + rect.height) * ratio));
  const right = Math.min(imageWidth, Math.round(Math.max(rect.x, rect.x + rect.width) * ratio));
  const bottom = Math.min(imageHeight, Math.round(Math.max(rect.y, rect.y + rect.height) * ratio));
  const width = right - x;
  const height = bottom - y;
  return width >= 8 && height >= 8 ? { x, y, width, height } : null;
}
