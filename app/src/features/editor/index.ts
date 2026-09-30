// The editor core's public face (owner: Phase 4). Pure TypeScript with no React and no platform calls: the text
// schema, OpenNote Markdown in and out, and the paste pipeline. The page view and the Tiptap editor build on it.

export { textExtensions, textSchema } from './schema/schema';
export * from './schema/specs';
export * from './markdown';
