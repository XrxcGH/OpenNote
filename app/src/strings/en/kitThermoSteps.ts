// The thermodynamics kit's working steps, one block per tool (namespace kitThermo, key step; owner: the thermo
// lane). They live apart from kitThermo.ts so neither file grows past the size limit.

export const kitThermoSteps = {
  stat: {
    trans:
      'Translation: the thermal wavelength is Λ = {lambda} pm, so the partition function per molecule is ' +
      'q_tr = {q}.',
    sackur: 'Sackur-Tetrode: the translational entropy is {S} J/(mol·K).',
    rot: 'Rotation: θ_rot = hcB/k = {theta} K; with σ = {sigma}, q_rot = T/(σθ_rot) = {q}.',
    vib: 'Vibration mode {n}: θ_vib = hcν̃/k = {theta} K, and its cv/R = {cv}.',
    elec: 'The electronic ground level has degeneracy {g}, which adds R ln g = {S} J/(mol·K) to the entropy.',
    total: 'Adding the modes: cv = {cv} J/(mol·K), cp = cv + R = {cp} J/(mol·K), and S = {S} J/(mol·K).',
    einstein: 'Einstein solid with x = θ_E/T = {x}: cv/R = {cv}.',
    debye: 'Debye solid with θ_D/T = {x}: the integral by quadrature gives cv/R = {cv}.',
    dulong: 'That is {ratio} of the Dulong-Petit limit of 3R.',
    speeds: 'Maxwell-Boltzmann speeds: most probable {mp} m/s, mean {mean} m/s, and root-mean-square {rms} m/s.',
    mfp: 'Mean free path of hard spheres: λ = kT/(√2 π d² p) = {lambda} nm.',
    kn: 'Knudsen number: Kn = λ/L = {kn}.',
    knContinuum: 'Kn is below 0.01, so the gas behaves as a continuum.',
    knSlip: 'Kn is between 0.01 and 0.1: continuum with slip at the walls.',
    knTransition: 'Kn is between 0.1 and 10: transitional flow, where neither model is exact.',
    knFree: 'Kn is above 10: free molecular flow.',
    kinetic: 'Simple kinetic theory gives k = {k} W/(m·K) and μ = {mu} Pa·s; real gases are about 2 to 3 times higher.',
    occX: 'With kT = {kT} eV, the reduced energy is x = (E - μ)/kT = {x}.',
    occ: 'The occupancy is {fd} for fermions, {be} for bosons, and {mb} in the classical limit.',
  },
  gas: {
    model: {
      variable:
        'Variable specific heats from the NASA polynomials: R = {R} kJ/(kg·K), and at T₁ cp = {cp} kJ/(kg·K) ' +
        'and k = {k}.',
      constant: 'Constant specific heats taken at 300 K: R = {R} kJ/(kg·K), cp = {cp} kJ/(kg·K), and k = {k}.',
      cold: 'Cold-air standard: R = {R} kJ/(kg·K), cp = {cp} kJ/(kg·K), and k = {k}.',
    },
    isentropicVariable:
      'Isentropic with variable specific heats: s°(T₂) = s°(T₁) + R ln(p₂/p₁), with s°(T₁) = {s1} and ' +
      's°(T₂) = {s2} kJ/(kg·K) for a pressure ratio of {ratio}.',
    isentropicConstant: 'Isentropic with constant specific heats and k = {k}.',
    polytropic: 'Polytropic with n = {n}: p vⁿ stays constant.',
    isothermal: 'Isothermal: T stays constant, so p v stays constant.',
    isobaric: 'Constant pressure: v changes in proportion to T.',
    isochoric: 'Constant volume: p changes in proportion to T.',
    end: 'State 2: T₂ = {T2} K and p₂ = {p2} kPa; v₁ = {v1} and v₂ = {v2} m³/kg.',
    changes: 'Changes: Δu = {du} kJ/kg, Δh = {dh} kJ/kg, and Δs = {ds} kJ/(kg·K).',
    work: 'Work and heat: w_b = {wb} kJ/kg, q = Δu + w_b = {q} kJ/kg, and the steady-flow shaft work is {ws} kJ/kg.',
    law: 'Ideal gas law: v = RT/p = {v} m³/kg.',
    entropy: 'Entropy: s = s°(T) − R ln(p/100 kPa) = {s0} − R ln(p/100 kPa) = {s} kJ/(kg·K).',
    relative: 'Relative pressure and volume: Pr = exp((s° − s°ref)/R) = {pr} and vr = (T/Tref)/Pr = {vr}.',
    sound: 'Speed of sound: a = √(kRT) = {a} m/s.',
  },
  steam: {
    test: {
      abovePsat:
        'Region test: at T = {T} K the saturation pressure is {psat} kPa, and p = {p} kPa is above it, so the ' +
        'state is liquid in region 1.',
      belowPsat:
        'Region test: at T = {T} K the saturation pressure is {psat} kPa, and p = {p} kPa is below it, so the ' +
        'state is vapor in region 2.',
      aboveB23:
        'Region test: T = {T} K is above 623.15 K, and p = {p} kPa is above the B23 boundary pressure of {pb} kPa, ' +
        'so the state is in region 3.',
      belowB23:
        'Region test: T = {T} K is above 623.15 K, and p = {p} kPa is below the B23 boundary pressure of {pb} kPa, ' +
        'so the state is in region 2.',
      aboveRegion2: 'Region test: T = {T} K is above 1073.15 K, so the state is in region 5.',
      saturated: 'The state is on the saturation line, region 4: T_sat = {T} K and p_sat = {p} kPa.',
    },
    vars1: 'Region 1 uses π = p/16.53 MPa = {pi} and τ = 1386 K/T = {tau} in the Gibbs energy γ(π, τ).',
    vars2: 'Region 2 uses π = p/1 MPa = {pi} and τ = 540 K/T = {tau} in the Gibbs energy γ° + γʳ.',
    vars5: 'Region 5 uses π = p/1 MPa = {pi} and τ = 1000 K/T = {tau} in the Gibbs energy γ° + γʳ.',
    vars3:
      'Region 3 uses the Helmholtz energy φ(δ, τ): the density that matches p is {rho} kg/m³, so δ = ρ/322 = ' +
      '{delta} and τ = 647.096 K/T = {tau}.',
    belowF:
      'At this pressure the saturated liquid has {key}_f = {f}, and {key} = {value} is below it: compressed ' +
      'liquid. Brent’s method on T gives T = {T} K.',
    aboveG:
      'At this pressure the saturated vapor has {key}_g = {g}, and {key} = {value} is above it: superheated ' +
      'vapor. Brent’s method on T gives T = {T} K.',
    between:
      'At this pressure {key}_f = {f} and {key}_g = {g}, and {key} = {value} lies between them: a saturated ' +
      'mixture at T_sat = {T} K.',
    supercritical:
      'The pressure is above the critical pressure, so there is no saturation line. Brent’s method on T gives ' +
      'T = {T} K.',
    lever: 'Lever rule: h = h_f + x h_fg = {hf} + {x} × {hfg} = {h} kJ/kg.',
    leverS: 'In the same way s = s_f + x s_fg = {sf} + x × {sfg} = {s} kJ/(kg·K), and v = {v} m³/kg.',
    result: 'The state: v = {v} m³/kg, u = {u} kJ/kg, h = {h} kJ/kg, and s = {s} kJ/(kg·K).',
  },
  psy: {
    pwsWater: 'State {label} at {t} °C: the saturation pressure over water, by IF97, is p_ws = {pws} kPa.',
    pwsIce: 'State {label} at {t} °C: the saturation pressure over ice, by IAPWS R14-08, is p_ws = {pws} kPa.',
    omega: 'The vapor pressure is p_v = {pv} kPa (φ = {phi} %), so the humidity ratio is ω = {omega} kg/kg.',
    enthalpy: 'The enthalpy is h = {h} kJ/kg dry air.',
    wetDew:
      'The adiabatic-saturation balance gives the wet bulb {twb} °C, p_ws(T_dp) = p_v gives the dew point ' +
      '{tdp} °C, and v = {v} m³/kg dry air.',
    sensible: 'At constant ω the energy balance is q = h₂ − h₁ = {q} kJ/kg dry air, with h₂ = {h2}.',
    dehumidify:
      'Water balance: {water} kg/kg dry air condenses and leaves as liquid with h_w = 4.186 t₂ = {hw} kJ/kg. ' +
      'Energy balance: the coil removes {q} kJ/kg dry air.',
    evaporative:
      'Evaporative cooling follows the line of constant wet bulb, {twb} °C, so the air leaves at {t2} °C and ' +
      'gains {water} kg water per kg dry air.',
    mixing:
      'Mass and energy balances weighted by the dry-air flows: ω₃ = {omega} and h₃ = {h} kJ/kg dry air, so ' +
      'T₃ = {t} °C.',
  },
  r134a: {
    liquidSide:
      'At T = {T} K the saturation pressure is {psat} kPa, and p = {p} kPa is above it: compressed liquid, so ' +
      'the largest density root of p(ρ, T) = p is used.',
    vaporSide:
      'At T = {T} K the saturation pressure is {psat} kPa, and p = {p} kPa is below it: superheated vapor, so ' +
      'the smallest density root of p(ρ, T) = p is used.',
    aboveCritical: 'T = {T} K is at or above the critical temperature, so there is one density root.',
    eos:
      'Tillner-Roth and Baehr: φ = φ° + φʳ, with 5 ideal-gas and 21 residual terms, at δ = ρ/508 kg/m³ = ' +
      '{delta} and τ = 374.18 K/T = {tau}.',
    iteration: 'Saturation step {n}: at p = {p} kPa, g_l − g_v = {dg} kJ/kg; Newton moves p by −Δg/(v_l − v_v).',
    saturation:
      'Equal pressure and Gibbs energy hold at T = {T} K and p_sat = {p} kPa, with ρ_l = {rl} and ρ_v = {rv} kg/m³.',
  },
  dev: {
    state: 'State {label}: T = {T} K, p = {p} kPa, h = {h} kJ/kg, and s = {s} kJ/(kg·K).',
    isentropic:
      'Isentropic exit: at p₂ = {p2} kPa with s₂ₛ = s₁ = {s} kJ/(kg·K), the state has T₂ₛ = {T} K and ' +
      'h₂ₛ = {h} kJ/kg.',
    etaTurbine: 'Turbine efficiency: w = η_t (h₁ − h₂ₛ) = {eta} × {ws} = {w} kJ/kg.',
    etaCompressor: 'Compressor or pump efficiency: w = (h₂ₛ − h₁)/η = {ws}/{eta} = {w} kJ/kg.',
    exitState:
      'Actual exit from the energy balance: T₂ = {T} K, h₂ = {h} kJ/kg, s₂ = {s} kJ/(kg·K), so ' +
      's_gen = s₂ − s₁ = {sgen} kJ/(kg·K).',
    power: 'With ṁ = {m} kg/s the power is Ẇ = ṁ w = {W} kW.',
    nozzle: 'Energy balance with η_N = {eta}: h₂ = {h2} kJ/kg, and V₂ = √(2(h₁ − h₂) + V₁²) = {V2} m/s.',
    diffuser: 'Energy balance: h₂ = h₁ + (V₁² − V₂²)/2 = {h2} kJ/kg, so T₂ = {T2} K at the exit pressure.',
    throttle: 'A throttle keeps h: at p₂ = {p} kPa with h₂ = h₁ = {h} kJ/kg, T₂ = {T} K and s₂ = {s} kJ/(kg·K).',
    exchanger: 'Energy balance: stream A gives Q̇ = {Q} kW, so stream B needs ṁ_B = {mB} kg/s.',
    exchangerEntropy:
      'Entropy balance: Ṡ_gen = {sgen} kW/K, so Ẋ_dest = {x} kW; stream B gains {eta} % of the exergy A gives.',
    mixing: 'Energy balance with {loss} kW lost: h₃ = {h3} kJ/kg, so T₃ = {T3} K.',
    mixingEntropy: 'Entropy balance: Ṡ_gen = {sgen} kW/K, so Ẋ_dest = T₀ Ṡ_gen = {x} kW.',
    reservoirs: 'Entropy balance for {Q} kW from {TH} K to {TL} K: Ṡ_gen = Q̇/T_L − Q̇/T_H = {sgen} kW/K.',
    exergy: 'Exergy destroyed: T₀ s_gen = {T0} × {sgen} = {x}.',
    etaII: 'Second-law efficiency: {eta} %.',
  },
  cyc: {
    fix: {
      Tp: 'State {label}: fixed by T = {T} K and p = {p} kPa, so h = {h} kJ/kg and s = {s} kJ/(kg·K).',
      px: 'State {label}: saturated at p = {p} kPa with x = {x}, so T = {T} K, h = {h} kJ/kg, and s = {s} kJ/(kg·K).',
      ps: 'State {label}: fixed by p = {p} kPa and s = {s} kJ/(kg·K), so T = {T} K and h = {h} kJ/kg.',
      ph:
        'State {label}: fixed by p = {p} kPa and h = {h} kJ/kg from the energy balance after state {from}, so ' +
        'T = {T} K and s = {s} kJ/(kg·K).',
      Tv:
        'State {label}: heated at constant volume, v = {v} m³/kg, to T = {T} K, so p = {p} kPa, h = {h} kJ/kg, ' +
        'and s = {s} kJ/(kg·K).',
      sv:
        'State {label}: isentropic from state {from} to v = {v} m³/kg, so T = {T} K, p = {p} kPa, and ' +
        'h = {h} kJ/kg.',
      quality: 'State {label} is a saturated mixture with quality x = {x}.',
    },
    heatV: 'Heat added at constant volume: q = {q} kJ/kg.',
    heatP: 'Heat added at constant pressure: q = {q} kJ/kg.',
    rejectV: 'Heat rejected at constant volume: q_out = u₄ − u₁ = {q} kJ/kg.',
    totals: 'Totals: w_net = {w} kJ/kg, q_in = {qin} kJ/kg, and q_out = {qout} kJ/kg, so η_th = {eta} %.',
    mep: 'Mean effective pressure: MEP = {mep} kPa.',
    intercool: 'Intercooler: back to T₁ at constant pressure, rejecting {q} kJ/kg.',
    compressor: 'Compressor: the isentropic work is {ws} kJ/kg, so w_c = w_s/η_c = {w} kJ/kg.',
    regenerator:
      'Regenerator with effectiveness {eps}: the air takes q = ε (h_exhaust − h_compressor exit) = {q} kJ/kg ' +
      'from the exhaust, and the exhaust gives the same back.',
    combustor: 'Heat added at constant pressure (combustor or reheater): q = {q} kJ/kg.',
    turbine: 'Turbine: w_t = {w} kJ/kg.',
    cooler: 'Heat rejected at constant pressure, back to state 1: q = {q} kJ/kg.',
    bwr: 'Back work ratio: r_bw = w_c/w_t = {bwr}.',
    carnot: 'Carnot limits: η = {eta} %, COP_R = {copR}, and COP_HP = {copHP}.',
    mass: 'For Ẇ_net = {W} kW the mass flow is ṁ = {m} kg/s, and the heat input is Q̇_in = {Q} kW.',
    pump: 'Pump: w_p = {w} kJ/kg.',
    boiler: 'Boiler: q_in = {q} kJ/kg.',
    reheat: 'Reheater: q = {q} kJ/kg.',
    fwhOpen: 'Open feedwater heater: the energy balance with a fraction y extracted from the turbine gives y = {y}.',
    fwhClosed: 'Closed feedwater heater: the energy balance gives y = {y}; the drain is throttled to the condenser.',
    condenser: 'Condenser: q_out = {q} kJ/kg.',
    valve: 'Expansion valve: h₄ = h₃ = {h} kJ/kg, so x₄ = {x}.',
    evaporator: 'Evaporator: q_L = h₁ − h₄ = {q} kJ/kg.',
    cop: 'COP_R = q_L/w_in = {cop}, and as a heat pump COP_HP = q_H/w_in = {hp}.',
    load: 'For a cooling load of {Q} kW: ṁ = {m} kg/s and Ẇ_in = {W} kW.',
  },
  eos: {
    reduced: 'Reduced properties: T_r = T/T_c = {Tr} and p_r = p/p_c = {pr}.',
    reducedTv: 'Reduced temperature T_r = T/T_c = {Tr}; the molar volume is {vm} m³/mol.',
    constants: {
      vdw:
        'Van der Waals constants from the critical point: a = 27R²T_c²/(64p_c) = {a} Pa·m⁶/mol² and ' +
        'b = RT_c/(8p_c) = {b} m³/mol.',
      rk: 'Redlich-Kwong: a = 0.42748 R²T_c²/(p_c √T_r) = {a} Pa·m⁶/mol² and b = 0.08664 RT_c/p_c = {b} m³/mol.',
      srk:
        'Soave-Redlich-Kwong: κ = 0.480 + 1.574ω − 0.176ω² = {kappa}, α = [1 + κ(1 − √T_r)]² = {alpha}, ' +
        'a = 0.42748 R²T_c²α/p_c = {a} Pa·m⁶/mol², and b = 0.08664 RT_c/p_c = {b} m³/mol.',
      pr:
        'Peng-Robinson: κ = 0.37464 + 1.54226ω − 0.26992ω² = {kappa}, α = [1 + κ(1 − √T_r)]² = {alpha}, ' +
        'a = 0.45724 R²T_c²α/p_c = {a} Pa·m⁶/mol², and b = 0.07780 RT_c/p_c = {b} m³/mol.',
    },
    dimensionless: 'In dimensionless form: A = {A} and B = {B}.',
    cubic: 'Written for Z = pv/(RT), the equation becomes this cubic.',
    roots1: 'It has one real root above B: Z = {roots}.',
    roots3: 'It has three real roots above B: {roots}. The middle one is never a stable state.',
    why: {
      only: 'With one real root there is no choice to make.',
      stableGas: 'The gas-like root has the lower fugacity (ln φ = {gas} against {liquid}), so it is the stable phase.',
      stableLiquid:
        'The liquid-like root has the lower fugacity (ln φ = {liquid} against {gas}), so it is the stable phase.',
      asked: 'Using the root you picked, Z = {Z}; the stable one by fugacity is Z = {stable}.',
    },
    volume:
      'Volume: v = ZRT/p = {vm} m³/mol, or {v} m³/kg with M = {M} g/mol. An ideal gas would take {vi} m³/kg, ' +
      'an error of {err} %.',
    pressure:
      'The pressure comes straight from the equation: p = {p} kPa, so Z = pv/(RT) = {Z}. An ideal gas would ' +
      'be at {pi} kPa.',
    departure:
      'Departures from an ideal gas at the same T and p: h − h* = {h} kJ/kg and s − s* = {s} kJ/(kg·K); as chart ' +
      'factors, Z_h = {zh} and Z_s = {zs}.',
    fugacity: 'Fugacity coefficient φ = {phi}, so the fugacity is f = φp = {f} kPa.',
  },
  mix: {
    moles: 'Moles of each gas, N = m/M, give the mole fractions: {list}.',
    masses: 'Mass of each gas, m = NM, gives the mass fractions: {list}.',
    M: 'Apparent molar mass M = Σ yᵢMᵢ = {M} g/mol, so R = R_u/M = {R} kJ/(kg·K).',
    cp:
      'Specific heats at {T} K from the NASA polynomials, weighted by mass: cp = {cp} and cv = cp − R = {cv} ' +
      'kJ/(kg·K), so k = {k}.',
    dalton: 'Dalton: each gas alone in the whole volume at T exerts pᵢ = yᵢp: {list}.',
    amagat:
      'Amagat: each gas alone at T and p would fill Vᵢ = yᵢV, so volume fractions equal mole fractions; the ' +
      'mixture has v = RT/p = {v} m³/kg.',
    entropy: 'Mixing the separate gases at the same T and p generates Δs = −R Σ yᵢ ln yᵢ = {ds} kJ/(kg·K).',
    kay: 'Kay’s rule: T_c′ = Σ yᵢT_c,ᵢ = {Tc} K, p_c′ = Σ yᵢp_c,ᵢ = {pc} kPa, and ω′ = {omega}.',
    real:
      'Peng-Robinson with those pseudo-critical constants gives Z = {Z}, so v = {v} m³/kg, {err} % from the ' +
      'ideal mixture.',
  },
};
