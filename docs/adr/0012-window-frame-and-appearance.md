# ADR 0012: Keep the native window frame for now

- Status: Accepted
- Date: 2026-09-30

## Context

SCREENS.md draws one title bar that holds the logo, breadcrumb, save status, update chip, and theme toggle, with Windows' caption buttons in a keep-out zone on the right. The first draft of this record chose an undecorated window with an HTML title bar: HTML caption buttons with Windows' metrics, a drag region, a report of the Maximize button's rectangle to Rust after every layout change, and a two-day spike for Snap Layouts. The spike's last step was a native overlay window with its own UI Automation provider.

That design costs a lot and has sharp edges:

- We would own the caption buttons, the zoom and minimum-width math (text size uses WebView2 zoom, which also scales an HTML title bar), the caption layout reports, and possibly Win32 and UI Automation code.
- Snap Layouts on Windows 11 needs the Maximize button's hit test to return `HTMAXBUTTON`. The routes to it either fail with assistive technology (a native overlay takes UI Automation hit tests from Narrator exploration, Voice Access, and Magnifier) or depend on the spike.
- The native caption buttons already work with Narrator, Voice Access, Magnifier, touch, pen, and mouse. So do Alt+Space, Win+Z, and dragging, snapping, and closing with a dialog open.

The owner has asked for this package to keep the native frame, and to skip the custom caption buttons and the Snap Layouts spike. The appearance decisions in the first draft don't depend on the frame, so they stand.

## Decision

We will keep the native window frame. The window stays decorated (`window::create` keeps `.decorations(true)`), so Windows draws the caption, the caption buttons, the system menu, and the drag area. The window remains movable, resizable, snappable, and closable with mouse, touch, pen, and keyboard, with or without a dialog open, because Windows handles all of it.

The app's title bar becomes an ordinary toolbar row below the native caption. It holds the logo, the app name, and the items features register (history arrows, breadcrumb, save status, update chip, theme toggle), and moves items into a More menu by priority as the window narrows. It has no drag region and no caption buttons, and it is never made inert under an overlay. The compact layout has no title bar, only the app bar.

The window title follows the location ("Cell structure - OpenNote", "Settings - OpenNote", "Trash - OpenNote", "Set up OpenNote"), so Alt+Tab, the taskbar, and screen readers say where the person is.

These decisions from the first draft stand. Rust reads the Windows appearance (`AppsUseLightTheme` with `WM_SETTINGCHANGE`, `SPI_GETHIGHCONTRAST`, animation effects, and the text scale factor) and we never call Tauri's `setTheme`, because `setTheme` makes `prefers-color-scheme` report the app's theme instead of Windows'. The frame follows the theme through `DWMWA_USE_IMMERSIVE_DARK_MODE` and `DWMWA_BORDER_COLOR`. Rust creates the window with the resolved `surface.app` background and a boot payload. The show strategy (early, or hidden until the first painted frame with a 700 ms fallback) is WP1's to measure and record here.

The `window.snapLayouts` flag stays off, and `caption.rs` and `window_set_caption_layout` stay as WP0 left them. Win+Z opens Snap Layouts from the keyboard, and the native Maximize button shows the flyout on Windows 11.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep the native frame, with the app's title bar below it (chosen) | Native dragging, snapping, Snap Layouts, system menu, and caption buttons that work with every input method and assistive technology; no caption code to build, test, or keep in step with zoom and display scale | Two bars stacked; the logo and name repeat what the caption shows; SCREENS.md's single bar isn't met |
| Undecorated window with HTML caption buttons and a Snap Layouts spike | Matches SCREENS.md; the whole bar is ours | The most code; the overlay path needs Win32 and UI Automation; geometry tests at the minimum width and 200% text guard a lot of new surface |
| Native frame colored with `DWMWA_CAPTION_COLOR` | Native behavior and a caption that matches the theme | Still two bars; needs a small addition to WP1's `frame.rs`; worth trying later |
| Native overlay over all three caption buttons | Snap Layouts and native minimize and close | A native window over the HTML buttons takes UI Automation hit tests, breaking Narrator exploration, Voice Access, and Magnifier |

## Consequences

- Easier: moving, snapping, and closing the window need no code and no tests of ours. Zoom can't misplace a caption button. The work on Snap Layouts and the keep-out zone tables drops out of this phase.
- Harder: the title bar row costs about 40 px of height under the native caption, which matters most at the compact and medium sizes. The compact layout drops the bar to keep its room.
- Not done in this phase: the spike and its eight pass criteria (ARCHITECTURE.md sections 10.5 and 10.6), the 200 DIP drag area, the 138 by 40 caption keep-out, and the caption layout reports. Those acceptance items apply only to a custom frame.
- Follow-up: SCREENS.md and BRAND.md should say that the title bar sits below the native caption until this record is revisited.
- Revisit when the owner wants one integrated bar, or when wry exposes WebView2's Window Controls Overlay, which would let WebView2 draw the native caption buttons over our bar without our overlay code. A later record would supersede this one and run the spike then.
