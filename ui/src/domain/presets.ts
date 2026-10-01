/**
 * Встроенные пресеты — известные мелодии/прогрессии.
 *
 * Структура каждого пресета: stack(bass, chords/melody, arpeggio, drums):
 * - bass: сустейн-ноты через `<...>`
 * - chord pad: аккорды в mini-notation `<[55,59,62] ...>`
 * - arpeggio: быстрые ноты (*2 — 2x в цикле)
 * - kick: Euclidean s("sbd(2,4)") — на 1 и 3
 * - snare: noise burst s("white(2,4)").decay(.05) — на 2 и 4
 * - hi-hat: s("<white pink brown>*8").decay(.04) — 8 на цикл (8th notes)
 *
 * `.slow(2)` растягивает весь цикл до ~4 сек (rock tempo).
 * Внутри stack — параллельные паттерны с одинаковым slow().
 */

export type Preset = {
  readonly id: string;
  readonly name: string;
  readonly artist?: string;
  readonly score: string;
  readonly custom?: boolean;
};

export const BUILTIN_PRESETS: ReadonlyArray<Preset> = [
  {
    // Creep — Radiohead. G → B → C → Cm chord progression.
    id: 'creep',
    name: 'Creep',
    artist: 'Radiohead',
    score: [
      '// Creep (Radiohead) — G → B → C → Cm chord progression',
      'stack(',
      '  // Bass: root notes',
      '  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),',
      '  // Chord pad: 4 chords, 1 per cycle step',
      '  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("triangle").gain(0.2).lpf(1500),',
      '  // Arpeggio: chord tones spread over 8 notes per cycle (*2)',
      '  n("<55 67 59 67 62 67 59 67>*2").s("sawtooth").gain(0.12).lpf(1500),',
      '  // Kick on 1 and 3',
      '  s("sbd(2,4)").gain(0.5),',
      '  // Snare-like: white noise burst on 2 and 4',
      '  s("white(2,4)").decay(.05).sustain(0).gain(0.22),',
      '  // Hi-hat: 8 per cycle',
      '  s("<white pink brown>*8").decay(.04).sustain(0).gain(0.18)',
      ').slow(2)',
    ].join('\n'),
  },
  {
    // Seven Nation Army — White Stripes. Iconic 3-note riff.
    id: 'seven-nation-army',
    name: 'Seven Nation Army',
    artist: 'White Stripes',
    score: [
      '// Seven Nation Army — riff: E E E G E F# D (octave doubled)',
      'stack(',
      '  // Riff (high octave)',
      '  note("<e3 e3 e3 g3 e3 f#3 d3 e3>").s("sawtooth").gain(0.5).lpf(800),',
      '  // Bass (low octave)',
      '  note("<e2 e2 e2 g2 e2 f#2 d2 e2>").s("sawtooth").gain(0.3).lpf(400),',
      '  s("sbd(2,4)").gain(0.45),',
      '  s("white(2,4)").decay(.05).sustain(0).gain(0.22),',
      '  s("<white pink brown>*8").decay(.04).sustain(0).gain(0.18)',
      ').slow(2)',
    ].join('\n'),
  },
  {
    // Für Elise — Beethoven. Opening melody + soft accompaniment.
    id: 'fur-elise',
    name: 'Für Elise',
    artist: 'Beethoven',
    score: [
      '// Für Elise — opening: E D# E D# E B D C A',
      'stack(',
      '  // Melody (right hand)',
      '  note("<e5 d#5 e5 d#5 e5 b4 d5 c5 a4>").s("sine").gain(0.45),',
      '  // Bass: root notes A and F',
      '  note("<a3 a3 a3 a3 a3 g3 f3 a3>").s("triangle").gain(0.2).lpf(800),',
      '  // Mid chord arpeggio (8th notes)',
      '  n("<a4 c5 e5 a4 a4 c5 e5 a4>*2").s("triangle").gain(0.08).lpf(2000),',
      '  s("<white pink brown>*8").decay(.04).sustain(0).gain(0.13)',
      ').slow(2)',
    ].join('\n'),
  },
  {
    // Smoke on the Water — Deep Purple. Iconic guitar riff.
    id: 'smoke-on-the-water',
    name: 'Smoke on the Water',
    artist: 'Deep Purple',
    score: [
      '// Smoke on the Water — guitar riff',
      'stack(',
      '  // Riff: G pickups, Bb, C, Db, back to G',
      '  note("<g3 g3 ~ g3 g3 b3 b3 ~ c4 c4 b3 c4 b3 a3 g3 ~ ~>").s("sawtooth").gain(0.45).lpf(900),',
      '  // Bass',
      '  note("<g2 ~ ~ ~ g2 ~ g2 ~ ~ b1 c2 ~>").s("triangle").gain(0.35).lpf(500),',
      '  s("sbd(2,4)").gain(0.4),',
      '  s("white(2,4)").decay(.05).sustain(0).gain(0.2),',
      '  s("<white pink brown>*8").decay(.04).sustain(0).gain(0.18)',
      ').slow(2)',
    ].join('\n'),
  },
  {
    // House of the Rising Sun — Traditional (public domain).
    // Am - C - D - F progression (i-iii-iv-VI in A minor).
    id: 'house-of-the-rising-sun',
    name: 'House of the Rising Sun',
    artist: 'Traditional',
    score: [
      '// House of the Rising Sun — Am C D F progression',
      'stack(',
      '  // Bass: alternating root and fifth',
      '  note("<a2 e2 a2 e2 a2 e2 c3 g2>").s("triangle").gain(0.35).lpf(500),',
      '  // Chord pad',
      '  note("<[a3,c4,e4] [c4,e4,g4] [d4,f#4,a4] [f4,a4,c5]>").s("sine").gain(0.22),',
      '  // Arpeggio: chord tones (*2 = 8 per cycle)',
      '  n("<a4 e4 c4 e4 a4 e4 c4 e4>*2").s("triangle").gain(0.1).lpf(2000),',
      '  s("sbd(2,4)").gain(0.4),',
      '  s("white(2,4)").decay(.05).sustain(0).gain(0.18),',
      '  s("<white pink brown>*8").decay(.04).sustain(0).gain(0.15)',
      ').slow(2)',
    ].join('\n'),
  },
  {
    // Let It Be-style chord progression (Beatles I-V-vi-IV).
    // C - G - Am - F (used in many pop songs).
    id: 'let-it-be-style',
    name: 'Let It Be (chords)',
    artist: 'Beatles-style',
    score: [
      '// Let It Be-style — C → G → Am → F (I-V-vi-IV)',
      'stack(',
      '  // Bass: root notes',
      '  note("<c3 g2 a2 f2>").s("triangle").gain(0.35).lpf(500),',
      '  // Chord pad',
      '  note("<[c4,e4,g4] [g3,b3,d4] [a3,c4,e4] [f3,a3,c4]>").s("sine").gain(0.22),',
      '  // Piano-like arpeggio',
      '  n("<c5 g4 e4 g4 c5 g4 e4 g4>*2").s("triangle").gain(0.08).lpf(2500),',
      '  s("sbd(2,4)").gain(0.4),',
      '  s("white(2,4)").decay(.05).sustain(0).gain(0.18),',
      '  s("<white pink brown>*8").decay(.04).sustain(0).gain(0.15)',
      ').slow(2)',
    ].join('\n'),
  },
  {
    // Wonderwall-style chord progression.
    // Em7 - G - Dsus4 - A7sus4.
    id: 'wonderwall-style',
    name: 'Wonderwall (chords)',
    artist: 'Oasis-style',
    score: [
      '// Wonderwall-style — Em7 → G → Dsus4 → A7sus4',
      'stack(',
      '  // Bass',
      '  note("<e2 g2 d2 a2>").s("triangle").gain(0.35).lpf(400),',
      '  // Chord progression with 7th voicings',
      '  note("<[e3,g3,b3,d4] [g3,b3,d4,f4] [d3,a3,d4,g4] [a3,c4,e4,g4]>").s("sine").gain(0.22),',
      '  // High arpeggio',
      '  n("<e4 b3 d4 g3 e4 b3 d4 g3>*2").s("triangle").gain(0.08).lpf(2500),',
      '  s("sbd(2,4)").gain(0.4),',
      '  s("white(2,4)").decay(.05).sustain(0).gain(0.18),',
      '  s("<white pink brown>*8").decay(.04).sustain(0).gain(0.15)',
      ').slow(2)',
    ].join('\n'),
  },
  {
    // Mary Had a Little Lamb — Traditional kids song.
    id: 'mary-had-a-little-lamb',
    name: 'Mary Had a Little Lamb',
    artist: 'Traditional',
    score: [
      '// Mary Had a Little Lamb — E D C D E E E D D D E G G',
      'stack(',
      '  // Melody',
      '  note("<e4 d4 c4 d4 e4 e4 e4 d4 d4 d4 e4 g4 g4>").s("sine").gain(0.45),',
      '  // Soft C major chord (sustained under melody)',
      '  note("[c3,e3,g3]").s("triangle").gain(0.15),',
      '  // Arpeggio: chord tones (*2)',
      '  n("<c4 e4 g4 e4 c4 e4 g4 e4>*2").s("triangle").gain(0.08).lpf(2500),',
      '  s("<white pink brown>*8").decay(.04).sustain(0).gain(0.15)',
      ').slow(2)',
    ].join('\n'),
  },
];
