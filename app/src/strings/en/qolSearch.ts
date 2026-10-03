// Beta 4 additions to search and linking: line tags, links to paragraphs, the daily note, page properties,
// collections, the graph, the canvas, replace, and text read from media. One namespace file for the lane.
// Every string is a full sentence, never joined from pieces (ARCHITECTURE.md section 19).

export const qolSearch = {
  commands: {
    copyPageLink: 'Copy link to this page',
    copyParagraphLink: 'Copy link to this paragraph',
    tagsPane: 'Show tagged lines',
    tagLine: 'Tag this line',
    tag: {
      todo: 'Tag as To do',
      important: 'Tag as Important',
      question: 'Tag as Question',
      idea: 'Tag as Idea',
      remember: 'Tag as Remember for later',
      definition: 'Tag as Definition',
      highlight: 'Tag as Highlight',
      contact: 'Tag as Contact',
      phone: 'Tag as Phone number',
    },
    keywords: {
      copyPageLink: 'share url opennote address paste outlook word teams',
      copyParagraphLink: 'share url heading block anchor reference',
      tagsPane: 'tag summary to do checkboxes important question idea collect',
      tag: 'line tag label icon checkbox onenote',
    },
  },
  links: {
    copied: 'Link copied.',
    copyFailed: 'The link could not be copied.',
    gone: 'That page is no longer in your notebooks.',
  },
  lineTags: {
    names: {
      todo: 'To do',
      important: 'Important',
      question: 'Question',
      idea: 'Idea',
      remember: 'Remember for later',
      definition: 'Definition',
      highlight: 'Highlight',
      contact: 'Contact',
      phone: 'Phone number',
    },
    todoBox: 'To do, check off when done',
    chipLabel: 'Tag: {tag}',
    custom: 'Custom tag',
    menu: 'Tag this line',
    customTitle: 'Custom tag',
    customDescription: 'Name a tag for the lines you have selected. Use a slash to nest tags, such as school/biology.',
    customName: 'Tag name',
    customAdd: 'Add tag',
  },
} as const;
