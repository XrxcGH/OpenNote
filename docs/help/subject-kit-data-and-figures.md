# Data, seeds, and figures in the subject kits

Every subject kit (statistics, the sciences, the humanities, economics, music, and the rest) takes data, makes random results you can repeat, and puts its diagrams on the page the same way. These parts are new in Beta, so check the answers against your own work while you learn them.

## Data

- A data field takes data three ways. Paste or type it, one row per line, with columns separated by tabs, commas, semicolons, or spaces. Choose Open a file for a CSV, TSV, or text file. Or choose Find tables on the page, pick a table, and choose Use this table.
- The first row names the columns when it looks like a header. Each column is read as numbers, categories, dates, or text.
- Blank cells, NA, N/A, a lone full stop, and NaN count as missing. A cell that cannot be read as its column's kind is missing too, and the field says how many there were and where the first one is.
- A decimal comma, as in 3,25, is understood when the data uses it.
- Data from a table is copied into the tool, so a figure or live block keeps the same numbers even when the table changes later.
- At most 100,000 rows are used. The field says when a paste was longer.
- Role pickers choose which column is the response, the predictors, the group, the subject, the weight, the time, or the event. A picker offers only the columns of the right kind.
- Reshape stacks several measurement columns into one column with a column naming each measurement (wide to long), or spreads such a column back into one column per measurement (long to wide).
- A matrix grid takes a small table of numbers, such as a contingency table or a payoff matrix. Rename its rows and columns in the label cells, and add or remove rows and columns with the buttons under it.
- A list field takes one value per line and says which line is not a number.

## Random results you can repeat

- Every simulation shows its seed. The same seed gives the same results on every computer, so a page can show exactly how they were made.
- Type a seed, a whole number from 0 to 18446744073709551615, or choose New seed for a fresh one.

## Results and plots

- A coefficient table lists each estimate with its standard error, test statistic, p-value, and interval, and says in words whether it differs from zero at the chosen level.
- Plots include histograms (bins by the Freedman-Diaconis rule), smoothed densities, the empirical distribution, normal Q-Q plots, box plots, fitted curves with confidence and prediction bands, step curves, forest plots, and ROC curves.
- Long calculations, such as resampling and simulations, run without freezing the window and can be canceled.

## Figures on the page

- Insert figure puts a tool's diagram on the page as a figure block: a tree, a timeline, a network, a map, and the like.
- The figure shows as a picture with its description, so a screen reader reads what it shows, and search and export keep its summary.
- Open in tool, under the figure, reopens the tool with the inputs that made it.

## The sign test example

The kits' guide for developers builds one small tool, a one-sample sign test, that the other tools follow. It counts the values above and below a hypothesized median, leaves out those equal to it, and gives the exact p-value from the binomial distribution with worked steps.
