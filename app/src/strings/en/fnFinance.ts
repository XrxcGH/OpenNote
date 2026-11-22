// checks-disable-file ui-voice: function names are spelled in capitals, as formulas write them.
// Descriptions of the financial functions and their day-count bases, one line per function, and one per argument,
// written fresh in American English. Owner: tables:fn-finance (B11). Keys are function names in capitals and
// argument names as in the signature.

export interface FnText {
  readonly summary: string;
  readonly args: Readonly<Record<string, string>>;
}

const basis =
  'How days are counted: 0 or left out is US 30/360, 1 actual/actual, 2 actual/360, 3 actual/365, 4 European 30/360.';
const settlement = 'The date the buyer gets the security, after it was issued.';
const maturity = 'The date the security ends and is paid back.';
const frequency = 'Coupons a year: 1 yearly, 2 every half year, 4 every quarter.';
const rate = 'The interest rate per period.';
const nper = 'The number of payment periods.';
const pmt = 'The payment each period. Money paid out is negative.';
const pv = 'The present value: what the payments are worth now.';
const fv = 'The future value wanted after the last payment. It is 0 when left out.';
const type = 'When payments are due: 0 or left out at the end of each period, 1 at the start.';
const per = 'The period to look at, from 1 to the number of periods.';
const redemption = 'What the security pays back per 100 of face value.';
const yld = 'The yearly yield.';
const pr = 'The price per 100 of face value.';
const couponRate = 'The yearly coupon rate.';
const issue = 'The date the security was issued.';
const cost = 'What the asset cost.';
const salvage = 'What the asset is worth at the end of its life.';
const life = 'How many periods the asset is used.';
const discount = 'The discount rate.';
const investment = 'The amount invested.';
const coupons = { settlement, maturity, frequency, basis };
const amor = {
  cost,
  date_purchased: 'The date the asset was bought.',
  first_period: 'The date the first period ends.',
  salvage,
  period: 'The period to look at. 0 is the first, partial period.',
  rate: 'The yearly depreciation rate.',
  basis,
};

export const fnFinance = {
  ACCRINT: {
    summary: 'The interest a bond with regular coupons has earned but not yet paid.',
    args: {
      issue,
      first_interest: 'The date of the first coupon.',
      settlement,
      rate: couponRate,
      par: 'The face value of the bond.',
      frequency,
      basis,
      calc_method:
        'TRUE or left out counts from the issue date; FALSE counts from the first coupon once it has passed.',
    },
  },
  ACCRINTM: {
    summary: 'The interest earned by a security that pays all its interest at maturity.',
    args: {
      issue,
      settlement: 'The date the interest is counted to.',
      rate: couponRate,
      par: 'The face value.',
      basis,
    },
  },
  AMORDEGRC: {
    summary: 'Depreciation for a period by the French declining method, with a coefficient set by the life.',
    args: amor,
  },
  AMORLINC: { summary: 'Depreciation for a period by the French straight-line method.', args: amor },
  COUPDAYBS: { summary: 'Days from the start of the coupon period to settlement.', args: coupons },
  COUPDAYS: { summary: 'Days in the coupon period that holds settlement.', args: coupons },
  COUPDAYSNC: { summary: 'Days from settlement to the next coupon date.', args: coupons },
  COUPNCD: { summary: 'The next coupon date after settlement.', args: coupons },
  COUPNUM: { summary: 'How many coupons are paid from settlement to maturity.', args: coupons },
  COUPPCD: { summary: 'The coupon date on or before settlement.', args: coupons },
  CUMIPMT: {
    summary: 'The interest paid on a loan from one period to another.',
    args: {
      rate,
      nper,
      pv,
      start_period: 'The first period counted.',
      end_period: 'The last period counted.',
      type: 'When payments are due: 0 at the end of each period, 1 at the start.',
    },
  },
  CUMPRINC: {
    summary: 'The principal paid on a loan from one period to another.',
    args: {
      rate,
      nper,
      pv,
      start_period: 'The first period counted.',
      end_period: 'The last period counted.',
      type: 'When payments are due: 0 at the end of each period, 1 at the start.',
    },
  },
  DB: {
    summary: 'Depreciation for a period by the fixed declining balance method.',
    args: {
      cost,
      salvage,
      life,
      period: 'The period to look at.',
      month: 'Months in the first year. It is 12 when left out.',
    },
  },
  DDB: {
    summary: 'Depreciation for a period by the double declining balance method, or another factor.',
    args: {
      cost,
      salvage,
      life,
      period: 'The period to look at.',
      factor: 'How fast the balance declines. It is 2 when left out.',
    },
  },
  DISC: {
    summary: 'The discount rate of a security.',
    args: { settlement, maturity, pr, redemption, basis },
  },
  DOLLARDE: {
    summary: 'Turns a price written as a fraction, such as 1.02 for 1 and 2/16, into a decimal number.',
    args: {
      fractional_dollar: 'The price, with the numerator after the decimal point.',
      fraction: 'The denominator of the fraction.',
    },
  },
  DOLLARFR: {
    summary: 'Turns a decimal price into one written as a fraction, such as 1.125 into 1.02 for 1 and 2/16.',
    args: { decimal_dollar: 'The decimal price.', fraction: 'The denominator of the fraction.' },
  },
  DURATION: {
    summary: 'The Macaulay duration of a bond in years: the average time to its payments, weighted by their value.',
    args: { settlement, maturity, coupon: couponRate, yld, frequency, basis },
  },
  EFFECT: {
    summary: 'The yearly effective rate of a nominal rate compounded several times a year.',
    args: { nominal_rate: 'The nominal yearly rate.', npery: 'How many times a year interest is compounded.' },
  },
  FV: {
    summary: 'What an investment is worth after regular payments at a fixed rate.',
    args: { rate, nper, pmt, pv: 'The value now. It is 0 when left out.', type },
  },
  FVSCHEDULE: {
    summary: 'What an amount grows to under a series of rates, one per period.',
    args: { principal: 'The amount at the start.', schedule: 'The rates, one for each period.' },
  },
  INTRATE: {
    summary: 'The interest rate of a fully invested security.',
    args: { settlement, maturity, investment, redemption: 'What is paid back at maturity.', basis },
  },
  IPMT: {
    summary: 'The interest part of one payment on a loan or investment.',
    args: { rate, per, nper, pv, fv, type },
  },
  IRR: {
    summary: 'The internal rate of return of cash flows one period apart.',
    args: {
      values: 'The cash flows, with at least one payment and one receipt.',
      guess: 'A rate to start from. It is 0.1 when left out.',
    },
  },
  ISPMT: {
    summary: 'The interest paid in one period of a loan repaid in equal parts of principal.',
    args: { rate, per: 'The period to look at, counted from 0.', nper, pv },
  },
  MDURATION: {
    summary: 'The modified duration of a bond: the Macaulay duration divided by one plus the yield per period.',
    args: { settlement, maturity, coupon: couponRate, yld, frequency, basis },
  },
  MIRR: {
    summary: 'The rate of return when payments are financed at one rate and receipts reinvested at another.',
    args: {
      values: 'The cash flows, one period apart.',
      finance_rate: 'The rate paid on the money borrowed.',
      reinvest_rate: 'The rate earned on the money reinvested.',
    },
  },
  NOMINAL: {
    summary: 'The nominal yearly rate that gives an effective rate.',
    args: { effect_rate: 'The effective yearly rate.', npery: 'How many times a year interest is compounded.' },
  },
  NPER: {
    summary: 'How many periods regular payments take at a fixed rate.',
    args: { rate, pmt, pv, fv, type },
  },
  NPV: {
    summary: 'The net present value of cash flows one period apart, the first one period from now.',
    args: { rate: 'The discount rate per period.', value: 'The cash flows, in order.' },
  },
  ODDFPRICE: {
    summary: 'The price of a bond whose first period is shorter or longer than the others.',
    args: {
      settlement,
      maturity,
      issue,
      first_coupon: 'The date of the first coupon.',
      rate: couponRate,
      yld,
      redemption,
      frequency,
      basis,
    },
  },
  ODDFYIELD: {
    summary: 'The yield of a bond whose first period is shorter or longer than the others.',
    args: {
      settlement,
      maturity,
      issue,
      first_coupon: 'The date of the first coupon.',
      rate: couponRate,
      pr,
      redemption,
      frequency,
      basis,
    },
  },
  ODDLPRICE: {
    summary: 'The price of a bond whose last period is shorter or longer than the others.',
    args: {
      settlement,
      maturity,
      last_interest: 'The date of the last coupon.',
      rate: couponRate,
      yld,
      redemption,
      frequency,
      basis,
    },
  },
  ODDLYIELD: {
    summary: 'The yield of a bond whose last period is shorter or longer than the others.',
    args: {
      settlement,
      maturity,
      last_interest: 'The date of the last coupon.',
      rate: couponRate,
      pr,
      redemption,
      frequency,
      basis,
    },
  },
  PDURATION: {
    summary: 'How many periods an investment takes to reach a value at a fixed rate.',
    args: { rate, pv: 'The value now.', fv: 'The value wanted.' },
  },
  PMT: {
    summary: 'The regular payment of a loan or investment at a fixed rate.',
    args: { rate, nper, pv, fv, type },
  },
  PPMT: {
    summary: 'The principal part of one payment on a loan or investment.',
    args: { rate, per, nper, pv, fv, type },
  },
  PRICE: {
    summary: 'The price per 100 of face value of a bond that pays regular coupons.',
    args: { settlement, maturity, rate: couponRate, yld, redemption, frequency, basis },
  },
  PRICEDISC: {
    summary: 'The price per 100 of face value of a discounted security.',
    args: { settlement, maturity, discount, redemption, basis },
  },
  PRICEMAT: {
    summary: 'The price per 100 of face value of a security that pays its interest at maturity.',
    args: { settlement, maturity, issue, rate: couponRate, yld, basis },
  },
  PV: {
    summary: 'What a series of future payments is worth now.',
    args: { rate, nper, pmt, fv, type },
  },
  RATE: {
    summary: 'The interest rate per period of a loan or investment.',
    args: { nper, pmt, pv, fv, type, guess: 'A rate to start from. It is 0.1 when left out.' },
  },
  RECEIVED: {
    summary: 'What a fully invested security pays at maturity.',
    args: { settlement, maturity, investment, discount, basis },
  },
  RRI: {
    summary: 'The rate per period that grows a present value to a future value.',
    args: { nper, pv: 'The value now.', fv: 'The value wanted.' },
  },
  SLN: {
    summary: 'Straight-line depreciation for one period.',
    args: { cost, salvage, life },
  },
  SYD: {
    summary: "Sum-of-years' digits depreciation for a period.",
    args: { cost, salvage, life, per: 'The period to look at.' },
  },
  TBILLEQ: {
    summary: 'The bond-equivalent yield of a Treasury bill.',
    args: { settlement, maturity: 'The date the bill ends, within a year of settlement.', discount },
  },
  TBILLPRICE: {
    summary: 'The price per 100 of face value of a Treasury bill.',
    args: { settlement, maturity: 'The date the bill ends, within a year of settlement.', discount },
  },
  TBILLYIELD: {
    summary: 'The yield of a Treasury bill.',
    args: { settlement, maturity: 'The date the bill ends, within a year of settlement.', pr },
  },
  VDB: {
    summary:
      'Declining balance depreciation over any span of periods, switching to straight line when that gives more.',
    args: {
      cost,
      salvage,
      life,
      start_period: 'Where the span starts. It may be part of a period.',
      end_period: 'Where the span ends.',
      factor: 'How fast the balance declines. It is 2 when left out.',
      no_switch: 'TRUE keeps the declining balance and never switches to straight line.',
    },
  },
  XIRR: {
    summary: 'The internal rate of return of cash flows on given dates, a year being 365 days.',
    args: {
      values: 'The cash flows, with at least one payment and one receipt.',
      dates: 'The date of each flow. None may come before the first.',
      guess: 'A rate to start from. It is 0.1 when left out.',
    },
  },
  XNPV: {
    summary: 'The net present value of cash flows on given dates, a year being 365 days.',
    args: {
      rate: 'The yearly discount rate.',
      values: 'The cash flows.',
      dates: 'The date of each flow. None may come before the first.',
    },
  },
  YIELD: {
    summary: 'The yield of a bond that pays regular coupons.',
    args: { settlement, maturity, rate: couponRate, pr, redemption, frequency, basis },
  },
  YIELDDISC: {
    summary: 'The yearly yield of a discounted security.',
    args: { settlement, maturity, pr, redemption, basis },
  },
  YIELDMAT: {
    summary: 'The yearly yield of a security that pays its interest at maturity.',
    args: { settlement, maturity, issue, rate: couponRate, pr, basis },
  },
} as const satisfies Record<string, FnText>;
