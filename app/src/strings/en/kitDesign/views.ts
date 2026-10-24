// checks-disable-file length: messages are full sentences kept on one line

// The words of the design kit's orthographic views tool.
export const views = {
  title: 'Orthographic views',
  keywords:
    'orthographic views projection front top right side view hidden lines isometric third angle first angle engineering drawing graphics cubes multiview',
  about:
    'Build a model from unit cubes, one layer at a time, and see its front, top, and right views the way an engineering drawing shows them, with hidden edges dashed. Press a cell to add or remove a cube.',
  width: 'Width (x)',
  height: 'Height (y)',
  depth: 'Depth (z)',
  projection: 'Layout of the views',
  third: 'Third angle: top above front',
  first: 'First angle: top below front',
  layer: 'Layer being edited',
  layerName: '{n, plural, =1 {Layer 1, the bottom} other {Layer #}}',
  preset: 'Start from a model',
  presetNone: 'Choose a model…',
  presets: {
    lshape: 'L shape',
    steps: 'Stairs',
    notch: 'Block with a hidden notch',
  },
  gridHelp:
    'The grid is the layer seen from above, with the front of the model at the bottom. Move between cells with the arrow keys and press Space to add or remove a cube.',
  gridLabel: 'Cubes in layer {layer}',
  cell: 'Column {x}, row {z}',
  added: 'Added a cube at column {x}, row {z} of layer {layer}.',
  removed: 'Removed the cube at column {x}, row {z} of layer {layer}.',
  clear: 'Clear the model',
  cleared: 'Removed every cube.',
  empty: 'The model is empty. Add a cube, or start from a model above.',
  count: '{count, plural, one {# cube.} other {# cubes.}}',
  size: '{view} view {width} by {height}.',
  front: 'Front',
  top: 'Top',
  right: 'Right',
  viewsHeading: 'Front, top, and right views',
  isoHeading: 'Isometric picture',
  dashed: 'Solid lines are edges you can see. Dashed lines are edges hidden behind a surface.',
  alt: 'Front, top, and right views of a model of {count, plural, one {# cube} other {# cubes}}, with hidden edges dashed.',
  isoAlt: 'Isometric picture of a model of {count, plural, one {# cube} other {# cubes}}.',
  insertViews: 'The three views as a picture',
  insertIso: 'The isometric picture',
};
