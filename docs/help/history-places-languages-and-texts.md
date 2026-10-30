# History, places, languages, and texts

The history, places, languages, and texts kit is one tool window with a tab for each tool. Open it from the command palette: type the tool's name, such as Identification keys, or open the whole kit and pick a tab. Every tool shows its steps and puts its result on the page with the insert buttons under it. Click in a page first, then insert. The kit is new in Beta, so check the answers against your own work while you learn it.

## Contents

- [Tools](#tools)
- [Timeline builder](#timeline-builder)
- [Calendars and eras](#calendars-and-eras)
- [Text analysis and verse](#text-analysis-and-verse)
- [Linguistic structures](#linguistic-structures)
- [Scripts, keyboards, and romanization](#scripts-keyboards-and-romanization)
- [Identification keys](#identification-keys)

## Tools

- **Note frames**: insert a note structure, such as a case brief or field notes. Find it by subject or by searching.
- **Coordinates and navigation**: convert between latitude and longitude, UTM, and MGRS. Measure distance and bearing, and work navigation problems.
- **Timeline builder**: draw events and periods on tracks, with BCE dates, uncertain dates, and deep time. Insert it as a figure you can edit.
- **Calendars and eras**: convert a date between thirteen calendars, such as Hebrew, Islamic, Chinese, and Maya. List the festivals of a year.
- **Text analysis and verse**: measure readability, list words and n-grams, build a concordance, test keyness, and compare versions. Scan English and Latin verse.
- **Linguistic structures**: draw syntax and dependency trees, check interlinear glosses, find natural classes, run ordered rules, split syllables, and plot vowels.
- **Scripts, keyboards, and romanization**: type IPA and other scripts with on-screen keyboards, romanize text by public tables, and work with Hangul, kana, pinyin, Thai tones, and Vietnamese input.
- **Identification keys**: build a numbered key from a table of characters. Run it step by step, or filter with a multi-access key.

## Timeline builder

- Type one line for each event or period: label, start, end, track, kind, and notes. Leave the end empty for an event. Write era as the kind for a band drawn behind every track.
- Dates can be a year (1603), a day (1603-03-24), a BCE year (44 BCE), an approximate year (c. 1200 BCE, which means 25 years either way), a spread (1450 ± 10), a decade or century (the 1960s, the 1600s, 5th century BCE), a millennium, or deep time (4.5 Ga, 66 Ma, 12 ka, 11700 BP). Before and after in front of a date put an arrow on its label.
- Inside, years are astronomical: 1 BCE is year 0. So 63 BCE to 14 CE is 76 years, and the steps show how each date was read.
- Years before present count back from 1950, as radiocarbon dates do. Choose the logarithmic axis for deep time: each power of ten takes the same width.
- Zoom and pan with the buttons, or click the picture and press + or - to zoom and the left or right arrow to move.
- Compare two rows to see the years between their starts and where they overlap.
- Insert editable figure puts the timeline on the page with its rows, so Open in tool brings it back for editing.

## Calendars and eras

- Pick the calendar you are typing in, then type the year, the month as a number, and the day. Every other calendar, the weekday, the ISO week, and the Julian Day Number follow.
- Gregorian and Julian years are astronomical: type 0 for 1 BCE and -43 for 44 BCE.
- Hebrew months are numbered from Tishrei, so Nisan is 7 in a common year and 8 in a leap year. The steps show the molad of Tishrei and any postponement.
- Islamic dates are tabular, with the civil or the astronomical epoch. Where a month begins with sighting of the moon, or by the Umm al-Qura calendar, the day can differ by one or two.
- The Solar Hijri year begins on the day of the March equinox if it comes before noon in Tehran, and the next day if not. The steps give the equinox time and compare the 33-year rule.
- Chinese months begin on the day of the new moon at UTC+8. A year of 13 months repeats the first month that holds no principal solar term. Chinese dates run from 1645 to 2400.
- The Roman row names the Julian date by Kalends, Nones, and Ides, with the year from the founding of Rome.
- Festivals in a year lists Easter (Western and Orthodox) and the movable feasts, the Hebrew and Islamic holy days, the Chinese festivals, and Nowruz.
- Japanese eras from Meiji on are built in. Type other reign eras in the era table. Give each era a line with its first day, then its name.

## Text analysis and verse

- Paste a text once; Readability, Word lists, Concordance, Keyness, and Compare versions all use it.
- Readability gives Flesch Reading Ease, the Flesch-Kincaid grade, the Gunning fog index, SMOG, Coleman-Liau, and the Automated Readability Index. Syllables are counted by spelling rules, so an unusual word can be off by one.
- The flags for passive voice, nominalizations, and hedges are simple local rules. Treat them as hints, not verdicts.
- Word lists show frequencies, n-grams, the type-token ratio, and a Zipf plot. You can leave out common function words.
- The concordance shows every use of a word or phrase in context, sorted by the text order or by the words to its left or right. Collocates list the words found near it, with mutual information, the t-score, and log-likelihood.
- Keyness tests a word in your text against a reference text with log-likelihood (G²) and gives the log ratio as the effect size.
- Compare versions lines up two texts word by word and lists each variant, as in a critical apparatus.
- Language sample takes one utterance a line, with morphemes marked by hyphens, and gives the MLU and the number of different words.
- Scansion fits English lines to iambic, trochaic, anapestic, or dactylic meter and finds the rhyme scheme. Latin lines are fitted to the hexameter and the pentameter; mark long vowels with macrons when more than one pattern fits.

## Linguistic structures

- Trees draws a syntax tree from labeled brackets, such as [S [NP the cat] [VP sat]]. End a label with ^ to draw a triangle over its words. A dependency tree takes one word a line with the number of its head and the relation, and says whether any arcs cross.
- Glosses lines up an example with its gloss, morpheme by morpheme, as the Leipzig Glossing Rules describe. It names the word and position of any missing gloss and gives the meaning of each standard label.
- Features lists the segments with a feature bundle, says whether a set of segments is a natural class, and gives the features on which 2 segments differ. The chart was written for OpenNote; change or add segments to match your course's chart.
- Rules applies ordered rules, written A -> B / C _ D, to underlying forms and shows the derivation table. It names feeding, bleeding, counterfeeding, and counterbleeding orders. Sound changes in order work the same way.
- Syllables splits a word by sonority with the onset as long as a legal onset allows. Type the legal onsets, or leave the field empty to allow any onset that rises in sonority.
- Vowel chart plots typed F1 and F2 values in hertz, as Lobanov z-scores for each speaker, or in Bark.

## Scripts, keyboards, and romanization

- Keyboards types IPA, polytonic Greek, Latin with macrons, Old English, Cyrillic, Arabic and Persian, Hebrew with niqqud, Devanagari, Armenian, Georgian, runes, Linear B, cuneiform, hieroglyphs, and Jefferson transcription symbols. A mark on a dotted circle joins the letter before it.
- Romanize uses the Library of Congress ALA-LC tables for Russian, modern Greek, Hindi and Sanskrit, Armenian, and Georgian, and BGN/PCGN for Russian. ALA-LC Russian also reads back to Cyrillic.
- Korean builds Hangul from jamo, shows each syllable's jamo numbers, and gives Revised Romanization and McCune–Reischauer with the sound changes it applied.
- Japanese turns kana into Hepburn, with macrons for long vowels, and romaji into hiragana and katakana. The kana chart is below.
- Pinyin turns tone numbers into tone marks and shows the spoken tones after third-tone, yi, and bu sandhi.
- Thai tones works out a syllable's tone from its consonant class, live or dead syllable, and tone mark.
- Vietnamese turns Telex or VNI typing into letters with their marks.

## Identification keys

- Type one line for each taxon or type: its name, then a state for each character, split by commas or tabs. The first line names the characters.
- Use ? for a state you do not know, and a/b for a taxon that can have either state. A taxon like that goes down both leads of a couplet, as in a printed key.
- A column of numbers, such as hardness, is split at the midpoint between two values. A column of only 0 and 1 is read as two states.
- Each couplet uses the character that splits the remaining taxa most evenly. The steps say how many taxa went each way and how many bits of information the split gave.
- When two taxa have the same states, the key says it cannot tell them apart. Add a character that differs between them.
- In the multi-access key, answer any characters in any order. When no taxon fits every answer, the tool says so; clear an answer to go back.
- After the runner reaches one taxon, Add to catalog starts a catalog row with that determination. Insert catalog table puts the rows on the page as a table.
- The instrument template follows the top levels of the Hornbostel and Sachs classification (1914, public domain). Fill in the details for your own collection.
