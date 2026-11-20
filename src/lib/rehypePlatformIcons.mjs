/**
 * An operating system's logo beside its name, in Neuman's docs.
 *
 * The docs are Neuman's plain Markdown (scripts/fetch-docs.mjs), so they read
 * the same on GitHub; how they look is this site's. Where a table header or a
 * heading is exactly the name of a platform `platformIcons.mjs` has a mark for,
 * this puts the logo in front of the word, drawn in the text's own colour.
 * Nothing else is matched, so a sentence that mentions Linux is left alone.
 *
 * The marks themselves live in platformIcons.mjs, which `/download` draws too.
 */

import { PLATFORM_ICONS } from './platformIcons.mjs';

const MATCHED = new Set(['th', 'h2', 'h3', 'h4']);

function text(node) {
  if (node.type === 'text') return node.value;
  return (node.children ?? []).map(text).join('');
}

function icon(paths) {
  return {
    type: 'element',
    tagName: 'svg',
    properties: { className: ['platform-icon'], viewBox: '0 0 24 24', ariaHidden: 'true', focusable: 'false' },
    children: paths.map(d => ({ type: 'element', tagName: 'path', properties: { d }, children: [] })),
  };
}

function walk(node) {
  if (node.type === 'element' && MATCHED.has(node.tagName)) {
    const paths = PLATFORM_ICONS[text(node).trim()];
    if (paths) node.children.unshift(icon(paths));
    return;
  }
  for (const child of node.children ?? []) walk(child);
}

/** Only Neuman's docs, which live in src/content/docs. */
export default function rehypePlatformIcons() {
  return (tree, file) => {
    if (!String(file.path ?? '').includes('/src/content/docs/')) return;
    walk(tree);
  };
}
