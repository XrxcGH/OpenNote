// OpenNote's own ESLint rules for app/src (ARCHITECTURE.md section 4.4). They keep the layers apart, keep
// interface text in the string files, and stop theme switches from remounting parts of the page.

import { dirname, resolve, sep } from 'node:path';

const SRC = `${sep}app${sep}src${sep}`;
const LABEL_PROPS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label']);
const LETTERS = /[A-Za-z]/;

/** The source-relative path of an import, such as "features/tree/store", or null for packages. */
function target(context, source) {
  if (typeof source !== 'string' || !source.startsWith('.')) return null;
  const absolute = resolve(dirname(context.filename), source);
  const at = absolute.indexOf(SRC);
  return at === -1
    ? null
    : absolute
        .slice(at + SRC.length)
        .split(sep)
        .join('/');
}

function fromFile(context) {
  const at = context.filename.indexOf(SRC);
  return at === -1
    ? null
    : context.filename
        .slice(at + SRC.length)
        .split(sep)
        .join('/');
}

/** Calls check with the source-relative path of every static and dynamic import and re-export. */
function onImports(context, check) {
  const visit = (node) => {
    const path = target(context, node.source?.value);
    if (path) check(node, path);
  };
  return {
    ImportDeclaration: visit,
    ExportNamedDeclaration: visit,
    ExportAllDeclaration: visit,
    ImportExpression: visit,
  };
}

const featureBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'A feature imports another feature only through its index.ts.' },
    messages: { deep: 'Import "{{feature}}" through features/{{feature}}/index.ts, not {{path}}.' },
    schema: [],
  },
  create(context) {
    const file = fromFile(context);
    if (!file) return {};
    const own = /^features\/([^/]+)\//.exec(file)?.[1];
    return onImports(context, (node, path) => {
      const match = /^features\/([^/]+)\/(.+)$/.exec(path);
      // A feature's flags.ts is public like its index.ts, because flags load at start-up, before the feature.
      if (!match || match[1] === own || /^(index|flags)(\.tsx?)?$/.test(match[2])) return;
      context.report({ node, messageId: 'deep', data: { feature: match[1], path } });
    });
  },
};

const ALLOWED_STATE = new Set(['state/store', 'state/layers', 'state/toasts']);

const uiBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Primitives in ui/ never import state, services, features, or the shell.' },
    messages: { layer: 'ui/ is props in, events out, so it can’t import {{path}}.' },
    schema: [],
  },
  create(context) {
    if (!fromFile(context)?.startsWith('ui/')) return {};
    return onImports(context, (node, path) => {
      const bare = path.replace(/\.tsx?$/, '');
      if (ALLOWED_STATE.has(bare)) return;
      if (/^(state|services|features|shell)\//.test(bare)) context.report({ node, messageId: 'layer', data: { path } });
    });
  },
};

const editorBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'editor/ is a library: it never imports state, services, features, or the shell.' },
    messages: { layer: 'editor/ gets what it needs through EditorHost, so it can’t import {{path}}.' },
    schema: [],
  },
  create(context) {
    if (!fromFile(context)?.startsWith('editor/')) return {};
    return onImports(context, (node, path) => {
      if (/^(state|services|features|shell)\//.test(path)) context.report({ node, messageId: 'layer', data: { path } });
    });
  },
};

function literalText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node?.type === 'JSXExpressionContainer') return literalText(node.expression);
  return null;
}

const noLiteralText = {
  meta: {
    type: 'problem',
    docs: { description: 'Interface text comes from t(), never from literals in JSX.' },
    messages: { literal: 'Move this text to app/src/strings/en and use t().' },
    schema: [],
  },
  create(context) {
    return {
      JSXText(node) {
        if (LETTERS.test(node.value)) context.report({ node, messageId: 'literal' });
      },
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : null;
        const text = name && LABEL_PROPS.has(name) ? literalText(node.value) : null;
        if (text && LETTERS.test(text)) context.report({ node, messageId: 'literal' });
      },
    };
  },
};

const noThemeKey = {
  meta: {
    type: 'problem',
    docs: { description: 'A key never depends on the theme, density, or size class.' },
    messages: { key: 'A key that changes with {{what}} remounts the subtree and loses scroll and selection.' },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'key' || !node.value) return;
        const text = context.sourceCode.getText(node.value);
        const what = /\b(theme|density|sizeClass)\b/i.exec(text)?.[1];
        if (what) context.report({ node, messageId: 'key', data: { what } });
      },
    };
  },
};

export default {
  meta: { name: 'opennote' },
  rules: {
    'feature-boundaries': featureBoundaries,
    'ui-boundaries': uiBoundaries,
    'editor-boundaries': editorBoundaries,
    'no-literal-text': noLiteralText,
    'no-theme-key': noThemeKey,
  },
};
