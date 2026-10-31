// The 2000 US standard population, used to age-adjust rates directly. It is public domain, from the National Center
// for Health Statistics: "Age adjustment using the 2000 projected U.S. population" by Klein and Schoenborn, Healthy
// People 2010 Statistical Notes no. 20 (2001), tables 1 and 2.
export const STANDARD_SOURCE =
  'US 2000 standard population: National Center for Health Statistics, Healthy People 2010 Statistical Notes no. 20 (2001), public domain.';

export interface StandardGroup {
  readonly label: string;
  readonly population: number;
}

/** The 11 age groups (table 2 of the note). */
export const US2000_11: readonly StandardGroup[] = [
  { label: 'Under 1', population: 3_794_901 },
  { label: '1–4', population: 15_191_619 },
  { label: '5–14', population: 39_976_619 },
  { label: '15–24', population: 38_076_743 },
  { label: '25–34', population: 37_233_437 },
  { label: '35–44', population: 44_659_185 },
  { label: '45–54', population: 37_030_152 },
  { label: '55–64', population: 23_961_506 },
  { label: '65–74', population: 18_135_514 },
  { label: '75–84', population: 12_314_793 },
  { label: '85 and over', population: 4_259_173 },
];

/** The 19 age groups (table 1 of the note): under 1, 1–4, then 5-year groups to 85 and over. */
export const US2000_19: readonly StandardGroup[] = [
  { label: 'Under 1', population: 3_794_901 },
  { label: '1–4', population: 15_191_619 },
  { label: '5–9', population: 19_919_840 },
  { label: '10–14', population: 20_056_779 },
  { label: '15–19', population: 19_819_518 },
  { label: '20–24', population: 18_257_225 },
  { label: '25–29', population: 17_722_067 },
  { label: '30–34', population: 19_511_370 },
  { label: '35–39', population: 22_179_956 },
  { label: '40–44', population: 22_479_229 },
  { label: '45–49', population: 19_805_793 },
  { label: '50–54', population: 17_224_359 },
  { label: '55–59', population: 13_307_234 },
  { label: '60–64', population: 10_654_272 },
  { label: '65–69', population: 9_409_940 },
  { label: '70–74', population: 8_725_574 },
  { label: '75–79', population: 7_414_559 },
  { label: '80–84', population: 4_900_234 },
  { label: '85 and over', population: 4_259_173 },
];
