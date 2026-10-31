# Subject tool kits

Eleven tool windows work engineering, science, and math problems. Each window has a tab for each tool. A tool takes typed values with units, works the problem, and shows the results, the worked steps, and its assumptions. These kits are new in Beta and off in Stable. Check the answers against your own work while you learn them.

## Open a kit

- Press Ctrl+K and type the kit's name, such as "solid mechanics" or "physics tools".
- Or type a tool's subject, such as "Tsai-Wu", "Bode", or "Lambert". Each tool has its own command, which opens the kit on that tab.
- The window remembers the last tab and what you typed in each tool.
- Open in its own window moves the kit into a window of its own, as for the other tools.

## Use a tool

- Pick SI or US units. Switching keeps the values; a unit of the wrong kind is marked on its field.
- Pick an example to fill in a ready-made problem.
- Use the arrow keys, Home, and End to move between tabs.
- Insert puts the work into the page: the answer line, the equation, the results table, the worked steps, or a picture of the plot.

## Live calculation blocks

- In the solid mechanics, fluids and heat transfer, and dynamics and control kits, Insert, then Live calculation block, keeps the calculation on the page.
- The block shows the tool, the answer, and the key results. Search and export keep the numbers.
- Open in tool reopens the tool with the values the block saved, so you can change one and work it again.
- The mechanisms and dynamics kit has a calculation block of its own that works the same way.

## The kits

| Kit                      | Tools                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Circuits and energy      | Transients, the circuit simulator (DC, AC sweep, and transient), op-amps and filters, semiconductors, instruments, AC power, power flow, data fitting, and energy                                                                                        |
| Fluids and heat transfer | Fluid statics and Bernoulli, pipe flow and pumps, dimensional analysis, viscous flows, external flow and drag, conduction, fins, transient conduction, convection, heat exchangers, radiation, and water and air properties                              |
| Solid mechanics          | Columns, stress and strain at a point, section properties, axial, torsion, and bending, beam deflection, pressure vessels, thin-walled structures, composite laminates, tissues and joints, fatigue and machine elements, and a finite element workbench |
| Aerospace                | Standard atmosphere, compressible flow, nozzles and diffusers, rocket nozzles, finite wings, aircraft performance and stability, potential flow, aircraft dynamic modes, jet engine cycles, and airfoils                                                 |
| Chemistry and materials  | Thermochemistry, equilibrium, acids and bases, electrochemistry, kinetics, solutions, crystal structures and diffraction, defects and diffusion, phase diagrams, and atoms and bonding                                                                   |
| Thermodynamics           | Statistical thermodynamics, ideal gases, steam and water, psychrometrics, R-134a, steady-flow devices, power and refrigeration cycles, real gases and mixtures, and combustion                                                                           |
| Dynamics and control     | System models, root locus, Bode and Nyquist, compensators and PID, state-space design, digital control, probability, Markov chains and queues, reliability, and Kalman filtering                                                                         |
| Design tools             | Tolerances and fits, machining, forming and joining, micro and nano fabrication, number representation, programming references, orthographic views, a memory and pointer tracer, and a drafting sheet                                                    |
| Engineering mathematics  | Series, complex analysis, systems of ODEs, Fourier series and boundary value problems, numerical methods, a matrix console, a linear algebra workbench, and vector calculus                                                                              |
| Mechanisms and dynamics  | Linkages, cams, gears, compliant mechanisms, rigid-body dynamics, Lagrangian mechanics, 3D rotations, vibration, and robot arms                                                                                                                          |
| Physics tools            | Waves and sound, special relativity, wave and geometric optics, nuclear science, spacecraft sizing, electric and magnetic fields, and orbits and maneuvers                                                                                               |
| Earth sciences           | Atmospheric thermodynamics, radiation and climate, geochronology, stereonets, stratigraphy diagrams, air quality and weather, seismology, geophysics, and ocean and waves                                                                                |

## Earth sciences

Open it with Ctrl+K and "Open the earth sciences kit", or with "Open" and a tool's name. Pick a topic, then a calculation.

- Atmospheric thermodynamics and soundings: humidity, the LCL, lapse rates, thickness, a Skew-T with parcel CAPE and storm winds, and room humidity.
- Radiation, climate, and footprints: energy balance and greenhouse layers, radiative forcing, warming over time, ice-albedo tipping points, the Budyko-Sellers model, insolation by latitude and orbit, Köppen-Geiger and Holdridge classes, the Thornthwaite water balance, degree days, and carbon footprints with editable factors.
- Geochronology, isotopes, and the time scale: radiometric ages, isochrons, U-Pb concordia, argon plateaus, radiocarbon calibration, stable isotopes, and mineral formulas.
- Stereonets and structural geology: planes, lines, poles, rakes, intersections, apparent dip, three-point problems, fold axes, and Fisher statistics.
- Stratigraphy and classification diagrams: stratigraphic columns with correlation, the Harris matrix, ternary plots, soil texture, and QAPF names.
- Air quality and weather observations: the AQI, Gaussian plumes with a ground-level concentration map, ppm conversions, box models, METAR and TAF in words, and radar rain rates.
- Seismology and seismic surveys: S-P distance, epicenters, magnitude and energy, b-values, Omori-Utsu aftershock decay, flat and dipping-layer refraction, NMO, and Dix velocities.
- Gravity, magnetics, heat flow, and plates: Bouguer and isostatic anomalies, magnetic fields, geotherms, plate motions, and resistivity.
- Ocean, waves, and planetary flow: seawater density and sound speed by EOS-80, TEOS-10 conservative temperature, density, potential density, and freezing point, wave dispersion and shoaling, and Coriolis, geostrophic, Ekman, Rossby, and Kelvin flow.

## Which builds have them

The kits are on in Beta and off in Stable. Their feature flags are `kits.electrical`, `kits.fluidheat`, `kits.solids`, `kits.aero`, `kits.chemmat`, `kits.thermo`, `kits.control`, `kits.design`, `kits.math`, `kits.mechdyn`, `kits.physics`, and `kits.earth`. The live calculation block's flag is `kits.calc`.
