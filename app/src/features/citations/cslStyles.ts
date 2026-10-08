// The style files that come with the app (see csl.ts for the template language). Titles and journal names are written
// as the source has them: a style that wants sentence case or an abbreviated journal name gets what was typed, so
// check a style guide for the last details.
import type { StyleFile } from './csl';

export const vancouver: StyleFile = {
  id: 'vancouver',
  title: 'Vancouver',
  numbered: true,
  names: { form: 'family-initials', separator: ', ', last: ', ', etAlOver: 6, keep: 6 },
  inline: '\\[{n}\\]',
  entry: {
    article: '{n}. [{authors}. ]{title}. [{container}. ]{year}[;{volume}][({issue})][:{pages|hyphen}]. [doi:{doi}]',
    web: '{n}. [{authors}. ]{title} \\[Internet\\]. [{container}; ]{year}[ \\[cited {accessed}\\]]. [Available from: {url}]',
    recording: '{n}. [{authors}. ]{title} \\[Audio recording\\]. [{publisher}; ]{year}.',
    book: '{n}. [{authors}. ]{title}. [{edition} ed. ][{place}: ][{publisher}][; {year}].',
  },
};

export const ama: StyleFile = {
  id: 'ama',
  title: 'AMA',
  numbered: true,
  names: { form: 'family-initials', separator: ', ', last: ', ', etAlOver: 6, keep: 3 },
  inline: '{n|sup}',
  entry: {
    article: '{n}. [{authors}. ]{title}. [*{container}*. ]{year}[;{volume}][({issue})][:{pages|hyphen}]. [doi:{doi}]',
    web: '{n}. [{authors}. ]{title}. [{container}. ][Published {year}. ][Accessed {accessed}. ]{url}',
    recording: '{n}. [{authors}. ]*{title}*. Audio recording. [{publisher}; ]{year}.',
    book: '{n}. [{authors}. ]*{title}*. [{edition} ed. ][{publisher}; ]{year}.',
  },
};

export const acs: StyleFile = {
  id: 'acs',
  title: 'ACS',
  numbered: true,
  names: { form: 'family-initials-dots', separator: '; ', last: '; ' },
  inline: '({n})',
  entry: {
    article:
      '{n}. [{authors}. ]{title}. [*{container}* ]**{year}**[, *{volume}*][ ({issue})][, {pages|minus}]. [{doiurl}]',
    web: '{n}. [{authors}. ]{title}. [{container}. ]{url}[ (accessed {accessed})].',
    recording: '{n}. [{authors}. ]*{title}* \\[Audio recording\\]; [{publisher}, ]{year}.',
    book: '{n}. [{authors}. ]*{title}*[, {edition} ed.]; [{publisher}][: {place}][, {year}].',
  },
};

export const turabian: StyleFile = {
  id: 'turabian',
  title: 'Turabian',
  numbered: false,
  names: { form: 'first-turned', separator: ', ', last: ', and ', etAlOver: 10, keep: 7 },
  inline: '{who}, "{title}"',
  entry: {
    article: '[{authors}. ]"{title}." [*{container}*][ {volume}][, no. {issue}][ ({year})][: {pages}]. [{doiurl}.]',
    web: '[{authors}. ]"{title}." [{container}. ][{year}. ][Accessed {accessed}. ]{url}.',
    recording: '[{authors}. ]*{title}*. [{publisher}, ]{year}.',
    book: '[{authors}. ]*{title}*.[ {edition} ed.] [{place}: ][{publisher}][, {year}].',
  },
};

export const nature: StyleFile = {
  id: 'nature',
  title: 'Nature',
  numbered: true,
  names: { form: 'family-initials-dots', separator: ', ', last: ' & ', etAlOver: 5, keep: 1 },
  inline: '{n|sup}',
  entry: {
    article: '{n}. [{authors} ]{title}. [*{container}* ][**{volume}**][, {pages}][ ({year})].',
    web: '{n}. [{authors} ]{title}. [*{container}* ]{url}[ ({year})].',
    recording: '{n}. [{authors} ]*{title}* \\[Audio recording\\] ([{publisher}, ]{year}).',
    book: '{n}. [{authors} ]*{title}*[ {edition} ed.] ([{publisher}, ]{year}).',
  },
};

/** The bundled style files, in the order the style list shows them after the five built-in styles. */
export const BUNDLED_STYLES: readonly StyleFile[] = [vancouver, ama, acs, turabian, nature];
