# Code cells

Write a short Python or JavaScript program on a page and run it there. Use it to check a worked problem, try Newton's method, or print a table of values. Code cells are in Beta.

## Add a code cell

- Open Insert, then Code cell. Or type `/code cell` in text, or press Ctrl+Alt+Shift+C. The command palette (Ctrl+K) finds it too.
- Choose Python or JavaScript from Language. The cell starts with an example you can change or delete.
- Write your code in the Code box. Tab indents and Shift+Tab outdents. To move on with the keyboard, press Escape, then Tab.

## Run it

- Press Run, or Ctrl+Enter in the code. What the program prints appears under it, and errors show in red.
- In JavaScript, use `console.log` or `print`. The value of the last line is shown after an arrow.
- In Python, use `print`. Python cells use MicroPython, which has most of the language and modules such as `math`, `random`, `json`, and `re`. It has no NumPy.
- Press Stop, or Escape in the code, to end a run. Clear output removes what was printed.
- Code runs only when you press Run. Opening a page, or a page someone shared with you, never runs it.

## What a cell can and cannot do

Each run starts in a sandbox of its own, on this device, and works offline.

- It has no network, so it cannot download or send anything.
- It cannot open your files or your notes, and cannot change the page or the app. A Python cell's `open` works only on a short-lived, empty in-memory disk.
- It stops after 10 seconds and when it uses more than 64 MB. The first 100,000 characters of output are kept.
- Nothing is kept from one run to the next. The page saves the code, not the output.

## In exports and other apps

A code cell exports as a code block with its language, in Markdown, PDF, and web page exports. Search finds the code.

Code cells are built and have been checked by automated tests only.
