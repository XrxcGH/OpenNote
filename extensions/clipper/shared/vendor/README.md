# Vendored code

`Readability.js` is Mozilla Readability 0.5.0 (`@mozilla/readability` on npm), under the Apache License 2.0 in
`Readability-LICENSE.md`. It finds the article in a page for the clipper's "Clean article" mode. The only change is
the last line, `export default Readability;`, so the clipper can import it as a module. To update it, replace the
file with the new release's `Readability.js` and add that line again.
