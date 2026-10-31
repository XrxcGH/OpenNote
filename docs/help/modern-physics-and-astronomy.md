# Modern physics and astronomy tools

Nine calculators for quantum mechanics, atoms, molecules, solids, plasmas, stars, the sky, and cosmology share one tool window. They are new in Beta, so check the answers against your own work while you learn them.

## Open a tool

- Open the command palette and type the tool's name, such as "Open the atoms and spectra tool" or "spin". Each tool has its own command.
- In the window, the Tool list switches tools and the Calculation list picks what to work out. The window remembers both.
- Type numbers as 2.5, 1e18, 1.2×10^5, or 1,000. A unit list beside a field converts what you type; the answer is the same in any unit.
- A field that cannot be used says why under the form, such as "The density must be greater than zero."

## Read and insert an answer

- The first result is the answer. The table below it has every value, and Worked steps show each formula with the numbers put in.
- Plots draw in the window's colors. The text summary under a plot says what it shows.
- Insert answer puts the answer line on the page at the caret. More to insert gives the LaTeX equation, the result table, the answer with its worked steps, or the plot as a picture.
- Each tool names its constants and data sources under the answer. Physical constants are the CODATA 2022 values.

## The tools

### Quantum mechanics

- **Quantum wells, barriers, and wave packets** finds the bound states of preset or typed potentials beside the exact levels, gives transmission through steps, barriers, and layered structures, and moves a wave packet in time.
- **Angular momentum, spin, and qubits** gives exact Clebsch-Gordan coefficients and tables, spin and Pauli or Dirac matrices with commutators, Stern-Gerlach analyzers, Larmor precession, and circuits of up to five qubits.

### Atomic and molecular physics

- **Atoms, spectra, and X-rays** gives hydrogen-like lines and wavefunctions, fine structure, term symbols with Hund's rules, Zeeman patterns, selection rules, and Moseley's law.
- **Molecular spectra, mass spectra, and polymers** gives rotational and vibrational spectra, isotope patterns and exact masses from a formula, NMR multiplets, and polymer chain statistics.

### Solid-state and plasma physics

- **Solids and semiconductor devices** covers the free-electron gas, Kronig-Penney bands, phonon chains, carriers and the Fermi level, p-n junctions, MOS capacitors, and solar cells.
- **Plasmas and space physics** gives plasma parameters, sheaths, a planet's dipole field, the magnetopause, and the fusion triple product.

### Astronomy and cosmology

- **Stars, light, and exoplanets** works with magnitudes and distances, blackbodies, HR diagrams, the Saha equation, compact objects, and transits.
- **Sky positions and sun paths** gives Julian Dates and sidereal time, where the Sun and Moon are, coordinate conversions, rise and set times, sun-path diagrams, and shadows.
- **Cosmology, galaxies, and telescopes** gives distances and ages in an expanding universe, rotation curves, telescope numbers, and the CCD equation.

## Limits

- The sky tool has no star chart yet, and it does not place the planets.
- Finite-difference levels are accurate to about one part in ten thousand on the default grid. More grid points make them closer to exact.
- Semiconductor densities use Boltzmann statistics, so they are rough for very heavy doping.
