// Static DOM for text that has no editor yet (ARCHITECTURE.md section 7.1): the page renders every block this way
// at open, and the editor pool mounts editors in place of it.
export { renderStatic, renderStaticSliced } from './schema/dom';
