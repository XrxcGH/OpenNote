# Tables and charts

A smart table holds typed columns, formulas, and several views of the same rows. A chart reads its numbers from a table.

![A smart table with a formula cell, and the bar chart made from it](../screens/table-chart-light.png)

## Make a table

- Open Insert, then Smart table.
- Format a column as number, currency, percent, date, or text. Sort and filter the rows, and use Board to group rows by any column of repeating text (the stand-in for a choice column).
- Draw a grid with the pen and it becomes a table.
- Import an Excel file and each sheet becomes a table page.
- Give a number column a unit, such as kN or mm, and cells in other units of the same kind convert to it. See [Engineering tools](engineering-tools.md#units-in-tables).

## Formulas

Add a calculated column and type a formula, such as `=Price * Qty`. The column fills in for every row and stays up to date as you edit.

## Views

A table can show its rows as a board, a calendar, a gallery, or a timeline. The rows do not change. Only the view does.

## Charts

Insert a chart from a table and change its type. Edit a number in the table and the chart updates.

Every chart has a text summary and a data table, so a screen reader can read it. Press Tab to reach a chart.

## Take a table out

Export a table as an Excel file (`.xlsx`) or as `.csv`. Both are in the Export dialog.

Smart tables and charts are built. They have been checked by automated tests only. The [feature list](../FEATURES.md) shows their status.

## Choices

To pick a value from a short list, such as a status or a tag, click in a column, open the Data menu, choose Format, then pick the format "Choice, pick one" or "Choice, pick several". The column starts with the values it already holds. Each value is a named, colored choice.

Press Alt+Down in a cell, or use Choose a value in the Data menu, to see the list. A column that picks several stays open after each choice, so you can pick more. Choose Done or press Escape to finish. You can still type in the cell. Text that is not one of the choices has a dashed outline and is kept.

Choose Edit choices to add a choice, rename it, give it another color, move it up or down, or delete it. Renaming changes every cell that has it. Deleting a choice leaves the cells' text alone. A choice name cannot have a comma.

Sort orders rows by the order of the choices. Under Filter, Show only a choice shows just those rows. A board puts one lane on the screen for each choice. A formula reads a choice as its text, so `[Status] = "Done"` works. Export writes the names, and an Excel file gets a drop-down list for a column that picks one.

## Analyze: statistics, regression, and matrices

Select some cells, or just click in a table to use all of it, then open the Data menu and choose Analyze. Or press Ctrl+K and type "Table:". The answer is added as a new table below, so your data is never changed. Rows hidden by a filter are left out.

- **Statistics** gives count, sum, mean, median, mode, standard deviation and variance (sample and population), minimum, maximum, and the quartiles for each column. Histogram adds a table of bins with a bar chart. Box plot adds a box plot chart of the values, with the five numbers beside it.
- **Regression** fits two selected columns, x then y (one column uses 1, 2, 3 for x). Choose a linear, quadratic, cubic, any polynomial up to degree 6, or exponential fit. You get the equation, r², and a table of the points and the fitted values with a scatter chart.
- **Matrix** treats the selected numbers as a matrix. Choose determinant, inverse, transpose, multiply by another range (type it, such as D1:E2), row reduce with steps, rank, eigenvalues, or Solve Ax = b. For Solve, select the coefficients with the answers in the last column. Eigenvalues are listed when real, for matrices up to 8 by 8.

To get an answer as a display equation instead of a table, choose Analyze, then Insert as an equation. It works for fits, matrix tools, and the box plot, and the equation is added as its own block below the table.

A number can have a unit, such as 12.5 kg. When all the numbers in a column share a unit, the statistics keep it. If they differ, nothing is added and you are told why.

## Saved views

In the Data menu under a table, choose Saved views, then Save filters and sort as a view. Pick a view later to see the same rows in the same order. Each table keeps its own views.
