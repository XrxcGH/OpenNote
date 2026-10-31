// The music and studio kit's start-up words: its window title and its palette commands. The rest of
// kitMusic.ts joins this object when the kit's code loads (features/tools/music/text.ts).
import type { kitMusic as all } from './kitMusic';

export const kitMusicStart = {
  window: 'Music, script, camera, and studio tools',
  open: 'Open the music, script, camera, and studio tools',
  openKeywords: 'music script screenplay camera film lighting color scale studio theory tuning rhythm',
  t: {
    theory: {
      title: 'Music theory',
      keywords:
        'music theory interval scale mode chord key signature roman numeral transposing instrument ' +
        'pitch class set forte prime form twelve-tone row matrix jazz guitar raga maqam melakarta ' +
        'cents frequency midi',
    },
    score: {
      title: 'Score block',
      keywords:
        'music notation score abc staff engrave sheet music transpose jianpu numbered sargam ' +
        'tablature tab guitar melody playback transposing instrument',
    },
    ear: {
      title: 'Ear training',
      keywords:
        'ear training aural skills musicianship interval chord scale dictation sight-singing solfege ' +
        'rhythm drill listening quiz practice',
    },
    partwriting: {
      title: 'Voice-leading checker',
      keywords:
        'voice leading part writing four-part chorale harmony counterpoint species parallel fifths ' +
        'octaves cantus firmus soprano alto tenor bass spacing leading tone seventh',
    },
    script: {
      title: 'Script formatter',
      keywords:
        'screenplay playwriting script fountain format scene heading dialogue character page count ' +
        'breakdown sheet location list stage play film television',
    },
    camera: {
      title: 'Camera, timing, and lighting',
      keywords:
        'camera exposure aperture shutter iso depth field timecode footage animation light lux color ' +
        'temperature film',
    },
    studio: {
      title: 'Scale, color, and materials',
      keywords:
        'scale drawing model grid enlarge cut list color contrast wcag palette type scale perspective ' +
        'fabric yardage sculpture glaze ceramics colorblind',
    },
    rhythm: {
      title: 'Tuning and rhythm',
      keywords:
        'tuning temperament cents ratio just intonation pythagorean meantone harmonic series ' +
        'metronome tempo rhythm euclidean polyrhythm tala clave swing delay milliseconds',
    },
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitMusic.ts. */
export const kitMusic = kitMusicStart as unknown as typeof all;
