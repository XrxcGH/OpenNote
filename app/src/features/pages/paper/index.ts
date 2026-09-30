// Paper backgrounds: pure generators that turn a page's background into vector paths in page units, and the SVG that
// draws them. The screen and the PDF export use the same code.

export { DEFAULT_SPACING, flowGeometry, infinitePaths, paperPaths, spacingOf } from './patterns';
export { CORNELL, cornellAreas, type CornellAreas } from './cornell';
export { PRESETS, SPACINGS, withSpacing, type PresetId } from './presets';
export { MARGIN_OPACITY, PEN_OPACITY, paperSvg, tokenVar, type PaperStyle } from './svg';
export {
  TEMPLATE_IDS,
  labNotebook,
  planner,
  storyboard,
  type AreaSize,
  type LabText,
  type PlannerText,
} from './templates';
export { MAX_ELEMENTS, MAX_LABEL } from './template';
export { STROKE } from './types';
export type {
  PageBackground,
  PaperLabel,
  PaperPaths,
  PaperTemplate,
  PatternName,
  TemplateElement,
  Weight,
} from './types';
