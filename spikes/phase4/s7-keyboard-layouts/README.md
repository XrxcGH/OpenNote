# Spike S7: keyboard layouts and AltGr

Windows reports AltGr as Ctrl and Alt both down. On European keyboards, a Ctrl+Alt shortcut can then take a
character that the layout types with AltGr. The dispatcher has two rules for this:

1. **AltGr text wins.** While AltGraph is on, a Ctrl+Alt chord matches only when the typed key is the chord's own key.
2. **An exact key beats a physical key.** A match by the typed key wins over a match by the physical code.

## The fixtures

`app/src/commands/fixtures/layouts.ts` holds key presses as WebView2 reports them on the US, Polish (Programmers),
German, and French (AZERTY) layouts. `app/src/features/page/formattingBar/layouts.test.ts` replays each one through
the dispatcher in a text box, with every Phase 4 command registered.

The values come from the layouts' published key tables. To record them on a real keyboard, open `record.html` in
Edge, switch Windows to the layout, and press the keys. The page lists each press in the fixture format, ready to
paste.

## Manual checks

Run these in the app with each layout installed. Check the box when the text box shows the character, and no
command runs.

- [ ] Polish (Programmers): AltGr+C types "ć", AltGr+A types "ą", and AltGr+L types "ł".
- [ ] Polish (Programmers): AltGr+Shift+S types "Ś", not strikethrough.
- [ ] German: AltGr+2 types "²", and AltGr+3 types "³", not Heading 2 or 3.
- [ ] German: AltGr+Q types "@", and AltGr+E types "€".
- [ ] German: Ctrl+Shift+7 opens the shortcut list, not a numbered list.
- [ ] French (AZERTY): AltGr+E types "€", and AltGr+é starts a tilde.
- [ ] French (AZERTY): Ctrl+B still makes text bold.
- [ ] Every layout: Heading 2 and 3 stay in the Styles menu, the slash menu, the palette, and "## " when their keys are lost.
