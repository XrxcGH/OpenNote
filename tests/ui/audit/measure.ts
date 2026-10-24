// checks-disable-file length, modifiability: Page.evaluate runs this one function in the page, so it uses nothing from outside and cannot be split across modules.
// The layout audit's measuring function. It runs inside the page (Page.evaluate), so it uses nothing from outside and
// reads only the live layout: boxes, text ranges, computed styles, and elementFromPoint. It returns findings of the
// kinds the owner listed, each with a stable selector and the numbers measured (see README.md).

export type FindingKind =
  | 'text-clip'
  | 'truncation-no-tooltip'
  | 'text-spill'
  | 'text-overlap'
  | 'box-overlap'
  | 'clipped-by-ancestor'
  | 'scrollbar-occluded'
  | 'offscreen'
  | 'target-gap'
  | 'target-small'
  | 'document-scroll'
  | 'dead-space';

export interface RawFinding {
  kind: FindingKind;
  /** A stable path (no hashes, no indexes) that names the element. */
  selector: string;
  /** What was measured, for a person reading the list. It is not part of the key. */
  detail: string;
  /** The first words of the element's text, when it has some. */
  text?: string;
}

export interface MeasureOptions {
  /** Limits the checks that look at elements to the inside of these. Default: the whole document. */
  scope: string | null;
}

export function measureLayout(options: MeasureOptions): RawFinding[] {
  const found: RawFinding[] = [];
  const seen = new Set<string>();
  const round = (n: number) => Math.round(n * 10) / 10;
  const root = document.documentElement;
  const touch = root.dataset.density === 'touch';
  const MIN_TARGET = touch ? 44 : 24;
  const view = { width: root.clientWidth, height: root.clientHeight };

  // ---- naming -------------------------------------------------------------------------------------------------
  const stripClass = (name: string) => name.replace(/^_/, '').replace(/_[a-z0-9]{4,8}_\d+$/i, '');
  const hop = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const parts = [tag];
    const role = el.getAttribute('role');
    if (role) parts.push(`[role=${role}]`);
    for (const attr of ['data-tool', 'data-region', 'data-scope', 'data-kind', 'data-block', 'data-type']) {
      const value = el.getAttribute(attr);
      if (value !== null && value.length < 30) parts.push(`[${attr}${value ? `=${value}` : ''}]`);
    }
    const first = [...el.classList].map(stripClass).find((name) => name && !/^\d/.test(name));
    if (first) parts.push(`.${first}`);
    return parts.join('');
  };
  const describe = (el: Element, depth = 3): string => {
    const path: string[] = [];
    let at: Element | null = el;
    for (let i = 0; at && i < depth && at !== document.body; i += 1, at = at.parentElement) path.unshift(hop(at));
    return path.join(' > ');
  };
  const sample = (el: Element): string | undefined => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 40) : undefined;
  };
  const add = (kind: FindingKind, el: Element, detail: string, extra = '') => {
    const selector = describe(el) + extra;
    const key = `${kind}|${selector}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, selector, detail, text: sample(el) });
  };

  // ---- geometry helpers ---------------------------------------------------------------------------------------
  const style = (el: Element) => getComputedStyle(el);
  const clips = (value: string) => value === 'hidden' || value === 'clip';
  const isBoxVisible = (el: Element, rect: DOMRect): boolean => {
    if (rect.width < 1 || rect.height < 1) return false;
    const s = style(el);
    if (s.visibility !== 'visible' || s.display === 'none') return false;
    // A visually hidden element (the "screen reader only" idiom) is 1px or clipped away.
    if (s.clip && s.clip !== 'auto' && /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(s.clip)) return false;
    if (s.clipPath === 'inset(50%)') return false;
    return true;
  };
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'OPTION', 'OPTGROUP', 'HEAD', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE']);
  const scopeRoots: Element[] = options.scope ? [...document.querySelectorAll(options.scope)] : [document.body];
  const all: Element[] = [];
  for (const base of scopeRoots) {
    all.push(base);
    for (const el of base.querySelectorAll('*')) all.push(el);
  }
  /** The inside of a closed details element (its summary stays) is not shown, though it still has boxes. */
  const inClosedDetails = (el: Element): boolean => {
    for (let at: Element | null = el.parentElement; at; at = at.parentElement) {
      if (at.tagName === 'DETAILS' && !(at as HTMLDetailsElement).open && !el.closest('summary')) return true;
    }
    return false;
  };
  const unique = [...new Set(all)].filter(
    (el) =>
      !SKIP_TAGS.has(el.tagName) &&
      !inClosedDetails(el) &&
      !(el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') &&
      !el.closest('[data-audit-skip], canvas, svg'),
  );

  const INTERACTIVE =
    'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], ' +
    '[role=menuitemcheckbox], [role=menuitemradio], [role=checkbox], [role=radio], [role=switch], [role=option], ' +
    '[role=treeitem], [role=slider], [role=link], [role=combobox], [role=spinbutton]';
  const MEDIA = 'img, svg, canvas, video';

  /** The rectangle of an element that shows: its box cut by the ancestors that clip it and by the window. */
  const shownRect = (el: Element): DOMRect | null => {
    let { left, top, right, bottom } = el.getBoundingClientRect();
    let at: Element | null = el.parentElement;
    const position = style(el).position;
    let skipStatic = position === 'absolute';
    const fixed = position === 'fixed';
    while (at && !fixed) {
      const s = style(at);
      if (skipStatic && s.position === 'static' && s.transform === 'none') {
        at = at.parentElement;
        continue;
      }
      skipStatic = false;
      if (s.position === 'fixed' && at !== el) break;
      if (
        clips(s.overflowX) ||
        clips(s.overflowY) ||
        s.overflowX === 'auto' ||
        s.overflowX === 'scroll' ||
        s.overflowY === 'auto' ||
        s.overflowY === 'scroll'
      ) {
        const r = at.getBoundingClientRect();
        if (s.overflowX !== 'visible') {
          left = Math.max(left, r.left);
          right = Math.min(right, r.right);
        }
        if (s.overflowY !== 'visible') {
          top = Math.max(top, r.top);
          bottom = Math.min(bottom, r.bottom);
        }
      }
      at = at.parentElement;
    }
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, view.width);
    bottom = Math.min(bottom, view.height);
    return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null;
  };

  const ownTextRects = (el: Element): DOMRect[] => {
    const rects: DOMRect[] = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !(node.textContent ?? '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) rects.push(r);
    }
    return rects;
  };

  const hasTooltip = (el: Element): boolean => {
    for (let at: Element | null = el, i = 0; at && i < 4; i += 1, at = at.parentElement) {
      if (at.getAttribute('title') || at.hasAttribute('data-tooltip') || at.getAttribute('aria-describedby'))
        return true;
    }
    return false;
  };

  const hiddenCache = new WeakMap<Element, boolean>();
  /** The "screen reader only" idiom: clipped to nothing or one pixel, so it takes no part in the layout a person sees. */
  const visuallyHidden = (el: Element | null): boolean => {
    if (!el || el === document.body) return false;
    const have = hiddenCache.get(el);
    if (have !== undefined) return have;
    const s = style(el);
    const tiny = parseFloat(s.width) <= 1 && parseFloat(s.height) <= 1 && s.overflow !== 'visible';
    const clippedAway = (s.clip && s.clip !== 'auto') || s.clipPath === 'inset(50%)';
    const named = /visuallyHidden|visually-hidden|sr-only|srOnly/i.test(String(el.getAttribute('class') ?? ''));
    const result =
      named || (s.position === 'absolute' && Boolean(tiny || clippedAway)) || visuallyHidden(el.parentElement);
    hiddenCache.set(el, result);
    return result;
  };
  /** True when a modal dialog that does not hold the element is drawn over its middle. */
  const behindModal = (el: Element, shown: DOMRect): boolean => {
    const hit = document.elementFromPoint(shown.left + shown.width / 2, shown.top + shown.height / 2);
    if (!hit || el.contains(hit) || hit.contains(el)) return false;
    const modal = hit.closest('[aria-modal=true], dialog[open]');
    return Boolean(modal && !modal.contains(el));
  };

  /**
   * The floating surface an element belongs to (a dialog, menu, tool window, or fixed layer), or the page. Boxes in
   * different layers lie over one another by design, so only boxes of one layer are checked against each other.
   */
  const LAYER =
    '[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [role=tooltip], [popover], [data-tool], [aria-modal=true]';
  const layerCache = new WeakMap<Element, Element | null>();
  const layerOf = (el: Element): Element | null => {
    if (layerCache.has(el)) return layerCache.get(el) ?? null;
    let found: Element | null = null;
    for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
      if (at.matches(LAYER) || style(at).position === 'fixed') {
        found = at;
        break;
      }
    }
    layerCache.set(el, found);
    return found;
  };

  // ---- gather the boxes that carry text or take input ---------------------------------------------------------
  interface Item {
    el: Element;
    box: DOMRect;
    texts: DOMRect[];
    interactive: boolean;
  }
  const items: Item[] = [];
  for (const el of unique) {
    const box = el.getBoundingClientRect();
    if (!isBoxVisible(el, box)) continue;
    const shown = shownRect(el);
    if (!shown || visuallyHidden(el) || el.closest('[inert]') || behindModal(el, shown)) continue;
    // Text that a scrolling or clipping ancestor has moved out of sight takes no part in what a person sees.
    const texts = ownTextRects(el).filter(
      (r) => r.right > shown.left && r.left < shown.right && r.bottom > shown.top && r.top < shown.bottom,
    );
    const interactive = el.matches(INTERACTIVE);
    if (texts.length === 0 && !interactive && !el.matches(MEDIA)) continue;
    items.push({ el, box, texts, interactive });
  }

  // ---- 1 and 3: text that is cut off, spills out of its box, or is clipped by an ancestor ----------------------
  for (const { el, box, texts, interactive } of items) {
    const s = style(el);
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    const isHorizontalClip = clips(s.overflowX) || (isField && s.overflowX !== 'visible');
    const isVerticalClip = clips(s.overflowY);
    const ellipsis = s.textOverflow === 'ellipsis';
    const clamped = s.webkitLineClamp !== undefined && s.webkitLineClamp !== 'none' && s.webkitLineClamp !== '';
    const wider = el.scrollWidth - el.clientWidth;
    const taller = el.scrollHeight - el.clientHeight;
    if ((texts.length > 0 || isField) && el.clientWidth > 0) {
      if (isHorizontalClip && wider > 1.5) {
        if (ellipsis || clamped) {
          if (!hasTooltip(el))
            add('truncation-no-tooltip', el, `text is ${round(wider)} px wider than its ${el.clientWidth} px box`);
        } else if (isField ? !(el instanceof HTMLTextAreaElement) : true) {
          add('text-clip', el, `text is ${round(wider)} px wider than its ${el.clientWidth} px box`);
        }
      }
      if (isVerticalClip && taller > 1.5 && !isField) {
        if (clamped) {
          if (!hasTooltip(el))
            add('truncation-no-tooltip', el, `${round(taller)} px of text is cut below a ${el.clientHeight} px box`);
        } else {
          add('text-clip', el, `text is ${round(taller)} px taller than its ${el.clientHeight} px box`);
        }
      }
    }
    // Text that leaves the box of a control or a chip, with nothing clipping it, still collides with what is next to it.
    if (texts.length > 0 && (interactive || style(el).borderTopWidth !== '0px' || isOpaque(s.backgroundColor))) {
      if (!isHorizontalClip && !isVerticalClip && !ellipsis && s.display !== 'inline') {
        const left = Math.min(...texts.map((r) => r.left));
        const right = Math.max(...texts.map((r) => r.right));
        const top = Math.min(...texts.map((r) => r.top));
        const bottom = Math.max(...texts.map((r) => r.bottom));
        const spill = Math.max(box.left - left, right - box.right, box.top - top, bottom - box.bottom);
        if (spill > 2)
          add(
            'text-spill',
            el,
            `text leaves the ${round(box.width)} x ${round(box.height)} px box by ${round(spill)} px`,
          );
      }
    }
    // Clipped by an ancestor that hides overflow: the part of the box or the text that is cut away.
    const targets = texts.length > 0 ? texts : [box];
    const full = new DOMRect(Math.min(...targets.map((r) => r.left)), Math.min(...targets.map((r) => r.top)), 0, 0);
    const fullRight = Math.max(...targets.map((r) => r.right));
    const fullBottom = Math.max(...targets.map((r) => r.bottom));
    const shown = shownRect(el);
    if (!shown) continue;
    // The element shows partly: cut by 2 px or more on a side, and not nothing at all.
    const cutX = Math.max(0, shown.left - full.left, fullRight - shown.right);
    const cutY = Math.max(0, shown.top - full.top, fullBottom - shown.bottom);
    const insideWindow =
      full.left >= -1 && fullRight <= view.width + 1 && full.top >= -1 && fullBottom <= view.height + 1;
    if (insideWindow && (cutX > 2 || cutY > 2) && !(el.matches('[role=tabpanel], .sr-only') || ellipsis)) {
      // Find the ancestor that does the clipping, to name it.
      let culprit: Element | null = null;
      for (let at = el.parentElement; at; at = at.parentElement) {
        const cs = style(at);
        if (clips(cs.overflowX) || clips(cs.overflowY)) {
          const r = at.getBoundingClientRect();
          if (full.left < r.left - 2 || fullRight > r.right + 2 || full.top < r.top - 2 || fullBottom > r.bottom + 2) {
            culprit = at;
            break;
          }
        }
      }
      if (culprit)
        add('clipped-by-ancestor', el, `cut by ${round(Math.max(cutX, cutY))} px by ${describe(culprit, 1)}`);
    }
  }

  function isOpaque(color: string): boolean {
    const match = color.match(/rgba?\(([^)]+)\)/);
    if (!match) return false;
    const parts = match[1]!.split(/[ ,/]+/).filter(Boolean);
    return parts.length < 4 || Number(parts[3]) > 0.05;
  }

  // ---- 2: overlap ---------------------------------------------------------------------------------------------
  const crossing = (a: DOMRect, b: DOMRect, min: number): number => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > min && h > min ? w * h : 0;
  };
  const sorted = items
    .filter(
      (item) => item.el.getAttribute('role') !== 'separator' && !item.el.closest('[aria-hidden=true][data-decor]'),
    )
    .sort((a, b) => a.box.left - b.box.left)
    .slice(0, 4000);
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j]!;
      // The list is sorted by left edge, but text can start left of its box, so leave a margin before stopping.
      if (b.box.left > a.box.right + 400 && b.texts.every((r) => r.left > a.box.right + 400)) break;
      if (a.el === b.el || layerOf(a.el) !== layerOf(b.el)) continue;
      const aInB = b.el.contains(a.el);
      const bInA = a.el.contains(b.el);
      // Text against text, whoever owns it: the periodic table's number over its symbol is this case.
      let hit = '';
      outer: for (const ra of a.texts) {
        for (const rb of b.texts) {
          const area = crossing(ra, rb, 1.5);
          if (area > 6) {
            hit = `text of ${describe(a.el, 1)} and ${describe(b.el, 1)} overlap by ${round(area)} px2`;
            break outer;
          }
        }
      }
      if (hit) {
        add('text-overlap', a.el, hit, ` x ${describe(b.el, 2)}`);
        continue;
      }
      if (aInB || bInA) continue;
      if (a.interactive && b.interactive) {
        const area = crossing(a.box, b.box, 2);
        if (area > 12)
          add(
            'box-overlap',
            a.el,
            `${describe(a.el, 1)} and ${describe(b.el, 1)} overlap by ${round(area)} px2`,
            ` x ${describe(b.el, 2)}`,
          );
      } else if (a.interactive !== b.interactive) {
        const control = a.interactive ? a : b;
        const text = a.interactive ? b : a;
        if (control.el.contains(text.el)) continue;
        for (const r of text.texts) {
          const area = crossing(control.box, r, 2);
          if (area > 12) {
            add(
              'box-overlap',
              control.el,
              `text of ${describe(text.el, 1)} lies ${round(area)} px2 over this control`,
              ` x ${describe(text.el, 2)}`,
            );
            break;
          }
        }
      }
    }
  }

  // ---- 6: targets too small or too close ----------------------------------------------------------------------
  interface Target {
    el: Element;
    box: DOMRect;
  }
  const targets: Target[] = [];
  for (const { el, box, interactive } of items) {
    if (!interactive) continue;
    if (el.getAttribute('role') === 'separator') continue;
    // An inline link inside a sentence is exempt from the size rule (WCAG 2.5.8).
    if (el.tagName === 'A' && style(el).display === 'inline') continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      const label = el.closest('label');
      targets.push({ el, box: label ? label.getBoundingClientRect() : box });
      continue;
    }
    if (el.matches('[contenteditable]')) continue;
    targets.push({ el, box });
  }
  for (const { el, box } of targets) {
    if (box.width < MIN_TARGET - 0.5 || box.height < MIN_TARGET - 0.5) {
      add('target-small', el, `${round(box.width)} x ${round(box.height)} px, the least is ${MIN_TARGET}`);
    }
  }
  const JOINED =
    '[role=tree], [role=listbox], [role=menu], [role=tablist], [role=toolbar], [role=group], [role=radiogroup], [role=grid], [role=table], [role=list], ul, ol, table, nav';
  /** Two targets inside one list, strip, or group: the closest container that holds both is of that kind. */
  const joined = (a: Element, b: Element): boolean => {
    let at: Element | null = a.parentElement;
    while (at && !at.contains(b)) at = at.parentElement;
    return Boolean(at && at.closest(JOINED));
  };
  const byLeft = [...targets].sort((a, b) => a.box.left - b.box.left);
  for (let i = 0; i < byLeft.length; i += 1) {
    const a = byLeft[i]!;
    for (let j = i + 1; j < byLeft.length; j += 1) {
      const b = byLeft[j]!;
      if (b.box.left > a.box.right + 4) break;
      if (a.el.contains(b.el) || b.el.contains(a.el) || layerOf(a.el) !== layerOf(b.el)) continue;
      const gapX = Math.max(a.box.left, b.box.left) - Math.min(a.box.right, b.box.right);
      const gapY = Math.max(a.box.top, b.box.top) - Math.min(a.box.bottom, b.box.bottom);
      // Side by side or one above the other, and closer than 4 px, but not overlapping (that is its own finding).
      const gap = Math.max(gapX, gapY);
      const apart = gapX >= 0 || gapY >= 0;
      if (apart && gap < 4 && Math.min(gapX, gapY) < 0) {
        // Rows of a list, tabs of a tab strip, and the segments of a group touch by design.
        if (gap <= 0.5 && joined(a.el, b.el)) continue;
        add('target-gap', a.el, `${round(gap)} px from ${describe(b.el, 1)}`, ` x ${describe(b.el, 2)}`);
      }
    }
  }

  // ---- 4: scroll bars covered by something else ---------------------------------------------------------------
  const everything = document.body.querySelectorAll('*');
  for (const el of [document.documentElement, ...everything]) {
    const s = style(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const scrollsY = (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
    const scrollsX = (s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
    if (!scrollsY && !scrollsX) continue;
    const visible = el === document.documentElement ? new DOMRect(0, 0, view.width, view.height) : shownRect(el);
    if (!visible) continue;
    const bw = parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
    const bh = parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
    const barW =
      el === document.documentElement
        ? window.innerWidth - root.clientWidth
        : (el as HTMLElement).offsetWidth - el.clientWidth - bw;
    const barH =
      el === document.documentElement
        ? window.innerHeight - root.clientHeight
        : (el as HTMLElement).offsetHeight - el.clientHeight - bh;
    const probe = (x: number, y: number, side: string) => {
      if (x < 0 || y < 0 || x >= view.width || y >= view.height) return;
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === el || (el === document.documentElement && (hit === document.body || hit === root))) return;
      // A modal's scrim covers the whole window on purpose; a tool window or panel over a scroll bar does not.
      if (hit.closest('[aria-modal=true], [class*=scrim], [class*=backdrop]') && !hit.closest('[data-tool]')) return;
      // Something inside the scroller under the pointer means the bar is not there (an overlay bar, or a scaled page); a toast is brief.
      if ((el !== document.documentElement && el.contains(hit)) || hit.closest('[role=status], [class*=toast]')) return;
      add(
        'scrollbar-occluded',
        el,
        `the ${side} scroll bar is covered at (${Math.round(x)}, ${Math.round(y)}) by ${describe(hit, 2)}`,
        ` <- ${describe(hit, 2)}`,
      );
    };
    if (scrollsY && barW > 3) {
      const x = rect.right - parseFloat(s.borderRightWidth) - barW / 2;
      const top = Math.max(visible.top, 0) + 12;
      const bottom = Math.min(visible.bottom, view.height) - 12;
      if (x <= visible.right && x >= visible.left && bottom > top)
        for (const f of [0, 0.25, 0.5, 0.75, 1]) probe(x, top + (bottom - top) * f, 'vertical');
    }
    if (scrollsX && barH > 3) {
      const y = rect.bottom - parseFloat(s.borderBottomWidth) - barH / 2;
      const left = Math.max(visible.left, 0) + 12;
      const right = Math.min(visible.right, view.width) - 12;
      if (y <= visible.bottom && y >= visible.top && right > left)
        for (const f of [0, 0.25, 0.5, 0.75, 1]) probe(left + (right - left) * f, y, 'horizontal');
    }
  }

  // ---- 5: menus, popovers, and windows that do not fit the window --------------------------------------------
  const FLOATING =
    '[role=menu], [role=listbox], [role=dialog], [role=tooltip], [popover], [data-tool], [role=alertdialog]';
  for (const el of document.querySelectorAll(FLOATING)) {
    if (el.tagName === 'CANVAS') continue;
    if (options.scope && !scopeRoots.some((base) => base === el || base.contains(el) || el.contains(base))) continue;
    const r = el.getBoundingClientRect();
    if (!isBoxVisible(el, r)) continue;
    const over = Math.max(-r.left, -r.top, r.right - view.width, r.bottom - view.height);
    if (over > 1) {
      add(
        'offscreen',
        el,
        `${round(over)} px outside the ${view.width} x ${view.height} px window (box ${round(r.left)}, ${round(r.top)}, ${round(r.right)}, ${round(r.bottom)})`,
      );
    }
  }

  // ---- 7: the document itself scrolls -------------------------------------------------------------------------
  const sx = root.scrollWidth - root.clientWidth;
  const sy = root.scrollHeight - root.clientHeight;
  if (sx > 1 || sy > 1)
    add('document-scroll', document.body, `the document scrolls by ${round(sx)} px across and ${round(sy)} px down`);

  // ---- 8: dead space in a window, panel, or dialog -----------------------------------------------------------
  const SURFACES = '[role=dialog], [role=alertdialog], [data-tool], [role=menu], [role=listbox], aside, [data-panel]';
  const paintedBottom = (surface: Element, skip: Element): number => {
    let low = -Infinity;
    for (const el of surface.querySelectorAll('*')) {
      if (el === skip || skip.contains(el) || el.contains(skip)) continue;
      const r = el.getBoundingClientRect();
      if (!isBoxVisible(el, r)) continue;
      const s = style(el);
      const paints =
        ownTextRects(el).length > 0 ||
        el.matches(`${INTERACTIVE}, ${MEDIA}`) ||
        parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth) > 0 ||
        isOpaque(s.backgroundColor);
      if (paints)
        low = Math.max(
          low,
          ownTextRects(el).reduce((m, t) => Math.max(m, t.bottom), r.bottom),
        );
    }
    return low;
  };
  for (const surface of document.querySelectorAll(SURFACES)) {
    if (
      options.scope &&
      !scopeRoots.some((base) => base === surface || base.contains(surface) || surface.contains(base))
    )
      continue;
    const sr = surface.getBoundingClientRect();
    const ss = style(surface);
    if (!isBoxVisible(surface, sr) || sr.height < 120) continue;
    const innerBottom = sr.bottom - parseFloat(ss.borderBottomWidth) - parseFloat(ss.paddingBottom);
    const scrollers = [surface, ...surface.querySelectorAll('*')].filter((el) => {
      const s = style(el);
      const r = el.getBoundingClientRect();
      return (
        r.height > 20 &&
        el.scrollHeight > el.clientHeight + 1 &&
        (s.overflowY === 'auto' || s.overflowY === 'scroll' || clips(s.overflowY))
      );
    });
    if (scrollers.length === 0) continue;
    for (const k of scrollers) {
      if (k === surface) {
        // The surface scrolls: dead space inside it is the gap under its last painted thing, if it scrolls anyway.
        continue;
      }
      const kr = k.getBoundingClientRect();
      const low = paintedBottom(surface, k);
      const emptyFrom = Math.max(kr.bottom, low);
      const empty = Math.min(innerBottom, view.height) - emptyFrom;
      const need = k.scrollHeight - k.clientHeight;
      if (empty >= 32) {
        add(
          'dead-space',
          k,
          `${round(empty)} px under it in ${describe(surface, 1)} show nothing while it scrolls by ${round(need)} px (it is ${round(kr.height)} px tall)`,
        );
      }
      // A scroller inside a scroller: two scroll bars where the outer one could hold everything.
      const outer = scrollers.find((o) => o !== k && o.contains(k));
      if (outer && outer !== surface && need > 1) {
        add(
          'dead-space',
          k,
          `scrolls inside ${describe(outer, 1)}, which also scrolls (${round(need)} px and ${round(outer.scrollHeight - outer.clientHeight)} px)`,
          ' (nested)',
        );
      }
    }
    // An empty box of 32 px or more, in a surface whose content is cut off or scrolls.
    const candidates = [...surface.querySelectorAll('*')].filter((el) => {
      if (el.closest('svg')) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 32 || r.height < 32 || !isBoxVisible(el, r)) return false;
      const s = style(el);
      if (el.matches(`${INTERACTIVE}, ${MEDIA}`) || ownTextRects(el).length > 0) return false;
      if (el.querySelector(`${INTERACTIVE}, ${MEDIA}, canvas`)) return false;
      if ((el.textContent ?? '').trim()) return false;
      if (parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth) + parseFloat(s.borderLeftWidth) > 0)
        return false;
      if (isOpaque(s.backgroundColor) && s.backgroundColor !== ss.backgroundColor) return false;
      if (s.backgroundImage !== 'none') return false;
      return !el.closest('[aria-hidden=true][data-decor]');
    });
    for (const el of candidates) {
      if (candidates.some((other) => other !== el && other.contains(el))) continue;
      add(
        'dead-space',
        el,
        `an empty ${round(el.getBoundingClientRect().width)} x ${round(el.getBoundingClientRect().height)} px box in ${describe(surface, 1)}, which scrolls or is cut off`,
        ' (empty box)',
      );
    }
  }

  return found;
}
