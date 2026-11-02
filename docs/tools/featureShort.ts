// The short form of each FEATURES.md sentence over 30 words, for the feature list (featureRows.ts). CHECKS warns
// about a sentence over 30 words, and a sentence cut by rule loses its verb or leaves a parenthesis open, so each one
// is written short by hand. A key is the first 40 characters of the long sentence; the list stops when one is missing.
export const SHORT: Readonly<Record<string, string>> = {
  'Video files (mp4 and webm, up to 200 MB)':
    'Video files (mp4 and webm, up to 200 MB) play in a block on the page, with no network',
  "A calibration page learns the person's o":
    'A calibration page learns your own handwriting from the pen, letter by letter and then in sentences',
  'The style is kept only on this device, e':
    'The style stays on this device, encrypted under a key in Windows Credential Manager, and is never synced, exported, or logged',
  'Irregular shapes snap too: a trapezoid, ':
    'Irregular shapes snap too: any closed outline of 4 to 7 corners becomes a clean polygon with a handle on each corner',
  'Palm lab (Settings > Pen and touch; Beta':
    'Palm lab (Settings > Pen and touch, in Beta and dev builds) records your pen and hand for the palm test corpus',
  'Pen library: fountain, brush, calligraph':
    'Pen library: fountain, brush, calligraphy, dashed, and dotted pens, and named pen sets you can save and switch between',
  'Ink layers: named layers you can hide, l':
    'Ink layers: named layers you can hide, lock, rename, reorder, and export, and hidden layers stay out of print',
  'In the Elements library, Move on an elem':
    'In the Elements library, Move puts an element or a folder in any folder, and Rename renames a folder',
  'A link, a search result, a tag line, Fin':
    'Links, search results, tags, Find, read aloud, and Undo open the folded heading or list item that hides their target',
  'On ruled, grid, and dot paper, lines, ar':
    'On ruled, grid, and dot paper, lines, shapes, and shape handles snap to the lines the paper draws',
  'Works on one page or a whole notebook, i':
    'Works on one page or a whole notebook, including recognized handwriting, and one Undo puts back a notebook-wide replace',
  'Print (Ctrl+P, the Export menu, or the p':
    'Print (Ctrl+P) sends the page to a printer, with copies, both sides, black and white, a page range, and shrink to fit',
  "The text caret's width and color (the Wi":
    "The text caret's width and color follow the Windows text cursor settings, and Settings can override its width",
  'When a pen hovers above the screen, a sm':
    'When a pen hovers above the screen, a small circle shows where ink will land and how wide it will be',
  'A reading view adds a line focus band (1':
    'A reading view adds a line focus band, soft page tints, extra spacing, a maximum line width, and optional syllable breaks',
  'Checks worked math one step at a time, t':
    'Checks worked math one step at a time, typed or handwritten, from algebra and calculus to matrices and units',
  'Make an exam-style paper from a page, a ':
    'Makes an exam-style paper from a page, a section, or a notebook, with several kinds of questions, marks, and an optional timer',
  'With the pen, a person can strike throug':
    'With the pen, you can strike out words, draw a line to add space, circle words to select them, and write in a gap',
  'Beyond the pens and pencil, the library ':
    'The library adds a fountain pen, a brush, a calligraphy nib, and dashed and dotted line pens to the pens and pencil',
  'A smart table can also show as a board (':
    'A smart table can also show as a board, a calendar, a gallery of cards, or a timeline',
  'A code cell block runs a short Python (M':
    'A code cell runs a short Python or JavaScript program on the page and shows what it prints, with errors in red',
  '"Create shortcut" makes a Windows shortc':
    '"Create shortcut" makes a Windows shortcut that opens a page, a section, or a notebook, and you can pin it to the taskbar',
  'Dropping an audio or video file, such as':
    'Dropping an audio or video file onto a page adds a player with time-stamped notes, playback speed, and flags',
  '"Clean up" takes a photo of a page, a wh':
    '"Clean up" finds the edges of a photo of a page or whiteboard, straightens it, and evens out the lighting',
  'A searchable palette of Greek letters an':
    'A searchable palette of Greek letters and math, science, and engineering symbols, with recent symbols first',
  'A searchable window of 23 physical const':
    'A searchable window of 23 physical constants from the 2022 CODATA values, such as the speed of light and the Planck constant',
  'A window with a LaTeX field, a live prev':
    'A window with a LaTeX field, a live KaTeX preview, and a palette of snippets for fractions, roots, sums, matrices, and more',
  'A window that counts the significant fig':
    'A window that counts the significant figures of a number, rounds it to a chosen count, and writes it in three notations',
  'On the line being typed, an equation wit':
    'On the line being typed, an equation with one unknown shows its answer in gray, and Tab adds it as a line',
  'A periodic table as a keyboard-navigable':
    'A periodic table you can move through with the keys, with a card of facts for each element to insert on the page',
  'One window with six tabs: balance an equ':
    'One window with six tabs: balancing, molar mass, stoichiometry, gas laws, solutions, and titration',
  'With Zotero running, Add or edit citatio':
    "With Zotero running, the Zotero commands open Zotero's own windows and put the result in the text block at the caret",
  'Forward and inverse Laplace transforms w':
    'Forward and inverse Laplace transforms with steps, Fourier transforms of table pairs, and searchable tables of pairs and properties',
  'Expands f about a point to order n, with':
    'Expands a function about a point to order n, with each derivative, an error bound, and a graph of its partial sums',
  "Newton's method, bisection, and the seca":
    "Newton's method, bisection, and the secant method, with an iteration table, how the run ended, and the steps drawn on the graph",
  'For a 2×2 or 3×3 matrix: the characteris':
    'For a 2×2 or 3×3 matrix, finds the characteristic polynomial, eigenvalues, and eigenvectors, and draws what the matrix does',
  'Range, highest point, time of flight, an':
    'Range, highest point, time of flight, and landing speed of a projectile, with optional air resistance by Runge-Kutta',
  'A graph block that starts with `@3d` plo':
    'A graph block that starts with `@3d` plots surfaces, space curves, vectors, points, lines, and planes in a box you turn',
  'A block with a body, forces, moments, an':
    'A block with a body, forces, moments, and supports that snap to the grid, with the sums of forces and moments beside it',
  'Nearest neighbors, trees, naive Bayes, l':
    'Nearest neighbors, trees, naive Bayes, regression, and small neural networks on toy sets or your data, ' +
    'with cross-validation and scores',
  'Intervals, pitch and frequency, scales a':
    'Intervals, scales and modes from several traditions, chords, keys, Roman numerals, transposition, pitch-class sets, and guitar shapes',
  'Atmospheric thermodynamics and soundings':
    'Nine tools for the atmosphere, climate, dating, structural geology, stratigraphy, air quality, seismology, geophysics, and the ocean',
  'Logic, automata and grammars, numbers an':
    'Logic, automata, numbers and groups, digital logic, computer systems, algorithms, optimization, and games ' +
    'and voting, with worked steps',
  'Collects the display equations of this p':
    'Collects the display equations of pages or a section into a new page of one to four columns, so it fits one sheet',
  "The Mac menu bar lists OpenNote's comman":
    "The Mac menu bar lists OpenNote's commands, one menu per category, with each command's key equivalent",
  'A data field reads pasted text, a CSV or':
    'A data field reads pasted text, a CSV or TSV file, or a table on the open page, with tools to clean and reshape it',
  'Draws events and periods on parallel tra':
    'Draws events and periods on parallel tracks with era bands and uncertainty bars, on linear, logarithmic, or broken axes',
  'Converts a date among thirteen calendars':
    "Converts a date among thirteen calendars and counts with the steps, and lists a year's festivals",
  'Readability formulas with heuristic flag':
    'Readability formulas, word lists, n-grams, a concordance, keyness, version comparison, and English and Latin scansion',
  'Syntax trees from labeled brackets and d':
    'Syntax and dependency trees, interlinear gloss checks, feature charts, ordered rules, syllables, and vowel charts',
  'On-screen keyboards for IPA and many scr':
    'On-screen keyboards for IPA and many scripts, and romanization of Korean, Japanese, Chinese, Thai, Vietnamese, and more',
  "Twelve projections (Snyder's formulas an":
    'Twelve map projections with your points, great-circle routes, choropleth layers, a legend, a scale bar, and a north arrow',
  'Builds a numbered dichotomous key and it':
    'Builds a numbered dichotomous key from a character table, runs it couplet by couplet, and keeps a catalog of specimens',
  'Amplitude, power, density, Welch, and sp':
    'Amplitude, power, density, and spectrogram views of samples, a sound file, or a table column, with peaks and band powers',
  'FIR filters by the window method (with K':
    'Designs FIR and IIR filters from a specification, shows every response and the pole-zero plot, and filters data',
  'Opens or records sound (kept on the devi':
    'Opens or records sound on the device and shows its waveform, spectrograms, pitch, and formants, with a tuner and audiograms',
  'Epochs with baseline correction, amplitu':
    'Event-related averages, fMRI regressors and fits, spike-train statistics, ECG heart-rate variability, and electrode maps',
  'Window, level, stretch, and gamma with a':
    'Adjusts, thresholds, filters, measures, and transforms images, with band math and CT reconstruction by filtered back-projection',
  'Larmor frequency, spin-echo, gradient-ec':
    'MRI signals and a Bloch simulator, k-space, CT numbers, ultrasound, X-ray attenuation, and PET uptake',
  'Reflection, VSWR, and input impedance (o':
    'Reflection and impedance on a Smith chart, matching networks, line types, two-ports, noise, antennas, and radar range',
  'Bound states of preset or typed potentia':
    'Bound states of wells and barriers, transmission through layers, wave packets in time, quantum dots, and the Gamow factor',
  'Exact Clebsch-Gordan coefficients, 3j sy':
    'Clebsch-Gordan coefficients, spin matrices, Stern-Gerlach analyzers, Larmor precession, and circuits of up to five qubits',
  'Hydrogen-like lines with the reduced mas':
    "Hydrogen-like spectra, wavefunctions, fine structure, term symbols, Zeeman patterns, selection rules, and Moseley's law",
  'Digests linear or circular DNA with 56 b':
    'Digests DNA with 56 built-in enzymes, draws gels and plasmid maps, finds primer melting temperatures and ' +
    'PCR products, and works ligations',
  'Builds trees from alignments or distance':
    'Builds trees from alignments or distances by UPGMA or neighbor-joining, scores them by parsimony, and reads and draws Newick trees',
  'Draws pedigrees in NSGC symbols from a t':
    'Draws pedigrees from a typed list, checks inheritance patterns, works genotype probabilities and kinship, and draws genograms',
  'Conjugate updates with credible and high':
    'Conjugate updates with credible intervals, Bayes factors, grid posteriors, a Metropolis sampler, and small Bayesian networks',
  'Cardiac output, MAP, resistance, Laplace':
    'Heart, lung, kidney, and metabolic calculations, from cardiac output and the alveolar gas equation to clearance and BMR',
  'Michaelis-Menten and inhibition fits bes':
    'Enzyme, binding, and dose-response fits, with standard curves, EC50, Schild analysis, LD50, and survival curves',
  'SIR-type epidemics, fitting β and γ to c':
    'Epidemic models fit to case counts, reaction networks, Schelling, network models, the Game of Life, and cellular automata',
  'Design a lead, lag or lead-lag compensat':
    'Designs a lead, lag, or lead-lag compensator or PID gains, and checks the closed loop',
  'Estimate the force or pressure of a form':
    'Estimates forming forces, bend and riser sizes, casting solidification time, weld heat input, and printed-part layers',
  'Estimate what a process step can resolve':
    'Estimates what a process step can resolve or deposit, film stress on a wafer, die counts and yield, and surface binding',
  'Motion from typed coordinates, two point':
    'Motion from typed coordinates, a turning body, an impact, rolling down an incline, or a rigid body under forces',
  'Quick references for learning to program':
    'Quick references for learning to program: C++ types and escapes, common errors, MATLAB habits, operator precedence, and a trace table',
  'See how a computer stores a number or a ':
    'See how a computer stores a number or a character: integer bits, overflow, other bases, floating-point values, and text bytes',
  'Work out spindle speed, feed rate, mater':
    'Work out spindle speed, feed rate, removal rate, and cutting time for a cut, find tool life, and read the tool forces',
};
