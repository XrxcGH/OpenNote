# OpenNote brand and interface guide

This guide defines how OpenNote looks, moves, sounds, and behaves. The [screen wireframes](design/SCREENS.md) show each major screen. The exact values live in [`brand/tokens.json`](../brand/tokens.json), and CHECKS verifies them (contrast, motion limits, theme parity). UI code must use the tokens, never raw values.

## Contents

1. [Personality](#1-personality)
2. [Design principles](#2-design-principles)
3. [Voice and tone](#3-voice-and-tone)
4. [Color](#4-color)
5. [Typography](#5-typography)
6. [Space, size, and layout](#6-space-size-and-layout)
7. [Shape and depth](#7-shape-and-depth)
8. [Icons, logo, and illustration](#8-icons-logo-and-illustration)
9. [Motion](#9-motion)
10. [Comfort and performance budgets](#10-comfort-and-performance-budgets)
11. [Components](#11-components)
12. [Accessibility](#12-accessibility)
13. [What to avoid](#13-what-to-avoid)
14. [Using the tokens](#14-using-the-tokens)

## 1. Personality

OpenNote should feel like a good desk by a window: warm paper, a pen that writes well, and nothing shouting for attention.

By day, soft light falls across the desk; in the evening a candle is lit and the window fills with dusk and stars. A few small drawings and warm accents carry that feeling, and they always sit beside the work, never on it.

People spend hours in a note app, often while listening to a lecture or a meeting. The interface stays calm and gets out of the way.

| We are | We are not |
|---|---|
| Warm, like paper and wood | Cold, like a terminal or a trading screen |
| Quiet and steady | Flashy, bouncy, or loud |
| Clear and plain-spoken | Clever, cute, or full of jargon |
| Trustworthy with your data | Pushy about accounts, upgrades, or AI |
| Fast and responsive | Decorated at the cost of speed |

## 2. Design principles

1. **The page is the hero.** Notes sit on the brightest surface. Tools and menus use quieter tones around it.
2. **Comfort over novelty.** Soft contrast for surfaces, strong contrast for text. No effect ships if it costs smoothness.
3. **One gesture, one result.** Pen draws, finger scrolls (by default), and a tap never does something hidden.
4. **Familiar first.** People switching from OneNote should find notebooks, sections, pages, and pens where they expect them.
5. **Respect attention.** No badges, streaks, confetti, or nagging. Notifications only for things the person asked for.
6. **Every screen, every input.** Each feature works with mouse, keyboard, touch, and pen, from a phone to a wide monitor.

## 3. Voice and tone

Write the way a helpful colleague talks: short, plain, and calm. Use American English and sentence case everywhere, including buttons and menus.

| Situation | Do | Don't |
|---|---|---|
| Button | Save page | Save Page! / Submit |
| Empty state | No pages yet. Press Ctrl+N or tap + to start one. | Whoa, it's empty in here! |
| Error | Couldn't sync "Biology". You're offline, so changes are saved on this device and will sync later. | Oops! Something went wrong. |
| Confirmation | Delete 3 pages? You can restore them from Trash for 30 days. | Are you sure? |
| AI feature | Summarize this page (runs on this device) | "Unleash the magic of AI" |

Rules of thumb:

- Lead with the verb on buttons and menu items.
- Say what happened, why (if known), and what to do next. Never blame the person.
- No exclamation marks, no "Oops", no emoji in interface text.
- Numbers as digits ("3 pages"), times as "2:05 PM", dates as "Sep 30, 2026".
- The CHECKS rules for spelling, AI phrasing, and redundancy apply to interface text too.

## 4. Color

The palette is warm paper, walnut ink, moss, and clay, with candlelight, dusk and night-sky tones for ambience. It deliberately avoids the light-blue-on-black look of developer tools. Every pairing below is checked by CHECKS: body text reaches at least 7:1 contrast and secondary text at least 4.5:1.

### Surfaces and text

| Token | Light (Daylight) | Dark (Evening) | Use |
|---|---|---|---|
| `surface.page` | `#FFFCF6` paper | `#24201C` | The note page, the brightest (light) or most readable (dark) area |
| `surface.app` | `#F3EEE6` oat | `#1C1916` walnut | Window background, sidebars, toolbars |
| `surface.raised` | `#FFFDF9` | `#2C2722` | Menus, dialogs, popovers |
| `surface.sunken` | `#EAE3D8` | `#171411` | Text fields, wells, the canvas behind paginated pages |
| `surface.hover` | `#ECE5DA` | `#332C26` | Hovered rows and buttons |
| `surface.selected` | `#DDE8DA` | `#2E3B30` | Selected page, section, or tool |
| `text.primary` | `#2B2521` walnut ink | `#F0E9DE` | Body text and headings |
| `text.secondary` | `#5C534A` | `#CFC5B7` | Labels, metadata |
| `text.muted` | `#6B6054` | `#ABA093` | Placeholders, timestamps |
| `border.subtle` | `#E3DACC` | `#3A322B` | Dividers, paper rules |
| `border.control` | `#877B6C` | `#8D8174` | Input and checkbox outlines (3:1 or more) |

### Accents and status

| Token | Light | Dark | Use |
|---|---|---|---|
| `accent.primary` | `#3B6A4D` moss | `#8FC29D` | Primary buttons, links, active tool |
| `accent.primarySubtle` | `#E2ECE1` | `#2E3B30` | Selected backgrounds, toggles |
| `accent.clay` | `#A9502F` clay | `#E59372` | Secondary highlights, the logo's pen tip |
| `focus.ring` | `#A9502F` | `#E7BA62` | Keyboard focus outline |
| `status.danger` / `recording` | `#A8342A` | `#F2907F` | Destructive actions, the recording dot |
| `status.warning` | `#855B0C` | `#E7BA62` | Warnings |
| `status.success` | `#35704A` | `#8FC29D` | Saved, synced |
| `selection.highlight` | `#F4DE93` honey | `#52451F` | Selected text |

### Warm accents and ambient light

Three small accent families and one ambient group give the shell its warmth. Each color has one job, so the extra color doesn't turn into noise:

| Token | Light | Dark | Use |
|---|---|---|---|
| `accent.candle` | `#9A5410` | `#F0A860` | The sun icon, a candle flame, lamplight |
| `accent.candleSubtle` | `#F8EBD3` | `#3A2C1C` | Candle glow and illustration fills |
| `accent.dusk` | `#9C4559` | `#EBA0B2` | Sunset line art, dusk accents |
| `accent.duskSubtle` | `#F6E4E4` | `#3A2A30` | Sunset band fill |
| `accent.night` | `#4A5590` | `#A9B4EC` | The moon icon, night line art |
| `accent.nightSubtle` | `#E8EAF3` | `#1F2233` | Night window pane fill |
| `ambient.canvasTop` | `#FFF4DF` window light | `#1D1F2C` night sky | Top of the desk canvas behind the page and the setup backdrop |
| `ambient.canvasBottom` | `#EAE3D8` (the sunken color) | `#2E2430` dusk horizon | Bottom of the same gradient |
| `ambient.spark` | `#F2CF8A` sun disc | `#E7D9B0` starlight | The sun disc and stars only, never text |

Candle, dusk, and night are never status colors and never fill a button, so candle can't be mistaken for `status.warning`. They also never stand alone as a signal.

The ambient washes stay quiet: CHECKS holds `ambient.canvasTop` and `ambient.canvasBottom` to at most 1.3:1 against `surface.sunken` (a `max` ceiling on a contrast pair), and they only ever show around the page card, never behind text. Under Windows contrast themes the accents become the system text color, and the fills and ambient tokens become the system canvas, so the gradients flatten and the stars disappear.

### Ink colors

Ink is content, not interface, so it has its own palette. Each pen has a light and a dark value, and notes store the pen name. That way handwriting stays readable when the theme changes. The default pens are Ink, Indigo, Brick, Fern, Plum, Amber and Walnut, and each is at least 4.2:1 against the page in both themes. Highlighters (Honey, Mint, Rose, Apricot, Lilac) are 40% transparent and draw behind ink. Custom colors are allowed; in dark mode the app lightens them until they reach 3:1.

Color is never the only signal. Pens show their name on hover and in screen reader labels, and status always pairs color with an icon or text.

### Dark mode setting

Dark mode is a setting people can switch at any moment, not something hidden in a menu. The app offers three choices:

| Choice | What it does |
|---|---|
| Light | Always uses the Daylight theme |
| Dark | Always uses the Evening theme |
| Match Windows | Follows the Windows light or dark setting, and switches when Windows does |

Ways to switch, all with the same result:

- A sun and moon toggle in the title bar, always one click, or tap away. It switches between Light and Dark. A long press, a right-click, Shift+F10, or the Menu key opens all three choices and a link to Settings.
- The shortcut Ctrl+Shift+D, which people can change in settings.
- "Toggle dark mode" in the command palette (Ctrl+K).
- Settings, then Appearance, which shows all three choices with small previews.

First-time setup asks once. The "Choose your look" step shows Light, Dark and Match Windows as three preview cards, and the whole screen changes as the person picks one. Match Windows is selected in advance, with a caption that names the Windows setting, such as "Preselected because Windows is set to Light." The screen already matches Windows. Pressing Continue keeps what they already use. The choice is stored before the first page ever opens.

The preference belongs to the person, not the device. If they later turn on an account for sync, the setup asks whether to keep this device's choice or use the one saved in their account. After that, each device can override it.

Rules for the switch:

- The saved theme is applied before the window first appears, so the app never flashes the wrong colors at start-up.
- Switching crossfades every surface over 200 ms (the `base` token), or 100 ms with reduced motion. Content, scroll position, and selection stay exactly where they were.
- Notes don't change. Ink uses each pen's light or dark value, and pasted images keep their colors.
- A separate "Page color" setting lets people keep paper-white pages inside the dark interface, for reading or printing previews. It defaults to matching the theme.
- A theme change applies at most once every 350 ms, and the latest choice wins, so a held key or a repeated shortcut can't flash the screen.
- Windows contrast themes always take priority over this setting. The toggle then stays focusable but disabled, and says why. The choice is kept, and applies again when the contrast theme is off.

## 5. Typography

| Role | Font | Why |
|---|---|---|
| Interface and default note text | Atkinson Hyperlegible Next | Designed by the Braille Institute for legibility; distinct letter shapes (I, l, 1) help everyone, including low-vision readers |
| Optional reading font for notes | Literata | A warm serif built for long reading on screens |
| Code and monospace | Atkinson Hyperlegible Mono | Matches the interface font |
| Fallbacks on Windows | Segoe UI Variable, Cambria, Cascadia Code | System fonts if a bundled font fails to load |

All fonts use the Open Font License (OFL) and ship inside the app, so the app never downloads fonts at run time.

Type scale (pixels at 100% scaling):

| Token | Size / line height | Use |
|---|---|---|
| `caption` | 12 / 16 | Timestamps, badges |
| `small` | 13 / 18 | Secondary labels |
| `body` | 15 / 22 | Interface text |
| `note` | 16 / 26 | Default note text |
| `subtitle` | 17 / 24 | Panel titles |
| `title3` / `title2` / `title1` | 20 / 28, 24 / 32, 30 / 38 | Note headings |
| `display` | 36 / 44 | Onboarding only |

Keep lines of reading text at 72 characters or fewer. Use weights 400, 500, 600, and 700 only. Sizes follow the Windows text-size setting and the in-app zoom.

## 6. Space, size, and layout

Spacing uses a 4-pixel grid: 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, and 64. Use 8 inside controls, 12 to 16 between related items, and 24 or more between groups.

Targets must be easy to hit:

| Input | Minimum target | Toolbar height |
|---|---|---|
| Mouse or trackpad | 32 × 32 (never below 24) | 44 |
| Touch or pen | 44 × 44 | 56 |

The layout adapts to the window width, not the device type:

| Size class | Width | Layout |
|---|---|---|
| Compact | under 600 | One pane at a time. Bottom toolbar. Freeform pages open in a single-column reading view, with a button to switch to the full canvas. |
| Medium | 600 to 839 | Page list and page side by side. Notebooks in a slide-over drawer. |
| Expanded | 840 to 1,199 | Notebook sidebar (272) and page. The page list opens as an overlay. |
| Wide | 1,200 and up | Three panes: notebooks (272), pages (300), page (at least 480). |

Button and row sizes follow the pointer by default. A touch or pen tap switches to the touch sizes, and a mouse click switches back, never in the middle of a gesture. People who want large targets with a mouse can choose Large in Settings, then Appearance. "Interface size" scales the sidebars, toolbars, and menus from 90% to 150% without changing the page zoom. The title bar is 40 tall, or 48 with touch sizes, and the Windows buttons are 46 wide.

Panes resize by dragging, and collapse with a button or keyboard shortcut. Paginated pages sit centered on `surface.sunken` with a soft shadow, like paper on a desk.

## 7. Shape and depth

Corners are gently rounded: 4 for small elements, 8 for buttons and inputs, 12 for cards, and panels, 16 for dialogs. Pills use a full radius.

Depth comes from warm, soft shadows in three steps (`elevation.1` to `elevation.3`), never from glowing edges. Menus use step 2, dialogs step 3. Dark theme relies on lighter surfaces rather than shadows. Blur and frosted-glass effects are not used because they cost battery and frame time. Glows are drawn as flat radial gradients, never blur.

## 8. Icons, logo, and illustration

Icons come from Phosphor Icons (MIT license) in the Regular weight at 20 pixels, switching to Fill for an active toggle. Custom icons, such as the pen tools, follow the same 1.5-pixel line style. Menu items pair icons with text; icon-only buttons always have a tooltip with the name and shortcut.

The logo is a folded page with a moss-green ink stroke ending in a clay pen tip: see [`brand/logo-mark.svg`](../brand/logo-mark.svg) and [`brand/app-icon.svg`](../brand/app-icon.svg). Keep clear space of half the mark's width around it, and don't recolor, stretch or add effects.

Illustrations appear in onboarding, empty states, error screens, the theme previews, Settings > About and the notebooks pane footer. A pane or card has at most one, and none is larger than 240 by 150 pixels. The motif set is a window, a plant and vine, a candle, books, a sunset, and stars with a moon.

- They are inline SVG in the 1.5-pixel line style, drawn with a slight wobble so they look handwritten, using only token colors with at most three fills.
- Each is under 3 KB, hidden from screen readers, and never sits behind text.
- Things in a drawing obey gravity. Books, pots, the notebook, and the candle stand on their shelf, desk, or sill line. None sinks into its line or floats above it. A leaning book stands on its lower corner and rests against its neighbor. The component tests check both.
- Nothing crowds another shape, such as a star against a leaf or the sun against a window bar.
- A drawing set above left-aligned text is cropped to its content, so its shelf starts where the text starts.
- The page canvas carries window light in Daylight and a dusk-to-stars sky in Evening, around the page card, and never behind the writing.

No 3D renders, gradient blobs, stock photos, or mascots.

## 9. Motion

Motion explains what changed and where things went. It is quick, calm, and never bouncy. It only animates opacity and transform, which the graphics card handles without slowing the page.

| Interaction | Duration token | Easing | What moves |
|---|---|---|---|
| Hover, press | `quick` 100 ms | standard | Background color; press scales to 0.98 |
| Menu, tooltip open | `fast` 150 ms | enter | Fade in and rise 4 pixels |
| Menu, tooltip close | `quick` 100 ms | exit | Fade out |
| Switch page | `base` 200 ms | standard | Crossfade with a 6-pixel rise |
| Sidebar collapse or expand | `gentle` 250 ms | standard | Slide, then the page settles without reflowing mid-animation |
| Infinite ↔ paginated view | `slow` 320 ms | standard | Page edges and shadows fade in; content stays put under the pointer |
| Dialog open | `slow` 320 ms | enter | Fade in and scale from 0.97 |
| Toast | `gentle` 250 ms | enter | Rise 12 pixels; stays until dismissed if it has an action |
| Drag and drop | direct, then spring | spring | Item lifts to `elevation.2`, follows the pointer exactly, settles without overshoot |
| Zoom and pan | direct | none | Follows fingers or wheel exactly; a short glide after a flick |

Hard rules:

- Ink is never animated. A stroke appears under the pen in the same frame.
- Nothing is slower than 400 ms. CHECKS enforces this in tokens and UI code.
- Animations never block input. Clicking during a transition acts at once. The one exception is the theme crossfade: for its 200 ms, clicks don't reach the page, though keyboard shortcuts still work.
- Loading shows nothing for the first 300 ms, then a quiet progress bar. Skeleton screens don't shimmer.
- The recording dot pulses slowly (2-second cycle). It is the only looping animation.
- Illustrations fade in once over `fast` and never loop. Candles don't flicker and stars don't twinkle.

When Windows "Animation effects" is off, or the operating system asks for reduced motion, movement becomes a 100 ms crossfade and the recording dot stops pulsing.

## 10. Comfort and performance budgets

Smoothness is part of the brand. A feature that breaks these budgets on the reference laptop doesn't ship. The reference laptop has 4 cores, 8 GB of memory, integrated graphics, and a 1080p screen at 125% scaling on Windows 11.

| Measure | Budget |
|---|---|
| Pen to screen | Stroke drawn in the next frame; 25 ms or less end to end on a 60 Hz screen |
| Typing | A key press shows within 16 ms |
| Feedback | Any tap, click, or key shows a visible response within 50 ms |
| Frame rate | 60 frames per second (120 on fast screens) for scrolling, zooming and animation; never two dropped frames in a row |
| Page open | 150 ms for a typical page (500 blocks, 5,000 strokes); 500 ms for very large pages |
| Search | Results update within 100 ms while typing, across 10,000 pages |
| Start-up | Window within 1 second, last page ready within 2 seconds |
| Memory | Under 400 MB with a 1,000-page notebook open |
| Crash safety | At most 1 second of work lost if the app or computer stops suddenly |

Heavy work, such as handwriting recognition, transcription, search indexing, export, and sync, runs in the background, and never blocks drawing or typing. The [testing strategy](DEVELOPMENT.md#6-testing-strategy) explains how each budget is tested.

## 11. Components

| Component | Key rules |
|---|---|
| Buttons | Primary (moss fill), secondary (outline), quiet (text only), danger (clay-red text; fill only in confirmations). One primary button per view. |
| Text fields | `surface.sunken` fill, `border.control` outline, label above, help, or error text below. |
| Command bar | Slim bar with Home, Insert, Draw, and View tabs, familiar to OneNote users. It collapses into a "More" menu when narrow. |
| Pen palette | Floating, draggable, and collapsible. It shows the active pen, color, and width. Left-handed mode mirrors it. |
| Navigation tree | Notebooks, sections, and pages with color chips. Drag to reorder. Full keyboard support with arrow keys. |
| Page canvas | Paper backgrounds (plain, lined, dot grid, graph, Cornell) drawn with `border.subtle`. Page breaks are dashed lines with the page number in `text.muted`. |
| Recording bar | Pinned above the page, with a pulsing dot, elapsed time, and pause and stop buttons. Timestamps link to ink and text. |
| Theme toggle | Sun and moon icon in the title bar with the tooltip "Dark mode (Ctrl+Shift+D)". Shows the current state and exposes it to screen readers as a switch, with a hidden description of how to reach Light, Dark, and Match Windows. |
| Theme cards | Three cards in a radio group named "Theme", each with a small live preview that screen readers and Tab skip. Holding an arrow key moves one step. |
| Empty states | One small drawing above one plain sentence, on a page card. The sentence carries the meaning; the drawing is only company. |
| Ambient canvas | The desk behind the page card: window light in Daylight, a dusk sky with a few stars in Evening. Static, painted once, and kept within 1.3:1 of `surface.sunken`. Flat under Windows contrast themes. |
| Sync status | A small icon with a text tooltip in the title bar: saved, syncing, offline, or needs attention. Never a blocking dialog. |
| Dialogs | Title, one-sentence explanation, then actions (primary on the right). Escape closes. Focus returns to where it was. |
| Update notice | A small "Update ready" chip in the title bar, with release notes on hover or tap. "Restart to update" applies it; otherwise it applies the next time the app closes. Never a pop-up, never mid-task. |
| Toasts | Bottom center, one at a time, with an Undo action for destructive changes. |
| Command palette | Ctrl+K opens a searchable list of every command, with shortcuts. |

## 12. Accessibility

OpenNote meets the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA (the level most accessibility laws require). Body text goes further and meets the AAA (highest level) contrast of 7:1.

- **Keyboard:** everything works without a mouse. Focus is always visible (a 2-pixel `focus.ring` with a 2-pixel gap). Tab order follows reading order. Shortcuts are listed with Ctrl+/ and can be changed.
- **Screen readers:** every control has a name, role, and state for Narrator and NVDA (a free screen reader). Ink regions are announced with their recognized text. Recording and sync changes are announced politely.
- **Vision:** text scales to 200% without losing content. Windows contrast themes switch the app to system colors. Color is never the only signal.
- **Motion:** the app follows the reduced-motion setting (see Motion).
- **Hearing:** recordings can be transcribed on the device, and transcripts sync to the notes.
- **Motor:** targets meet the sizes in section 6. Left-handed mode is available. No action needs a timed or multi-finger gesture.
- **Reading:** settings for letter spacing, line spacing and a dyslexia-friendly font. Plain language throughout.

Every pull request that changes UI goes through automated accessibility tests and the keyboard checklist in the [testing strategy](DEVELOPMENT.md#6-testing-strategy).

## 13. What to avoid

- Light blue on black, neon accents, and "hacker" dark themes.
- Pure black (`#000000`) or pure white (`#FFFFFF`) as large surfaces. CHECKS warns about both.
- Purple-to-blue gradients, glowing edges, glassmorphism, and heavy blur.
- Bouncy or elastic easing, parallax, auto-playing media, and confetti.
- Spinners that appear instantly, skeleton shimmer and fake progress.
- Icon-only toolbars without tooltips; gray text that fails contrast.
- Wallpapers, textures, or decoration behind text or the writing surface; twinkling, flickering, or drifting decoration; illustrations in menus, dialogs, or toasts.
- Dark patterns: pre-checked upsells, hidden "No thanks" links, nagging sign-in prompts.
- AI features that start on their own or send data without saying so.

## 14. Using the tokens

1. `brand/tokens.json` is the only place colors, fonts, sizes, and motion values are defined.
2. The app build turns it into CSS custom properties (for example `--color-surface-page`) and a typed TypeScript module. Theme switching swaps the property set without reloading.
3. UI code refers to tokens only. The CHECKS `brand-consistency` rule rejects raw colors, font names, durations over 400 ms, and hard-coded layers in `app/src`.
4. To change the look, edit the tokens, and run `npm run checks`. The `brand-tokens` rule confirms both themes still define every token and meet every contrast target.
