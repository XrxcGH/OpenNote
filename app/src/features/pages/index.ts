// The pages feature's public face: the page layout model, the paginator and sheet math, and the paper backgrounds.
// All of them are pure TypeScript over page units. The views, the export document, and the page setup dialog
// import them from here.

export * from './elements';
export * from './export';
export * from './gallery';
export * from './layout';
export * from './pagination';
export * from './paper';
export * from './pdf';
export * from './print';
export * from './reading';
export * from './selection';
export * from './slides';
export * from './zoom';
export type { RenderedPage, RenderKind } from './host/shareRender';
/** Renders the shown page as a PDF or PNG for another feature to send. The code loads when it is first called. */
export const renderShownPage = (...args: Parameters<typeof import('./host/shareRender').renderShownPage>) =>
  import('./host/shareRender').then((module) => module.renderShownPage(...args));
