# Chemistry and property tables

Balance equations, solve chemistry problems with steps, draw structures, and look up steam, gas, and material properties. Everything works offline and keeps your work on this computer.

Open any of these from the Insert tab (Math group). The shortcuts are Ctrl+Alt+Y for the calculators, Ctrl+Alt+Z for the structure drawer, and Ctrl+Alt+U for the tables. You can also use the command palette (Ctrl+K) and search for the chemistry calculators, the chemical structure drawer, or the steam, gas, and materials tables. Each opens in a small window that you can move, pin, and pop out.

## Chemistry calculators

Each tab answers as you type and shows its steps. Press Insert answer to put the answer at the caret, or Insert with steps to add the working too.

- **Balance.** Type an equation with an arrow, such as `C3H8 + O2 -> CO2 + H2O`. It gives the smallest whole-number coefficients and the molar mass of each substance. Ions work with a charge: `MnO4-`, `Fe^3+`, and `e-`.
- **Molar mass.** Type a formula such as `Ca(OH)2` or `CuSO4.5H2O` for its molar mass and percent composition.
- **Stoichiometry.** Type a reaction and the mass of each reactant you have. It names the limiting reagent, gives the theoretical yield of each product, and says how much of each reactant is left over. Add an actual yield for percent yield.
- **Gas laws.** The ideal gas law, the combined gas law, Graham's law, and gas density. Leave exactly one box empty and that is the one it solves for. Pick any common unit; it converts inside.
- **Solutions.** Dilution (C₁V₁ = C₂V₂, with how much stock and water to mix), molarity from mass, the pH of a strong or weak acid or base, and a buffer by the Henderson–Hasselbalch equation.
- **Titration.** A titration curve for a strong or weak acid or base against a strong titrant, with the equivalence point marked and the pH there. A second form finds an unknown concentration from the titrant used.

The pH answers solve the exact equations, so a weak acid does not rely on the "x is small" shortcut. Expect them to differ from a hand calculation by a few hundredths of a pH unit.

## Chemical structures

Type a structure as SMILES text, or choose one from the list: rings, chains, functional groups, and small molecules.

- Letters are atoms. `=` and `#` make double and triple bonds. Round brackets start a branch. A digit marks the two ends of a ring. Lowercase `c`, `n`, `o`, and `s` are aromatic. Examples: `CCO` (ethanol), `CC(=O)O` (acetic acid), `c1ccccc1` (benzene).
- The picture is a skeletal formula. Carbon is a corner, hydrogens on carbon are left out, and other atoms show as letters with their hydrogens. A molecule's formula and molar mass show below the picture.
- **Put on page as ink** draws it on the page you are writing on. Each bond is its own line, and each atom label is its own text box, so you can move, reshape, restyle, or retype any of them. Bonds use your current pen color and width.
- **Save as SVG** makes a sharp picture for slides and documents.
- **Insert formula** adds the formula and molar mass as text.

The drawer lays out chains and single or fused rings. A crowded molecule can need a nudge after it is on the page, which is why every part stays editable.

## Property tables

- **Steam.** Saturated water by temperature or by pressure, from 0.01 to 370 °C and 1 to 20 000 kPa. Type a temperature or pressure to read the values between two rows by straight-line interpolation. The values come from the IAPWS-95 formulation of water.
- **Ideal gases.** Molar mass, gas constant, cp, cv, and k for common gases at a temperature from 250 to 1000 K.
- **Materials.** Density, Young's modulus, yield strength, thermal conductivity, and specific heat for common metals, plastics, ceramics, and wood. Values are typical for the stated condition. Check the named source before using one for a design.

Every table is searchable. Each row has an Insert button, and "Insert table of the rows shown" adds a table to the page. Every row names its source, and the sources and licenses are listed at the bottom of the window and in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).


## Ion charges

Write ions the way a textbook does: Cu2+, Fe3+, SO42-, MnO4-, NH4+, or with a caret (Cu^2+). A digit before the sign is a subscript in a molecular ion (the 4 in MnO4-) and the charge on a single atom (Cu2+). If an equation has more than one valid balance, the balancer says so instead of picking one.

Bonds placed on the page are line shapes of one width, in the pen color, so you can drag their handles; labels are text boxes.
