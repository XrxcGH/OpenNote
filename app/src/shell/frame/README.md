# Window frame

The custom title bar's parts: the caption buttons, the drag area, and the report that tells Rust where the Maximize button is. They draw the window's caption when the `shell.customFrame` flag is on, and render nothing when it is off. The decision is [ADR 0017](../../../../docs/adr/0017-custom-window-frame.md).

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [How the title bar uses it](#how-the-title-bar-uses-it)
- [The Rust side](#the-rust-side)
- [Turning the flag on](#turning-the-flag-on)
- [Tests](#tests)

## What it does

With the flag on, the window has no native frame, and the page draws the caption.

- `CaptionButtons` draws Minimize, Maximize, and Close. Maximize becomes Restore while the window is maximized. The buttons have the sizes Windows uses.
- `DragRegion` is the gap that WebView2 treats as the window caption, through the CSS rule `app-region: drag`. Dragging, snapping, double-clicking, and right-clicking all work without script.
- The buttons report where Maximize is, in physical pixels. They report after every change to the layout, zoom, scale, or maximized state.
- Rust keeps a native overlay on that rectangle, so Windows 11 shows the Snap Layouts flyout. That part is behind a second flag, `window.snapLayouts`.

With the flag off, the buttons render nothing, and they report no caption layout. The window then keeps its native frame.

## Public API

| Name | Kind | Use |
|---|---|---|
| `CaptionButtons` | component | The three buttons, last in the title bar. They are outside the tab order, like native ones. |
| `DragRegion` | component | The gap before the buttons, at least 200 DIPs wide at every text size. |
| `titleBarDragProps(customFrame)` | function | Spread on the bar, so its padding and gaps drag too. Its items stay page content. |
| `useCustomFrame()`, `useSnapLayoutsOverlay()` | hooks | The two flags. |
| `frameWindow()` | function | The window client the commands were given at start-up. |
| `captionLayout(rect, ratio, labels, snapLayouts)` | function | The report sent to Rust. |

## How the title bar uses it

`app/src/shell/titlebar/TitleBar.tsx` does the wiring, behind the flag:

- The full bar spreads `titleBarDragProps`, puts `DragRegion` in place of its spacer, and ends with `CaptionButtons`.
- Setup keeps the logo and name, then the drag area and the buttons.
- The compact layout gets a thin bar of only the drag area and the buttons, above the app bar.
- The fit logic counts the buttons as part of the bar, so items move into More before the buttons would be clipped.

## The Rust side

`app/src-tauri/src/window` holds the other half. Its parts are:

- `custom_frame`: the flag, and switching the frame.
- `caption`: the layout report and its checks.
- `snap_overlay`: the native overlay and its UI Automation provider.
- `resize_border`: Tauri's resize border, kept safe for assistive technology.
- `system_menu`: the real system menu, for Alt+Space.
- `subclass`: maximize and DPI changes.

`custom_frame::at_start` reads the boot payload's channel and flag overrides, then the experimental flags in settings. The window therefore opens with the frame that the page will ask for.

## Turning the flag on

Both flags are off in every channel. Development and nightly builds can turn them on with `OPENNOTE_FLAGS=shell.customFrame=1,window.snapLayouts=1`, or in Settings under About. The manual checks in ADR 0017 must pass at 100%, 150%, and 200% scaling before any release channel enables them.

## Tests

`CaptionButtons.test.tsx`, `DragRegion.test.tsx`, and `captionLayout.test.ts` cover the parts. `TitleBar.test.tsx` covers the wiring. The Rust tests open real, hidden windows to check the overlay, the resize border, and the drag area.
