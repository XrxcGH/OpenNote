# Table formatting and number formats

This page covers how a table cell looks. For formulas see [Tables and charts](tables-and-charts.md) and the [function reference](table-functions.md).

## Format a cell

With a table current, a second row of tools sits under the table tools. It sets the font, size, bold, italic, underline, and strikethrough, the text and fill colors, borders, alignment, wrapping, rotation, and the number format. Select whole cells and a tool formats the cells. Select text inside one cell and the tool formats only that text. Each change is one undo step.

Press Ctrl+K and type "Cell:" to find every format by name.

## Number formats

Pick a ready-made format (number, currency, percent, date, time, fraction, scientific, text) or type your own code. A code has up to four sections, separated by semicolons: positive, negative, zero, and text.

- `0` shows a digit or a zero. `#` shows a digit only when there is one. `?` pads with a space.
- A comma between digit marks groups thousands. A comma after the last digit scales by a thousand.
- `%` multiplies by 100. `E+00` writes scientific form.
- `# ?/?` writes a fraction. A fixed denominator such as `?/16` is allowed.
- `yyyy`, `mm`, `dd`, `hh`, `ss`, and `AM/PM` write dates and times. `[h]`, `[m]`, and `[s]` count total hours, minutes, and seconds.
- `[Red]` and the other color names color the text. `[>100]` starts a section with a condition.
- Quoted text and a backslash write text as it is. `@` stands for the cell's own text.
- `[$-409]` and similar tags set the region of a date or currency.

Numbers keep 15 significant digits, then round half away from zero. A code that cannot be read shows the value as General. A number too wide for its cell shows `#` marks.

The decimal mark, the group separator, month and day names, and the AM and PM text follow your region. Typed codes use your region's marks, and the file stores them in the standard form.

## Formula bar

The formula bar sits under the cell format bar. It shows the formula or value of the selected cell. Edit it there, then press Enter.

## Other formats

- A column can have a unit, such as kN or mm. See [Engineering tools](engineering-tools.md#units-in-tables).
- A column can pick from a list of choices. See [Tables and charts](tables-and-charts.md#choices).
- Rules can color cells by their values. See [Tables and charts](tables-and-charts.md#conditional-formatting).
