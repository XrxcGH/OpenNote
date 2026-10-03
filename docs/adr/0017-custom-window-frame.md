# ADR 0017: Custom window frame and title bar

- Status: Proposed, pending the manual checks below. The `shell.customFrame` and `window.snapLayouts` flags stay off until they pass.
- Date: 2026-09-30

## Context

SCREENS.md draws one title bar that holds the logo, breadcrumb, save status, update chip, and theme toggle, with Windows' caption buttons in a 138 × 40 keep-out zone on the right. Phase 2 kept the native frame and put the app's bar below it, to ship without the caption code ([ADR 0012](0012-window-frame-and-appearance.md)). The owner has asked for the custom title bar back as Phase 13 polish. The design is section 10 of the Phase 2 architecture (ARCHITECTURE.md): an undecorated window, HTML caption buttons, and a staged spike for Snap Layouts.

Windows 11 shows the Snap Layouts flyout when the Maximize button's hit test returns `HTMAXBUTTON`. The WebView2 window covers the client area, so the main window never sees a hit test over an HTML button. Narrator, Voice Access, and Magnifier must still find and invoke all three caption buttons.

Once accepted, this record supersedes the decision in ADR 0012 to keep the native frame. Until then the flags stay off and ADR 0012 stands. (This record was drafted as a second ADR 0012 and took the next free number when the two met, as the [README](README.md#numbering) says.)

## Decision

We will draw the title bar and caption buttons in HTML behind the `shell.customFrame` flag. The page decides the frame: its first caption layout report makes the window undecorated, and a `null` report brings the native frame back.

- **Caption buttons.** `app/src/shell/frame/CaptionButtons.tsx` draws Minimize, Maximize (Restore while maximized), and Close. They use Windows' names and metrics, 46 device-independent pixels (DIPs) wide at every text size, and sit outside the tab order. They report the Maximize button's rectangle in physical pixels after every layout, zoom, DPI, and maximize change.
- **Drag area.** CSS `app-region: drag` gives the real caption through WebView2's non-client region support. `DragRegion` is a gap of at least 200 DIPs, and the bar's padding and gaps drag too. The bar's items stay page content, for the reason under the findings.
- **Snap Layouts.** Behind `window.snapLayouts`, a native child window sits over the reported Maximize rectangle (`window/snap_overlay`). It answers `HTMAXBUTTON`, and its own UI Automation provider exposes it as a Button with the Invoke pattern. The button is named Restore while the window is maximized and Maximize otherwise. The HTML Maximize button is then hidden from assistive technology and draws the overlay's hover and pressed state. This is the second approach in section 10.5.
- **System menu.** `window_show_system_menu` opens the real menu with `GetSystemMenu` and `TrackPopupMenu`, for Alt+Space, and right-clicking the overlay opens it too.
- **Tauri's resize border.** A subclass keeps Tauri's resize border window to the top edge and hides it from UI Automation (`window/resize_border.rs`).

Minimize and Close stay HTML only. No Windows feature depends on `HTMINBUTTON` or `HTCLOSE`. Covering them with native windows would move their hover, tooltips, and UI Automation out of WebView2 for no gain.

## What the spike measured

Windows 11 Pro build 26200 on a Surface Laptop Studio 2 at 150% scaling, WebView2 Runtime 154, a debug build with both flags turned on locally. The checks used only the app's own window: window messages sent to it, UI Automation queries from another process, and the page's DevTools protocol.

| Criterion (section 10.6) | Result |
|---|---|
| 1. Drag, double-click, snap, and system menu on the drag area | Hit tests pass: WebView2 answers `HTCAPTION` over the drag gap and the bar's padding, and `HTCLIENT` over the items. The system menu command opens the real menu below the title bar with the right items grayed, and Escape closes it. The gestures themselves need a person. |
| 2. Resizing from every edge, including above the title bar | The top strip answers `HTTOP`, over Maximize too. It shrinks to nothing while maximized, so the top edge belongs to the caption buttons. The other edges are Windows' own borders outside the client area. Dragging them needs a person. |
| 3. Moving and closing with a dialog open | Not run. Dialogs must leave the caption buttons and the drag area outside `inert`. |
| 4. Snap Layouts on hover, with mouse and pen | The overlay answers `HTMAXBUTTON`, and `WindowFromPoint` over Maximize finds it. Seeing the flyout needs a person, because checking it would move the pointer. |
| 5. Narrator | The tree has exactly one Minimize, one Maximize or Restore, and one Close, each with Invoke. A UI Automation hit test at each button's center finds that button. Invoking them minimizes, maximizes, restores, and closes through the exit handshake. Speech and scan mode need a person. |
| 6. Voice Access | The names and Invoke patterns it uses are in place. The spoken commands need a person. |
| 7. Magnifier | Needs a person. |
| 8. The overlay stays aligned | After maximize and restore, both cover the same pixels as the HTML button. After a WebView2 zoom change to 200%, the page reported again and the overlay followed. A move between monitors with different scaling needs a second monitor. |

Findings that changed the design:

- WebView2's `MINIMIZE`, `MAXIMIZE`, and `CLOSE` region kinds exist only for visual hosting, through `ICoreWebView2CompositionController4`. Wry hosts WebView2 in a window, so the first approach in section 10.5 doesn't apply.
- Tauri's resize border window covers the whole client area and relies on a window region, which UI Automation hit tests ignore. Before the fix, Narrator's mouse and touch exploration found a nameless pane over the entire page.
- WebView2 hides a drag area's content from UI Automation hit tests: over the app name inside one, the hit test found an unnamed pane. So all the bar's items are `no-drag`, including its text, and section 10.1's "text counts toward the drag area" doesn't hold.
- Tauri may call two listeners for the same event in either order. The page's copy of the maximized state could lag, so the buttons keep each event's payload instead.

## Options considered

| Option | For | Against |
|---|---|---|
| HTML caption buttons, with a native overlay over Maximize only (chosen) | One title bar as SCREENS.md draws it; Snap Layouts; Minimize and Close stay WebView2 content | Win32 and UI Automation code of our own; Tauri's resize border needed a fix |
| Native overlays over all three buttons, answering `HTMINBUTTON`, `HTMAXBUTTON`, and `HTCLOSE` | One mechanism for all three | Three providers, and hover and tooltips for all three come from Rust, for no Windows feature |
| No overlay, relying on Win+Z | No native code beyond the frame | No flyout on hover |
| Keep the native frame (Phase 2) | Everything native, no code | Two stacked bars |

## Consequences

- Easier: one title bar in both themes and in contrast themes, with native snapping and a real system menu.
- Harder: we own the caption buttons, the layout reports, the overlay, and its provider. Component tests cover the geometry at 200% text and with touch density, the reports, the hidden Maximize, and which parts of the bar drag. Rust tests drive the overlay and the resize border in real, hidden windows.
- Wired in Phase 13, behind `shell.customFrame` (off by default in every channel):
  - The title bar (`app/src/shell/titlebar/TitleBar.tsx`) spreads `titleBarDragProps`, puts `DragRegion` in place of its spacer, and ends with `CaptionButtons`, flush with the top and end edges. The compact layout gets a thin bar with only those two above the app bar, and setup keeps the logo and name with the drag area and buttons. With the flag off, none of it renders, and the bar is the ordinary row it was.
  - `--zoom` is already set on the root from the effective zoom (`app/src/theme/appearance.ts`), so the buttons and the drag area keep their sizes at every text size.
  - Rust creates the window undecorated when the boot payload's channel and flag overrides, then the experimental flags in settings, turn the flag on (`custom_frame::at_start`). The flag counts only in development and nightly builds, as in the interface. The page's first caption layout report still decides the frame, and a `null` report restores the native one.
  - `frame::show_system_menu` of the Phase 2 shell is gone: `system_menu::show` replaces it, with the same command and the validation and the default anchor under the title bar.
- Manual checks before turning the flags on, at 100%, 150%, and 200% scaling:
  - Drag, double-click, snap to each edge, right-click the drag area, and Alt+Space.
  - Resize from every edge and corner, including the top edge above the title bar and above Maximize.
  - With a dialog open, drag, minimize, maximize, and close with the mouse.
  - The Snap Layouts flyout with mouse and pen hover over Maximize.
  - Narrator with the keyboard (scan mode), mouse exploration, and touch exploration of all three buttons.
  - Voice Access: "click Minimize", "click Maximize", "click Restore", and "click Close".
  - Magnifier with mouse tracking over the caption buttons.
  - Moving between two monitors with different scaling, and a density change.
- Revisit when wry exposes WebView2's Window Controls Overlay, which would draw native caption buttons and remove the overlay.
