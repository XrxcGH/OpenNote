// The calculator and graphing lane: the calculator's modes, 3D graphs, live solving, the Graph button on an equation,
// and the step-by-step views. Every interface string is a full sentence here, never joined from pieces
// (ARCHITECTURE.md section 19).

export const mathTools = {
  graph3d: {
    label: '3D graph of {count, plural, one {# function} other {# functions}}',
    role: '3D graph',
    keys: 'Drag or press the arrow keys to turn the graph. Plus and minus zoom. Zero resets the view.',
    readout:
      'x from {xLo} to {xHi}, y from {yLo} to {yHi}, z from {zLo} to {zHi}. Turned {turn} degrees and tilted {tilt} degrees.',
    turnLeft: 'Turn left',
    turnRight: 'Turn right',
    tiltUp: 'Tilt up',
    tiltDown: 'Tilt down',
    exportTitle: '3D graph',
    exportDescription:
      'Plots {functions} in 3D, with x from {xLo} to {xHi}, y from {yLo} to {yHi}, and z from {zLo} to {zHi}.',
    insert: 'Insert 3D graph',
    insertKeywords: '3d graph surface plot parametric curve z equation',
    picture: 'Insert as picture',
    pictureAlt: 'Graph of {functions}',
    pictureAdded: 'Picture of the graph added to the page.',
    pictureFailed: 'OpenNote could not make a picture of this graph.',
  },
} as const;
