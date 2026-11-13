// The ruler above the page.
// Owner: text:ruler (B11 and B12). text:scaffold registered it in the string index, and the owner fills it in.

export const textRuler = {
  toggle: 'Ruler',
  toggleKeywords: 'ruler indent tab stops margin hanging first line',
  label: 'Ruler',
  unitLabel: 'Ruler units',
  tabTypeLabel: 'Tab type',
  tabTypeHint: 'Click the ruler to add a stop of this type.',
  needsText: 'Click in a text block to see its ruler.',
  shown: 'Ruler shown.',
  hidden: 'Ruler hidden.',
  unitName: {
    in: 'Inches',
    cm: 'Centimeters',
    mm: 'Millimeters',
    pt: 'Points',
    pc: 'Picas',
  },
  value: {
    in: '{n, plural, one {# inch} other {# inches}}',
    cm: '{n, plural, one {# centimeter} other {# centimeters}}',
    mm: '{n, plural, one {# millimeter} other {# millimeters}}',
    pt: '{n, plural, one {# point} other {# points}}',
    pc: '{n, plural, one {# pica} other {# picas}}',
  },
  marker: {
    first: 'First line indent',
    hanging: 'Hanging indent',
    left: 'Left indent',
    right: 'Right indent',
    tab: '{type} tab stop',
  },
  tabType: {
    start: 'Left tab',
    center: 'Center tab',
    end: 'Right tab',
    decimal: 'Decimal tab',
    bar: 'Bar tab',
    first: 'First line indent',
    hanging: 'Hanging indent',
  },
  tabName: {
    start: 'Left',
    center: 'Center',
    end: 'Right',
    decimal: 'Decimal',
    bar: 'Bar',
  },
  announced: '{name}, {value}.',
  removed: '{name} removed.',
  added: '{name} added at {value}.',
} as const;
