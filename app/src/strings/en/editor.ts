// Formatting and block commands, the slash menu, outline, typing helpers, and text styles (owner: WP4).
// Each namespace file has one owner, so parallel work never edits the same file.

export const editor = {
  list: {
    emptyTask: 'Empty task',
  },
  callout: {
    named: '{type}: {title}',
    typeButton: 'Callout type: {type}',
    typeMenu: 'Callout type',
    types: {
      note: 'Note',
      tip: 'Tip',
      important: 'Important',
      warning: 'Warning',
      caution: 'Caution',
      info: 'Info',
      question: 'Question',
      success: 'Success',
      danger: 'Danger',
      example: 'Example',
      quote: 'Quote',
    },
  },
  fold: {
    collapse: 'Collapse {name}',
    expand: 'Expand {name}',
    expanded: 'Expanded {name}.',
    collapsedCallout: 'Folded {name}.',
  },
  math: {
    inline: 'Math: {source}',
    block: 'Display math: {source}',
    field: 'Math source',
  },
  image: {
    chip: 'Image: {alt}',
    chipUnnamed: 'Image without a description',
    chipText: 'Image',
    notLoaded: 'This image comes from {src}. OpenNote doesn’t load images from outside the page.',
  },
} as const;
