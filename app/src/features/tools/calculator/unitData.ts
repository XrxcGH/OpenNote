// The unit table. Each row is [symbol, factor, ...names]. The factor converts one of the unit to the category's
// base unit. Names can be typed in any case, and an "s" plural is added for each. Symbols are case-sensitive first,
// because "MB" (megabyte) and "Mb" (megabit) differ. The mmHg is the torr, so 1 atm is 760 mmHg. Currency is left
// out, since rates need the network.

export type UnitCategory =
  | 'length'
  | 'mass'
  | 'time'
  | 'temperature'
  | 'area'
  | 'volume'
  | 'speed'
  | 'pressure'
  | 'energy'
  | 'power'
  | 'angle'
  | 'data'
  | 'force'
  | 'frequency'
  | 'density'
  | 'torque'
  | 'fuel'
  | 'current'
  | 'voltage'
  | 'resistance';

export type UnitRow = readonly [symbol: string, factor: number, ...names: string[]];

/**
 * Base units: meter, kilogram, second, kelvin, square meter, liter, meter per second, pascal, joule, watt, radian,
 * byte. A horsepower is the mechanical one (550 ft·lbf per second), and PS is the metric one (75 kgf·m per second).
 */
export const UNIT_ROWS: Record<Exclude<UnitCategory, 'temperature'>, readonly UnitRow[]> = {
  length: [
    ['nm', 1e-9, 'nanometer', 'nanometre'],
    ['µm', 1e-6, 'um', 'μm', 'micron', 'micrometer', 'micrometre'],
    ['mm', 0.001, 'millimeter', 'millimetre'],
    ['cm', 0.01, 'centimeter', 'centimetre'],
    ['m', 1, 'meter', 'metre'],
    ['km', 1000, 'kilometer', 'kilometre'],
    ['in', 0.0254, 'inch', 'inches'],
    ['ft', 0.3048, 'foot', 'feet'],
    ['yd', 0.9144, 'yard'],
    ['mi', 1609.344, 'mile'],
    ['nmi', 1852, 'nautical mile'],
    ['au', 149597870700, 'astronomical unit'],
    ['ly', 9460730472580800, 'light year', 'light-year', 'lightyear'],
  ],
  mass: [
    ['µg', 1e-9, 'ug', 'μg', 'microgram'],
    ['mg', 1e-6, 'milligram'],
    ['g', 0.001, 'gram'],
    ['kg', 1, 'kilogram', 'kilo'],
    ['t', 1000, 'tonne', 'metric ton'],
    ['oz', 0.028349523125, 'ounce'],
    ['lb', 0.45359237, 'lbs', 'pound'],
    ['st', 6.35029318, 'stone'],
    ['ton', 907.18474, 'short ton', 'us ton'],
  ],
  time: [
    ['ns', 1e-9, 'nanosecond'],
    ['µs', 1e-6, 'us', 'μs', 'microsecond'],
    ['ms', 0.001, 'millisecond'],
    ['s', 1, 'sec', 'second'],
    ['min', 60, 'minute'],
    ['h', 3600, 'hr', 'hour'],
    ['d', 86400, 'day'],
    ['wk', 604800, 'week'],
    ['mo', 2629800, 'month'],
    ['yr', 31557600, 'y', 'year'],
  ],
  area: [
    ['mm²', 1e-6, 'mm2', 'sq mm', 'square millimeter'],
    ['cm²', 1e-4, 'cm2', 'sq cm', 'square centimeter'],
    ['m²', 1, 'm2', 'sq m', 'sqm', 'square meter'],
    ['km²', 1e6, 'km2', 'sq km', 'square kilometer'],
    ['ha', 1e4, 'hectare'],
    ['in²', 0.00064516, 'in2', 'sq in', 'square inch', 'square inches'],
    ['ft²', 0.09290304, 'ft2', 'sq ft', 'sqft', 'square foot', 'square feet'],
    ['yd²', 0.83612736, 'yd2', 'sq yd', 'square yard'],
    ['mi²', 2589988.110336, 'mi2', 'sq mi', 'square mile'],
    ['ac', 4046.8564224, 'acre'],
  ],
  volume: [
    ['mL', 0.001, 'ml', 'cc', 'cm³', 'cm3', 'milliliter', 'millilitre'],
    ['L', 1, 'l', 'liter', 'litre'],
    ['m³', 1000, 'm3', 'cubic meter'],
    ['tsp', 0.00492892159375, 'teaspoon'],
    ['tbsp', 0.01478676478125, 'tablespoon'],
    ['fl oz', 0.0295735295625, 'floz', 'fluid ounce'],
    ['cup', 0.2365882365],
    ['pt', 0.473176473, 'pint'],
    ['qt', 0.946352946, 'quart'],
    ['gal', 3.785411784, 'gallon'],
    ['in³', 0.016387064, 'in3', 'cubic inch', 'cubic inches'],
    ['ft³', 28.316846592, 'ft3', 'cubic foot', 'cubic feet'],
  ],
  speed: [
    ['m/s', 1, 'mps', 'meter per second'],
    ['km/h', 1 / 3.6, 'kph', 'kmh', 'kilometer per hour'],
    ['mph', 0.44704, 'mi/h', 'mile per hour'],
    ['ft/s', 0.3048, 'fps', 'foot per second', 'feet per second'],
    ['kn', 1852 / 3600, 'kt', 'knot'],
  ],
  pressure: [
    ['Pa', 1, 'pascal'],
    ['hPa', 100, 'hectopascal'],
    ['kPa', 1000, 'kilopascal'],
    ['MPa', 1e6, 'megapascal'],
    ['bar', 1e5],
    ['mbar', 100, 'millibar'],
    ['atm', 101325, 'atmosphere'],
    ['psi', 6894.757293168, 'pound per square inch'],
    ['mmHg', 101325 / 760],
    ['torr', 101325 / 760],
    ['inHg', 3386.389],
  ],
  energy: [
    ['J', 1, 'joule'],
    ['kJ', 1000, 'kilojoule'],
    ['MJ', 1e6, 'megajoule'],
    ['cal', 4.184, 'calorie'],
    ['kcal', 4184, 'Cal', 'kilocalorie', 'food calorie'],
    ['Wh', 3600, 'watt hour'],
    ['kWh', 3.6e6, 'kilowatt hour'],
    ['eV', 1.602176634e-19, 'electronvolt'],
    ['BTU', 1055.05585262, 'btu'],
    ['ft·lbf', 1.3558179483314, 'ft-lb', 'ftlb', 'foot pound'],
    ['erg', 1e-7],
  ],
  power: [
    ['mW', 0.001, 'milliwatt'],
    ['W', 1, 'watt'],
    ['kW', 1000, 'kilowatt'],
    ['MW', 1e6, 'megawatt'],
    ['GW', 1e9, 'gigawatt'],
    ['hp', 745.69987158227, 'horsepower'],
    ['PS', 735.49875, 'metric horsepower'],
    ['BTU/h', 0.29307107017, 'btu/h', 'btu per hour'],
  ],
  angle: [
    ['arcsec', Math.PI / 648000, 'arcsecond', 'arc second'],
    ['arcmin', Math.PI / 10800, 'arcminute', 'arc minute'],
    ['deg', Math.PI / 180, '°', 'degree'],
    ['grad', Math.PI / 200, 'gon', 'gradian'],
    ['rad', 1, 'radian'],
    ['turn', 2 * Math.PI, 'revolution', 'rev', 'cycle'],
  ],
  data: [
    ['bit', 0.125, 'b'],
    ['B', 1, 'byte'],
    ['kb', 125, 'Kb', 'kbit', 'kilobit'],
    ['Mb', 125000, 'Mbit', 'megabit'],
    ['Gb', 1.25e8, 'Gbit', 'gigabit'],
    ['Tb', 1.25e11, 'Tbit', 'terabit'],
    ['kB', 1e3, 'KB', 'kilobyte'],
    ['MB', 1e6, 'megabyte'],
    ['GB', 1e9, 'gigabyte'],
    ['TB', 1e12, 'terabyte'],
    ['PB', 1e15, 'petabyte'],
    ['KiB', 1024, 'kibibyte'],
    ['MiB', 1048576, 'mebibyte'],
    ['GiB', 1073741824, 'gibibyte'],
    ['TiB', 1099511627776, 'tebibyte'],
    ['PiB', 1125899906842624, 'pebibyte'],
  ],
  force: [
    ['dyn', 1e-5, 'dyne'],
    ['mN', 0.001, 'millinewton'],
    ['N', 1, 'newton'],
    ['kN', 1000, 'kilonewton'],
    ['ozf', 0.27801385095, 'ounce-force'],
    ['lbf', 4.4482216152605, 'pound-force'],
    ['kgf', 9.80665, 'kilogram-force'],
  ],
  frequency: [
    ['mHz', 0.001, 'millihertz'],
    ['Hz', 1, 'hertz'],
    ['kHz', 1e3, 'kilohertz'],
    ['MHz', 1e6, 'megahertz'],
    ['GHz', 1e9, 'gigahertz'],
    ['THz', 1e12, 'terahertz'],
    ['rpm', 1 / 60, 'revolutions per minute'],
    ['rad/s', 1 / (2 * Math.PI), 'radian per second'],
  ],
  density: [
    ['kg/m³', 1, 'kg/m3', 'kilogram per cubic meter'],
    ['g/L', 1, 'g/l', 'gram per liter'],
    ['g/cm³', 1000, 'g/cm3', 'g/mL', 'gram per cubic centimeter'],
    ['kg/L', 1000, 'kg/l', 'kilogram per liter'],
    ['lb/ft³', 16.01846337396, 'lb/ft3', 'pound per cubic foot'],
    ['lb/in³', 27679.9047102, 'lb/in3', 'pound per cubic inch'],
    ['lb/gal', 119.8264273, 'pound per gallon'],
    ['oz/in³', 1729.994044, 'oz/in3', 'ounce per cubic inch'],
  ],
  torque: [
    ['dyn·cm', 1e-7, 'dyne centimeter'],
    ['ozf·in', 0.00706155181, 'oz-in', 'ounce-force inch'],
    ['mN·m', 0.001, 'millinewton meter'],
    ['N·m', 1, 'Nm', 'N-m', 'newton meter', 'newton-meter'],
    ['kN·m', 1000, 'kNm', 'kilonewton meter'],
    ['lbf·in', 0.1129848290276, 'in-lb', 'pound-force inch'],
    ['lbf·ft', 1.3558179483314, 'lb-ft', 'lbft', 'pound-force foot'],
    ['kgf·m', 9.80665, 'kilogram-force meter'],
  ],
  fuel: [
    ['L/100km', 1, 'l/100km', 'liters per 100 kilometers', 'litres per 100 kilometres'],
    ['km/L', 1, 'km/l', 'kilometer per liter', 'kilometre per litre'],
    ['mi/L', 1.609344, 'mile per liter'],
    ['mpg', 0.425143707, 'mpg us', 'mile per gallon', 'miles per gallon'],
    ['mpg UK', 0.354006189, 'mpg imp', 'imperial mile per gallon'],
  ],
  current: [
    ['µA', 1e-6, 'uA', 'μA', 'microampere', 'microamp'],
    ['mA', 0.001, 'milliampere', 'milliamp'],
    ['A', 1, 'amp', 'ampere'],
    ['kA', 1000, 'kiloampere', 'kiloamp'],
  ],
  voltage: [
    ['µV', 1e-6, 'uV', 'μV', 'microvolt'],
    ['mV', 0.001, 'millivolt'],
    ['V', 1, 'volt'],
    ['kV', 1000, 'kilovolt'],
    ['MV', 1e6, 'megavolt'],
  ],
  resistance: [
    ['mΩ', 0.001, 'milliohm', 'mohm'],
    ['Ω', 1, 'ohm', 'Ohm'],
    ['kΩ', 1000, 'kohm', 'kiloohm', 'kilohm'],
    ['MΩ', 1e6, 'megohm', 'megaohm', 'Mohm'],
  ],
};

/** Temperature units convert through kelvin with an offset, so they have no single factor. */
export const TEMPERATURE_ROWS: readonly (readonly [symbol: string, ...names: string[]])[] = [
  ['C', '°C', 'degC', 'celsius', 'centigrade'],
  ['F', '°F', 'degF', 'fahrenheit'],
  ['K', 'kelvin'],
  ['R', '°R', 'degR', 'rankine'],
];
