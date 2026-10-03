// Adds the link layer to every text editor. This module loads right after start-up, in its own chunk, because the
// editor kit it registers with is part of the page chunk, which start-up leaves alone.
import { editorExtensions } from '../../../editor/extensions/kit';
import { pageLinkExtensions } from './pageLinks';

editorExtensions.register({
  id: 'search.pageLinks',
  order: 90,
  flag: 'search.links',
  kinds: ['text'],
  create: () => pageLinkExtensions(),
});
