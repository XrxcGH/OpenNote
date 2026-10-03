// Code highlighting's public face (PLAN.md section 10.3; owner: WP6). Code blocks add the plugin themselves. The
// page calls highlightStatic for blocks shown before their editor mounts. The highlighter they share loads lazily.
export { highlightPlugin, highlightStatic } from './plugin';
