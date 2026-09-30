// Runs inside a headless browser against one inline SVG and writes findings as JSON into #out.
// Measures what is actually rendered: text overlap, padding inside containers, edge spacing,
// minimum text size, safe margins, and whether the drawing can scale.

const svg = document.querySelector('svg');
const findings = [];
const add = (message, text = '') => findings.push({ message, text });
const view = svg.viewBox.baseVal;
const width = view && view.width ? view.width : svg.getBoundingClientRect().width;
const height = view && view.height ? view.height : svg.getBoundingClientRect().height;
const frame = svg.getBoundingClientRect();
const scale = frame.width / width;

const box = (el) => {
  const r = el.getBoundingClientRect();
  return {
    x: (r.left - frame.left) / scale,
    y: (r.top - frame.top) / scale,
    w: r.width / scale,
    h: r.height / scale,
  };
};
const label = (el) => el.textContent.trim().slice(0, 40);

// Text hidden under something drawn later (such as a dialog over a dimmed page) is skipped.
function covered(el, b) {
  const stack = document.elementsFromPoint(frame.left + (b.x + b.w / 2) * scale, frame.top + (b.y + b.h / 2) * scale);
  const above = stack.slice(0, Math.max(0, stack.indexOf(el)));
  const later = (node) => Boolean(el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
  return above.some((node) => !node.closest('text') && !el.contains(node) && later(node));
}

// Groups marked data-center="x", "y" or "both" must center their text in the container rect.
function checkCentering() {
  for (const group of svg.querySelectorAll('[data-center]')) {
    const mode = group.getAttribute('data-center');
    const c = box(group.querySelector('rect'));
    for (const el of group.querySelectorAll('text')) {
      const t = box(el);
      const dx = t.x + t.w / 2 - (c.x + c.w / 2);
      const dy = t.y + t.h / 2 - (c.y + c.h / 2);
      if (mode !== 'y' && Math.abs(dx) > 1.5) add(`Text is ${dx.toFixed(1)}px off horizontal center.`, label(el));
      if (mode !== 'x' && Math.abs(dy) > 2.5) add(`Text is ${dy.toFixed(1)}px off vertical center.`, label(el));
    }
  }
}

// Left-aligned text that starts 0.5 to 3px away from a nearby line looks like a mistake.
function checkAlignment(items) {
  const starts = items
    .filter(
      ({ el }) => (el.getAttribute('text-anchor') || 'start') === 'start' && !el.closest('[pointer-events="none"]'),
    )
    .map(({ el, b }) => ({ el, x: parseFloat(el.getAttribute('x')), y: b.y }));
  for (let i = 0; i < starts.length; i++) {
    for (let j = i + 1; j < starts.length; j++) {
      const dx = Math.abs(starts[i].x - starts[j].x);
      const near = Math.abs(starts[i].y - starts[j].y) < 120;
      if (near && dx > 0.5 && dx <= 3)
        add(`Left edge is ${dx}px off "${label(starts[j].el)}"; align them.`, label(starts[i].el));
    }
  }
}

function checkScaling() {
  if (!svg.getAttribute('viewBox')) add('SVG has no viewBox, so it cannot scale.');
  const w = parseFloat(svg.getAttribute('width'));
  const h = parseFloat(svg.getAttribute('height'));
  if (w && h && Math.abs(w / h - width / height) > 0.01) add('width and height do not match the viewBox aspect ratio.');
}

function checkTextSizeAndEdges(items) {
  const edge = Math.max(4, parseFloat(svg.getAttribute('data-safe-margin') || '0'));
  for (const { el, b } of items) {
    const size = parseFloat(el.getAttribute('font-size') || '16');
    if (size < 11) add(`Text is ${size}px; the minimum is 11px.`, label(el));
    const outside = b.x < edge || b.y < edge || b.x + b.w > width - edge || b.y + b.h > height - edge;
    if (outside) add(`Text is closer than ${edge}px to the edge, or outside the canvas.`, label(el));
  }
}

function checkOverlaps(items) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].b;
      const b = items[j].b;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 2 && iy > 3) add(`Text overlaps "${label(items[j].el)}".`, label(items[i].el));
    }
  }
}

// Groups marked data-fit="<padding>" hold a container rect and the text that must fit inside it.
function checkContainers() {
  for (const group of svg.querySelectorAll('[data-fit]')) {
    const container = group.querySelector('rect');
    if (!container) continue;
    const pad = parseFloat(group.getAttribute('data-fit'));
    const c = box(container);
    for (const el of group.querySelectorAll('text')) {
      const t = box(el);
      const fits =
        t.x >= c.x + pad - 0.5 && t.x + t.w <= c.x + c.w - pad + 0.5 && t.y >= c.y - 1 && t.y + t.h <= c.y + c.h + 1;
      if (!fits) add(`Text doesn't fit its container with ${pad}px padding.`, label(el));
    }
  }
}

// Elements marked data-important must stay inside the safe margin (for example, social previews).
function checkImportant() {
  const margin = parseFloat(svg.getAttribute('data-safe-margin') || '0');
  for (const el of svg.querySelectorAll('[data-important]')) {
    const b = box(el);
    const inside = b.x >= margin && b.y >= margin && b.x + b.w <= width - margin && b.y + b.h <= height - margin;
    if (!inside) add(`Important element is outside the ${margin}px safe margin.`, el.getAttribute('data-important'));
  }
}

function main() {
  checkScaling();
  const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim() !== '');
  const measured = texts.map((el) => ({ el, b: box(el) })).filter(({ el, b }) => !covered(el, b));
  checkTextSizeAndEdges(measured);
  checkOverlaps(measured);
  checkContainers();
  checkCentering();
  checkAlignment(measured);
  checkImportant();
  document.getElementById('out').textContent = JSON.stringify(findings);
}

main();
