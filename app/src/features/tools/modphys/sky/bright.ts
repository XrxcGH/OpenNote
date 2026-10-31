// The bright stars for the sky chart: every star brighter than about magnitude 2.5, and a few fainter ones that
// finish familiar figures (the Big Dipper, Cassiopeia, and the stars around the Summer Triangle). J2000 positions and V
// magnitudes as listed in the Yale Bright Star Catalog, 5th revised edition (Hoffleit and Warren 1991, public
// domain), rounded to 0.1 s and 1″. Each row is name | RA h m s | Dec ° ′ ″ | V.
import type { Equatorial } from './astro';

const ROWS = `Sirius|06 45 08.9|-16 42 58|-1.46
Canopus|06 23 57.1|-52 41 45|-0.72
Arcturus|14 15 39.7|+19 10 57|-0.04
Rigil Kentaurus|14 39 36.5|-60 50 02|-0.01
Vega|18 36 56.3|+38 47 01|0.03
Capella|05 16 41.4|+45 59 53|0.08
Rigel|05 14 32.3|-08 12 06|0.12
Procyon|07 39 18.1|+05 13 30|0.38
Achernar|01 37 42.8|-57 14 12|0.46
Betelgeuse|05 55 10.3|+07 24 25|0.50
Hadar|14 03 49.4|-60 22 23|0.61
Altair|19 50 47.0|+08 52 06|0.77
Acrux|12 26 35.9|-63 05 57|0.77
Aldebaran|04 35 55.2|+16 30 33|0.85
Antares|16 29 24.5|-26 25 55|0.96
Spica|13 25 11.6|-11 09 41|0.98
Pollux|07 45 18.9|+28 01 34|1.14
Fomalhaut|22 57 39.0|-29 37 20|1.16
Deneb|20 41 25.9|+45 16 49|1.25
Mimosa|12 47 43.3|-59 41 19|1.25
Regulus|10 08 22.3|+11 58 02|1.35
Adhara|06 58 37.5|-28 58 20|1.50
Castor|07 34 36.0|+31 53 18|1.58
Shaula|17 33 36.5|-37 06 14|1.63
Gacrux|12 31 09.9|-57 06 48|1.63
Bellatrix|05 25 07.9|+06 20 59|1.64
Elnath|05 26 17.5|+28 36 27|1.65
Miaplacidus|09 13 12.0|-69 43 02|1.68
Alnilam|05 36 12.8|-01 12 07|1.70
Alnair|22 08 14.0|-46 57 40|1.74
Alnitak|05 40 45.5|-01 56 34|1.77
Alioth|12 54 01.7|+55 57 35|1.77
Regor|08 09 31.9|-47 20 12|1.78
Dubhe|11 03 43.7|+61 45 03|1.79
Mirfak|03 24 19.4|+49 51 40|1.79
Wezen|07 08 23.5|-26 23 36|1.84
Kaus Australis|18 24 10.3|-34 23 05|1.85
Avior|08 22 30.8|-59 30 35|1.86
Alkaid|13 47 32.4|+49 18 48|1.86
Sargas|17 37 19.1|-42 59 52|1.87
Menkalinan|05 59 31.7|+44 56 51|1.90
Atria|16 48 39.9|-69 01 40|1.92
Alhena|06 37 42.7|+16 23 57|1.93
Peacock|20 25 38.9|-56 44 06|1.94
Delta Velorum|08 44 42.2|-54 42 30|1.96
Mirzam|06 22 42.0|-17 57 21|1.98
Alphard|09 27 35.2|-08 39 31|1.98
Hamal|02 07 10.4|+23 27 45|2.00
Algieba|10 19 58.4|+19 50 29|2.01
Polaris|02 31 49.1|+89 15 51|2.02
Diphda|00 43 35.4|-17 59 12|2.04
Nunki|18 55 15.9|-26 17 48|2.05
Menkent|14 06 41.0|-36 22 12|2.06
Mirach|01 09 43.9|+35 37 14|2.06
Alpheratz|00 08 23.3|+29 05 26|2.06
Saiph|05 47 45.4|-09 40 11|2.06
Rasalhague|17 34 56.1|+12 33 36|2.08
Kochab|14 50 42.3|+74 09 20|2.08
Almach|02 03 53.9|+42 19 47|2.10
Tiaki|22 42 40.1|-46 53 05|2.10
Algol|03 08 10.1|+40 57 20|2.12
Denebola|11 49 03.6|+14 34 19|2.14
Muhlifain|12 41 31.0|-48 57 36|2.17
Suhail|09 07 59.8|-43 25 57|2.21
Alphecca|15 34 41.3|+26 42 53|2.23
Sadr|20 22 13.7|+40 15 24|2.23
Eltanin|17 56 36.4|+51 29 20|2.23
Mintaka|05 32 00.4|-00 17 57|2.23
Schedar|00 40 30.4|+56 32 14|2.24
Naos|08 03 35.0|-40 00 12|2.25
Aspidiske|09 17 05.4|-59 16 31|2.25
Mizar|13 23 55.5|+54 55 31|2.27
Caph|00 09 10.7|+59 08 59|2.27
Larawag|16 50 09.8|-34 17 36|2.29
Epsilon Centauri|13 39 53.3|-53 27 59|2.30
Alpha Lupi|14 41 55.8|-47 23 17|2.30
Eta Centauri|14 35 30.4|-42 09 28|2.31
Dschubba|16 00 20.0|-22 37 18|2.32
Izar|14 44 59.2|+27 04 27|2.37
Merak|11 01 50.5|+56 22 57|2.37
Ankaa|00 26 17.0|-42 18 22|2.39
Enif|21 44 11.2|+09 52 30|2.39
Girtab|17 42 29.3|-39 01 48|2.41
Scheat|23 03 46.5|+28 04 58|2.42
Sabik|17 10 22.7|-15 43 29|2.43
Phecda|11 53 49.8|+53 41 41|2.44
Alderamin|21 18 34.8|+62 35 08|2.44
Aludra|07 24 05.7|-29 18 11|2.45
Navi|00 56 42.5|+60 43 00|2.47
Aljanah|20 46 12.7|+33 58 13|2.48
Markab|23 04 45.7|+15 12 19|2.49
Markeb|09 22 06.8|-55 00 39|2.50
Menkar|03 02 16.8|+04 05 23|2.53
Gienah|12 15 48.4|-17 32 31|2.59
Ascella|19 02 36.7|-29 52 48|2.60
Zubeneschamali|15 17 00.4|-09 22 59|2.61
Acrab|16 05 26.2|-19 48 19|2.62
Unukalhai|15 44 16.1|+06 25 32|2.65
Kraz|12 34 23.2|-23 23 48|2.65
Ruchbah|01 25 49.0|+60 14 07|2.68
Kaus Media|18 20 59.6|-29 49 41|2.70
Tarazed|19 46 15.6|+10 36 48|2.72
Porrima|12 41 39.6|-01 26 58|2.74
Zubenelgenubi|14 50 52.7|-16 02 30|2.75
Vindemiatrix|13 02 10.6|+10 57 33|2.83
Algenib|00 13 14.2|+15 11 01|2.83
Alcyone|03 47 29.1|+24 06 18|2.87
Deneb Algedi|21 47 02.4|-16 07 38|2.87
Sadalmelik|22 05 47.0|-00 19 11|2.96
Alnasl|18 05 48.5|-30 25 27|2.99
Albireo|19 30 43.3|+27 57 35|3.08
Megrez|12 15 25.6|+57 01 57|3.31`;

export interface BrightStar extends Equatorial {
  name: string;
  mag: number;
}

const sexagesimal = (text: string) => {
  const [a, b, c] = text.split(' ').map(Number);
  const sign = text.trim().startsWith('-') ? -1 : 1;
  return sign * (Math.abs(a!) + b! / 60 + c! / 3600);
};

/** The chart's stars, brightest first. */
export const BRIGHT_STARS: readonly BrightStar[] = ROWS.split('\n').map((row) => {
  const [name, ra, dec, mag] = row.split('|');
  return { name: name!, ra: sexagesimal(ra!), dec: sexagesimal(dec!), mag: Number(mag) };
});
