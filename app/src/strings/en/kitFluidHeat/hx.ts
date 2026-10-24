// The words of the hx tool: fields, choices, results, notes, and worked steps.
export const hx = {
  title: 'Heat exchangers',
  keywords:
    'heat exchanger effectiveness ntu lmtd log mean temperature difference counterflow parallel ' +
    'flow shell and tube cross flow condenser overall coefficient area sizing rating',
  field: {
    mode: 'Problem',
    type: 'Flow arrangement',
    lmtdType: 'Flow arrangement',
    hotPhase: 'Hot stream',
    mh: 'Hot stream mass flow rate',
    cph: 'Hot stream specific heat',
    coldPhase: 'Cold stream',
    mc: 'Cold stream mass flow rate',
    cpc: 'Cold stream specific heat',
    thIn: 'Hot inlet temperature',
    tcIn: 'Cold inlet temperature',
    ua: 'Conductance, UA (optional if U and the area are given)',
    area: 'Heat transfer area, A (optional, with U)',
    u: 'Overall coefficient, U (optional)',
    duty: 'Heat duty, q (optional)',
    thOut: 'Hot outlet temperature (optional)',
    tcOut: 'Cold outlet temperature (optional)',
    thOutL: 'Hot outlet temperature',
    tcOutL: 'Cold outlet temperature',
    dutyL: 'Heat duty, q',
  },
  option: {
    rate: 'Rating: outlets from UA (effectiveness-NTU)',
    size: 'Sizing: UA for a duty or an outlet temperature',
    lmtd: 'Log-mean temperature difference from four temperatures',
    counter: 'Counterflow (double pipe)',
    parallel: 'Parallel flow',
    shell: 'One shell pass with two or more tube passes',
    crossUnmixed: 'Cross flow, both streams unmixed',
    crossCmaxMixed: 'Cross flow, the larger-capacity stream mixed',
    crossCminMixed: 'Cross flow, the smaller-capacity stream mixed',
    liquid: 'Changes temperature',
    change: 'Boils or condenses at a constant temperature',
  },
  example: {
    rate: 'Hot water cooling cold water in a counterflow exchanger',
    shell: 'The same duty in a shell-and-tube exchanger',
    size: 'The area needed to cool the hot water to 90 °C',
    condenser: 'A condenser warming water',
    lmtd: 'The area from four temperatures in a shell-and-tube exchanger',
  },
  row: {
    heat: 'Heat transfer rate, q',
    thOut: 'Hot outlet temperature',
    tcOut: 'Cold outlet temperature',
    effectiveness: 'Effectiveness, ε',
    ntu: 'Number of transfer units, NTU',
    ua: 'Conductance, UA',
    cr: 'Capacity ratio, Cr = Cmin / Cmax',
    lmtd: 'Log-mean temperature difference',
    correction: 'Correction factor, F',
    area: 'Heat transfer area, A',
    p: 'Temperature effectiveness, P',
    r: 'Capacity ratio, R',
  },
  note: {
    exchanger:
      'Steady operation with constant specific heats and a constant overall coefficient, and no heat ' +
      'lost to the surroundings.',
    limits:
      'The cross-flow relation for both streams unmixed is an accepted approximation. A stream that ' +
      'boils or condenses has an unlimited heat capacity rate.',
    sizing: 'The area is found from UA and the overall coefficient U, so give U to get an area.',
    lmtdMethod:
      'The correction factor F lowers the counterflow log-mean difference for a shell-and-tube ' +
      'exchanger. A very small F means the exchanger cannot do this job.',
  },
  plot: { length: 'Fraction of the length', temperature: 'Temperature', hot: 'Hot stream', cold: 'Cold stream' },
  picture: 'The hot and cold stream temperatures along the exchanger',
} as const;

export const hxStep = {
  fhHxCapacity: 'The smaller capacity rate is Cmin = {cmin} W/K, the larger is {cmax} W/K, so Cr = {cr}.',
  fhHxNtu: 'The number of transfer units is NTU = {ntu}.',
  fhHxNtuInverse: 'The duty needs an effectiveness of {eps}, which means NTU = {ntu} for this arrangement.',
  fhHxEps: 'The effectiveness of this arrangement is ε = {eps}.',
  fhHxQ: 'The heat transfer rate is q = {q} W.',
  fhHxOutlets: 'The outlet temperatures are {th} K (hot) and {tc} K (cold).',
  fhHxLmtd: 'The log-mean temperature difference is {lmtd} K and the correction factor is F = {f}.',
  fhHxDiffs: 'The temperature differences at the two ends are {d1} K and {d2} K.',
  fhHxLmtdOnly: 'Their log-mean is {lmtd} K.',
  fhHxFactor: 'With P = {p} and R = {r}, the shell-and-tube correction factor is F = {f}.',
  fhHxUa: 'The conductance is UA = {ua} W/K.',
} as const;
