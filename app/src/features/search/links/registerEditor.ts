// Adds the link layer to every text editor. This module loads right after start-up, in its own chunk, because the
// editor kit it registers with is part of the page chunk, which start-up leaves alone.
import { editorExtensions } from '../../../editor/extensions/kit';
import { elementExtensions } from '../elements/plugin';
import { pageLinkExtensions } from './pageLinks';

editorExtensions.register({
  id: 'search.pageLinks',
  order: 90,
  flag: 'search.links',
  kinds: ['text'],
  create: () => pageLinkExtensions(),
});

// Line tags and element IDs for links to paragraphs share one plugin, which loads each block's data and writes it back.
editorExtensions.register({
  id: 'search.elements',
  order: 91,
  kinds: ['text'],
  create: (host) =>
    elementExtensions(host, { tags: host.flag('search.lineTags'), links: host.flag('search.paragraphLinks') }),
});
