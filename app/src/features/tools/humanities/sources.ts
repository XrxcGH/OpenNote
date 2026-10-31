// Where each tool's formulas and tables come from, shown under its results as 'Source: …'. Every source here is a
// public-domain work, a published standard whose facts are used without copying its text, or written for this app;
// LICENSES.md beside this file lists them with their terms. Citations are titles, so they are not translated.

export const SOURCES = {
  maps:
    'Snyder, Map Projections: A Working Manual (USGS Professional Paper 1395, 1987); Šavrič, Patterson, and Jenny, ' +
    'The Equal Earth map projection (2018); Robinson’s 1974 table as Snyder prints it; Vincenty (1975) for geodesics.',
  coordinates:
    'Vincenty, Direct and inverse solutions of geodesics on the ellipsoid (1975); Snyder (1987) for Lambert and ' +
    'transverse Mercator zones; NGA rules for UTM and MGRS; WGS84 and GRS80 constants.',
  scripts:
    'Library of Congress ALA-LC romanization tables; BGN/PCGN romanization of Russian; ISO 15919; Revised ' +
    'Romanization of Korean (2000); McCune–Reischauer (1939); modified Hepburn; Hanyu Pinyin; Telex and VNI.',
  linguistics:
    'Leipzig Glossing Rules (2015) for gloss layout and abbreviations; a feature chart written for this app from ' +
    'standard articulatory descriptions; Lobanov (1971) and Traunmüller (1990) for vowel normalization.',
  textlab:
    'Flesch (1948), Kincaid et al. (1975), Gunning fog, McLaughlin SMOG (1969), Coleman–Liau (1975), and ARI ' +
    'formulas; Dunning (1993) log-likelihood; syllables and stress by spelling rules written for this app.',
} as const;

export type SourceId = keyof typeof SOURCES;
