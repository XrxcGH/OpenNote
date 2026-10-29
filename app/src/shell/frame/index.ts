// The custom window frame (ARCHITECTURE.md section 10), behind the `shell.customFrame` flag. The title bar places
// `DragRegion` between its items and `CaptionButtons` at its end, and spreads `titleBarDragProps` on itself.

export { CaptionButtons } from './CaptionButtons';
export type { CaptionButtonsProps } from './CaptionButtons';
export { DragRegion, titleBarDragProps } from './DragRegion';
export { captionLayout } from './captionLayout';
export { frameWindow, useCustomFrame, useSnapLayoutsOverlay } from './windowState';
