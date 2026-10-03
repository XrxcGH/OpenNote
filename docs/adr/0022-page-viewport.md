# ADR 0022: The page viewport: native scrolling, app touch panning, and the camera

- Status: Proposed, pending spike S5 on real touch hardware. The typing and frame numbers are re-measured in [docs/perf/phase-4.md](../perf/phase-4.md)
- Date: 2026-10-02

## Context

[ADR 0005](0005-freeform-text.md) placed every text container in one "world" element and moved it with one CSS transform (translate, then scale) for zoom and pan. It measured 118 to 120 frames per second while zooming and panning without ink, and it added `will-change: transform` only during gestures. Phase 4 and Phase 5 add needs the spike didn't test:

- **Focus and the caret.** With a transform-only pan, the browser can't scroll a focused element or the caret into view. Tab, screen reader focus, Narrator's scan mode, and typing near the window's edge could then land off screen (Web Content Accessibility Guidelines (WCAG) 2.4.7 and 2.4.11).
- **Scroll bars, keyboard scrolling, touchpad momentum,** which people expect.
- **Phase 5's ink.** Both Phase 5 candidates need the page viewport to have `touch-action: none`, so the browser never pans on its own. Palm rejection must decide before any pan, a pen stroke must never scroll the page, a pen marquee must work, and panning must freeze while a pen is down. They also need a camera API (zoom, scroll, device pixel ratio, and gesture events) and a pan that snaps to device pixels at the end of a gesture.
- **Budgets.** 60 frames per second (120 on fast screens), never two dropped frames in a row, and typing within 16 ms.

## Decision

We will build the page viewport as ARCHITECTURE.md section 5 describes:

1. A native scroll container pans for the wheel, the precision touchpad, scroll bars, the keyboard, and focus and caret following. The world inside it keeps ADR 0005's one transform, `scale()`, for page zoom, with `will-change: transform` only during zoom gestures.
2. The viewport has `touch-action: none`. For touch, the app pans (writing scroll offsets once per animation frame, with a short glide) and pinches (changing the zoom around the fingers' midpoint) through a pointer router in the capture phase. Wheel and touchpad scrolling don't depend on `touch-action` and stay native.
3. In Phase 4 the pen selects and types like a mouse: a drag on text selects it, and a drag on empty page draws a marquee. The pen pans with the barrel button held, the scroll bars, or a two-finger touch.
4. Ctrl+wheel and touchpad pinch over the page zoom the page; Ctrl+=, Ctrl+-, and Ctrl+0 keep changing interface text size in the default shortcut set.
5. A camera API and the pointer router are the seams for Phase 5: `camera()`, `onCamera`, `onGesture`, `toWorld`, `toClient`, `holdCamera`, `registerPointerTool`, and `setActiveTool`. Scroll offsets snap to whole device pixels when a gesture ends.

This holds only if spike S5 passes on the Surface and the reference laptop. Touch panning and pinching must hold 60 frames per second with no two dropped frames in a row, and no `pointercancel` may arrive mid-gesture. Long-press menus, touch selection handles, and the pen marquee must work. If app-driven touch panning drops frames, the fallback moves the world with a transform during a touch gesture and folds the offset into the scroll position when it ends. The typing and frame benchmarks re-measure ADR 0005's conditions with this structure.

## Options considered

| Option | For | Against |
|---|---|---|
| Native scrolling, `touch-action: none`, app touch panning (chosen) | Focus, caret, and screen reader scrolling are native; scroll bars and touchpad momentum; the browser never pans for pens or palms, so Phase 5 can reject palms and draw | Touch panning runs on the main thread; the app writes the glide; in-place pen handwriting on the page ("write in text fields") is off |
| Transform-only world (ADR 0005's spike) | Measured at 118 to 120 frames per second; compositor-only moves | No native scroll into view for focus or the caret; no scroll bars; the app must write focus following, keyboard scrolling, and momentum |
| Native scrolling with `touch-action: pan-x pan-y` (the lean candidate) | Compositor-threaded touch panning for free | Pen drags and palms pan natively, so Phase 5's palm rejection and pen marquee can't work; the reviews required a fix |
| Switch `touch-action` to `none` on pen hover or while a pen tool is active | Native touch panning most of the time | `touch-action` is decided at touch down, so hover timing races with a landing palm; two modes to test |

## Consequences

- Easier: keyboard and screen reader users get native scrolling and focus following; Phase 5 plugs into a stable camera and router without reworking Phase 4's tap, marquee, and gesture handlers.
- Harder: Phase 4 owns touch panning and pinching, including the glide and reduced motion; touch panning competes with main-thread work, so heavy work stays off the main thread during gestures.
- Windows 11's in-place pen handwriting doesn't reach text on the page, because pen contact goes to the router. The Windows handwriting panel still types into page text, and in-place handwriting works in the app's plain text fields. The owner decides after spike S6 whether a later setting should change this, knowing it conflicts with ink.
- Follow-up work: the camera and router seams in `features/page/seams/`; the motion benchmark with touch pan and pinch; the manual Surface checks.
- Revisit if spike S5 fails and the transform fallback also drops frames, or if a WebView2 update changes how `touch-action` treats pens. The Phase 4 and Phase 5 owners check it together.

## Implementation and spike S5 status

WP3 built the decision as written, in `app/src/features/page/viewport/`:

- `viewport.ts` holds the camera without layout reads on scroll or zoom, and a `ResizeObserver` keeps the viewport's rectangle. Camera listeners run at most once per animation frame during a gesture and once when it settles.
- `router.ts` routes pointers in the capture phase, by priority. A claimed pointer's events are canceled and stopped, so the compatibility mouse events never reach the blocks. Phase 4's tools are gestures (50), objects (30), and select (10).
- `gestures.ts` pans one finger after 8 px, glides after a flick for at most 400 ms (none with reduced motion), pinches around the fingers' midpoint, and pans with the barrel button or the middle mouse button. It writes scroll offsets once per frame from coalesced moves and snaps them to device pixels when a gesture ends. `holdCamera` stops all of it.

Browser tests drive the pan, the glide, the pinch, `holdCamera`, and the router's priorities with synthetic pointer events. Spike S5 itself still needs the Surface and the reference laptop: the 60 frames per second check for touch pan and pinch, the `pointercancel` check, and the long-press, selection handle, and pen marquee checks. Until it runs, this record stays Proposed, and the transform fallback isn't built.
