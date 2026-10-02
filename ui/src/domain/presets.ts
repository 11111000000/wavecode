/**
 * Встроенные пресеты — известные мелодии/прогрессии.
 *
 * Каждый пресет имеет СВОЙ ритмический рисунок (не общий шаблон):
 *   - Creep: indie-rock 4/4, kick+snare backbeat, 8th-note hihat
 *   - Seven Nation Army: 4-on-the-floor kick + 8th-note hihat (без snare)
 *   - Für Elise: только hihat (классика, без ударных)
 *   - Smoke on the Water: rock-бит со сбивкой
 *   - House of the Rising Sun: folk, только kick на 1
 *   - Let It Be: стандартный ballad-бит
 *   - Wonderwall: half-time (kick на 1 и 3.5)
 *   - Mary Had a Little Lamb: минимум — только hihat
 *
 * Без `.slow(N)` — каждый такт = 1 cycle (cps=0.5 по умолчанию = 2 сек/такт),
 * chord changes по 1 биту (0.5 сек) на 120 BPM.
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
      '// Creep (Radiohead) — G → B → C → Cm, indie-rock 4/4',
      'stack(',
      '  // Bass: root notes',
      '  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),',
      '  // Chord pad',
      '  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("triangle").gain(0.2).lpf(1500),',
      '  // Arpeggio: 8th notes',
      '  n("<55 67 59 67 62 67 59 67>*2").s("sawtooth").gain(0.12).lpf(1500),',
      '  // Kick on 1 and 3',
      '  s("sbd ~ sbd ~").gain(0.5),',
      '  // Snare backbeat (2 and 4)',
      '  s("~ white ~ white").decay(.05).sustain(0).gain(0.22),',
      '  // 8th-note hihat',
      '  s("white*8").decay(.04).sustain(0).gain(0.15)',
      ')',
    ].join('\n'),
  },
  {
    // Seven Nation Army — White Stripes. Iconic 3-note riff.
    id: 'seven-nation-army',
    name: 'Seven Nation Army',
    artist: 'White Stripes',
    score: [
      '// Seven Nation Army — riff E E E G E F# D, driving 4-on-the-floor',
      'stack(',
      '  // Riff (high octave)',
      '  note("<e3 e3 e3 g3 e3 f#3 d3 e3>").s("sawtooth").gain(0.5).lpf(800),',
      '  // Bass (low octave)',
      '  note("<e2 e2 e2 g2 e2 f#2 d2 e2>").s("sawtooth").gain(0.3).lpf(400),',
      '  // 4-on-the-floor kick (каждый бит)',
      '  s("sbd*4").gain(0.45),',
      '  // 8th-note hihat (snare намеренно нет — фирменный бит White Stripes)',
      '  s("white*8").decay(.04).sustain(0).gain(0.18)',
      ')',
    ].join('\n'),
  },
  {
    // Für Elise — Beethoven (Bagatelle No. 25 in A minor, WoO 59).
    // Opening A-section: 12 notes of right-hand + A2/E2 bass alternation.
    // Triangle waves with short decay for piano-like articulation.
    // No drums (classical). Tempo: Poco moto ~ 4=70.
    id: 'fur-elise',
    name: 'Für Elise',
    artist: 'Beethoven',
    score: [
      '// Für Elise — opening e5 d#5 e5 d#5 e5 b4 d5 c5 a4 a4 c5 e5',
      'stack(',
      '  // Right hand: opening 9 notes + first 3 of consequent phrase (12 total)',
      '  note("<e5 d#5 e5 d#5 e5 b4 d5 c5 a4 a4 c5 e5>")',
      '    .s("triangle").gain(0.35).decay(.15).sustain(.3),',
      '  // Left hand bass — a2/e2 alternating (Für Elise signature motion)',
      '  note("<a2 e2 a2 e2 a2 e2 a2 e2 a2 a2 e2 a2>")',
      '    .s("triangle").gain(0.25).lpf(500).decay(.15).sustain(.3)',
      ').slow(3)',
    ].join('\n'),
  },
  {
    // Smoke on the Water — Deep Purple. Iconic guitar riff.
    id: 'smoke-on-the-water',
    name: 'Smoke on the Water',
    artist: 'Deep Purple',
    score: [
      '// Smoke on the Water — guitar riff G Bb C Db, rock beat со сбивкой',
      'stack(',
      '  // Guitar riff',
      '  note("<g3 g3 ~ g3 g3 b3 b3 ~ c4 c4 b3 c4 b3 a3 g3 ~ ~>").s("sawtooth").gain(0.45).lpf(900),',
      '  // Bass (root notes, разрежено под рифф)',
      '  note("<g2 ~ ~ ~ g2 ~ g2 ~ ~ b1 c2 ~>").s("triangle").gain(0.35).lpf(500),',
      '  // Kick on 1 and 3 (backbeat)',
      '  s("sbd ~ sbd ~").gain(0.4),',
      '  // Snare-ish: 2 коротких удара на 2 и «and»-of-3',
      '  s("~ white ~ white white").decay(.05).sustain(0).gain(0.2),',
      '  // 16th-note hihat (busier чем Creep)',
      '  s("white*16").decay(.03).sustain(0).gain(0.1)',
      ')',
    ].join('\n'),
  },
  {
    // House of the Rising Sun — Traditional (public domain).
    // Am - C - D - F progression.
    id: 'house-of-the-rising-sun',
    name: 'House of the Rising Sun',
    artist: 'Traditional',
    score: [
      '// House of the Rising Sun — Am C D F, sparse folk (только kick на 1)',
      'stack(',
      '  // Bass: alternating root and fifth',
      '  note("<a2 e2 a2 e2 a2 e2 c3 g2>").s("triangle").gain(0.35).lpf(500),',
      '  // Chord pad',
      '  note("<[a3,c4,e4] [c4,e4,g4] [d4,f#4,a4] [f4,a4,c5]>").s("sine").gain(0.22),',
      '  // Arpeggio: chord tones (8th notes)',
      '  n("<a4 e4 c4 e4 a4 e4 c4 e4>*2").s("triangle").gain(0.1).lpf(2000),',
      '  // Kick только на 1 каждого такта — фолк, не рок',
      '  s("sbd ~ ~ ~").gain(0.35),',
      '  // Quarter-note brushed hihat',
      '  s("white*4").decay(.04).sustain(0).gain(0.1)',
      ')',
    ].join('\n'),
  },
  {
    // Let It Be-style chord progression (Beatles I-V-vi-IV).
    id: 'let-it-be-style',
    name: 'Let It Be (chords)',
    artist: 'Beatles-style',
    score: [
      '// Let It Be-style — C G Am F, soft pop-ballad beat',
      'stack(',
      '  // Bass: root notes',
      '  note("<c3 g2 a2 f2>").s("triangle").gain(0.35).lpf(500),',
      '  // Chord pad',
      '  note("<[c4,e4,g4] [g3,b3,d4] [a3,c4,e4] [f3,a3,c4]>").s("sine").gain(0.22),',
      '  // Piano-like arpeggio',
      '  n("<c5 g4 e4 g4 c5 g4 e4 g4>*2").s("triangle").gain(0.08).lpf(2500),',
      '  // Kick backbeat (1 и 3) \u2014 тише чем Creep',
      '  s("sbd ~ sbd ~").gain(0.32),',
      '  // Pink noise snare (warm, не white)',
      '  s("~ pink ~ pink").decay(.06).sustain(0).gain(0.13),',
      '  // Brown noise hihat (мягче, низкочастотнее)',
      '  s("brown*8").decay(.05).sustain(0).gain(0.08)',
      ')',
    ].join('\n'),
  },
  {
    // Wonderwall-style chord progression.
    // Em7 - G - Dsus4 - A7sus4.
    id: 'wonderwall-style',
    name: 'Wonderwall (chords)',
    artist: 'Oasis-style',
    score: [
      '// Wonderwall-style — Em7 G Dsus4 A7sus4, half-time feel',
      'stack(',
      '  // Bass',
      '  note("<e2 g2 d2 a2>").s("triangle").gain(0.35).lpf(400),',
      '  // Chord pad с 7th voicings',
      '  note("<[e3,g3,b3,d4] [g3,b3,d4,f4] [d3,a3,d4,g4] [a3,c4,e4,g4]>").s("sine").gain(0.22),',
      '  // High arpeggio',
      '  n("<e4 b3 d4 g3 e4 b3 d4 g3>*2").s("triangle").gain(0.08).lpf(2500),',
      '  // Half-time kick: на 1 и «and»-of-3',
      '  s("sbd ~ ~ sbd").gain(0.4),',
      '  // Только hihat, без snare — Oasis-фирма',
      '  s("white*8").decay(.04).sustain(0).gain(0.12)',
      ')',
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
      '  // Melody (sine — без тембра, классика)',
      '  note("<e4 d4 c4 d4 e4 e4 e4 d4 d4 d4 e4 g4 g4>").s("sine").gain(0.45),',
      '  // Bass — sustained C major под мелодией',
      '  note("[c3,g3]").s("triangle").gain(0.15),',
      '  // Mid arpeggio (тихо)',
      '  n("<c4 g4 e4 g4 c4 g4 e4 g4>*2").s("triangle").gain(0.06).lpf(2500),',
      '  // Только hihat, без kick/snare — детская',
      '  s("white*4").decay(.04).sustain(0).gain(0.1)',
      ')',
    ].join('\n'),
  },
];
