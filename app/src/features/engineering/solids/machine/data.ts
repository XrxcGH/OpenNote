// Data the machine elements tool looks up: the Lewis form factor of a spur gear tooth against its number of teeth.
// Check a value against its source before using it for a design.

export const MACHINE_SOURCES = {
  lewis: {
    name:
      'W. Lewis, "Investigation of the Strength of Gear Teeth", Proceedings of the Engineers Club of Philadelphia, ' +
      '1892 (the form factor); values for 20° full-depth teeth with a diametral pitch of 1, as tabulated in ' +
      'machine design texts such as Budynas and Nisbett, Shigley’s Mechanical Engineering Design, Table 14-2',
    license: '1892 paper: public domain. The tabulated numbers are facts.',
  },
} as const;

/** The Lewis form factor Y for 20° full-depth teeth: [number of teeth, Y]. A rack has Y = 0.485. */
export const LEWIS_Y: readonly (readonly [number, number])[] = [
  [12, 0.245],
  [13, 0.261],
  [14, 0.277],
  [15, 0.29],
  [16, 0.296],
  [17, 0.303],
  [18, 0.309],
  [19, 0.314],
  [20, 0.322],
  [21, 0.328],
  [22, 0.331],
  [24, 0.337],
  [26, 0.346],
  [28, 0.353],
  [30, 0.359],
  [34, 0.371],
  [38, 0.384],
  [43, 0.397],
  [50, 0.409],
  [60, 0.422],
  [75, 0.435],
  [100, 0.447],
  [150, 0.46],
  [300, 0.472],
  [400, 0.48],
];

export const RACK_Y = 0.485;
