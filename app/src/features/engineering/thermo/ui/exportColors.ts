// checks-disable-file brand-consistency: the fixed colors of a plot put on a page, which must not follow the theme.
// The colors of a plot inserted as a picture: dark lines on white, like the figure export, so the picture reads the
// same in any theme and in print.
import type { PlotColors } from './plotSvg';

export const PICTURE_COLORS: PlotColors = {
  paper: '#ffffff',
  grid: '#e3e0da',
  axis: '#5c5852',
  text: '#3d3a35',
  pens: ['#3b4f8f', '#b7791f', '#3f7a4a', '#7a4a7f', '#7a5a3c'],
  mark: '#a33a2c',
};
