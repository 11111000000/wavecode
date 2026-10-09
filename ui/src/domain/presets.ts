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
    // 8-measure A-section (Nohl 1867), 3/8 time. SEQUENCE, not slowcat:
    // in Strudel <a b c> is slowcat (each element = 1 cycle) — that
    // would give 4-sec sustained tones. Plain 'a b c' is sequence
    // (each element = 1/N of cycle) — what we want for melody.
    id: 'fur-elise',
    name: 'Für Elise',
    artist: 'Beethoven',
    score: [
      '// Für Elise — 8 measures (M1-M4 + repeat M5-M8).',
      '// 42 events in sequence, 1/42 of cycle each. .slow(2) → 4 sec/loop.',
      '// Legato: .decay(.15).sustain(.7) keeps note at 70% for ~70% of step.',
      'stack(',
      '  // Right hand: M1 e d# e b d c | M2 a r c e a | M3 b r e g# b |',
      '  // M4 c r e e d# | M5-M8 = M1-M4',
      '  note("e5 d#5 e5 b4 d5 c5 a4 ~ c5 e5 a4 b4 ~ e5 g#5 b4 c5 ~ e5 e6 d#5 e5 d#5 e5 b4 d5 c5 a4 ~ c5 e5 a4 b4 ~ e5 g#5 b4 c5 ~ e5 e6 d#5")',
      '    .s("triangle").gain(0.4)',
      '    .attack(.005).decay(.15).sustain(.7).release(.15),',
      '  // Left hand bass: a2/e2 alternating, 24 per loop (8th notes)',
      '  note("a2 e2 a2 e2 a2 e2 a2 e2 a2 e2 a2 e2 a2 e2 a2 e2 a2 e2 a2 e2 a2 e2 a2 e2")',
      '    .s("sine").gain(0.3).lpf(400)',
      '    .attack(.005).decay(.15).sustain(.7).release(.15)',
      ').slow(2)',
    ].join('\n'),
  },
  {
    // Smoke on the Water — Deep Purple. Guitar riff + Hammond organ + kit.
    id: 'smoke-on-the-water',
    name: 'Smoke on the Water',
    artist: 'Deep Purple',
    score: [
      '// Smoke on the Water — guitar+Hammond G Bb C Ab, rock beat со сбивкой',
      'stack(',
      '  // Guitar (Blackmore) — sawtooth + slight tube-amp shape',
      '  note("<g3 g3 ~ g3 g3 b3 b3 ~ c4 c4 b3 c4 b3 a3 g3 ~ ~>").s("sawtooth").gain(0.45).lpf(900).shape(0.3),',
      '  // Hammond organ (Lord) — square wave, octave lower, warm',
      '  note("<g2 g2 ~ g2 g2 b2 b2 ~ c3 c3 b2 c3 b2 a2 g2 ~ ~>").s("square").gain(0.18).lpf(1500),',
      '  // Bass (Glover) — round triangle, punchier (decay + tighter lpf)',
      '  note("<g2 ~ ~ ~ g2 ~ g2 ~ ~ b1 c2 ~>").s("triangle").gain(0.35).lpf(400).decay(.05),',
      '  // Kick on 1 и 3 (backbeat)',
      '  s("sbd ~ sbd ~").gain(0.4),',
      '  // Snare-ish: 2 коротких удара на 2 и «and»-of-3',
      '  s("~ white ~ white white").decay(.05).sustain(0).gain(0.2),',
      '  // Cymbal shimmer wash — high-passed white noise, gated short (8th-note)',
      '  s("white*8").hpf(5000).decay(.04).sustain(0).gain(0.1)',
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
      '// House of the Rising Sun — Am C D F, sparse folk w/ Vox organ',
      'stack(',
      '  // Bass: alternating root and fifth, ascending through chord changes',
      '  note("a2 e2 a2 e2 c3 g3 c3 g3 d3 a3 d3 a3 f3 c4 f3 c4").s("triangle").gain(0.35).lpf(500),',
      '  // Chord pad: sustained Am, C, D, F',
      '  note("[a3,c4,e4] [c4,e4,g4] [d4,f#4,a4] [f4,a4,c5]").s("sine").gain(0.22),',
      '  // Vox Continental organ pad (square wave, low gain, sustaining each chord)',
      '  note("[a3,c4,e4] [c4,e4,g4] [d4,f#4,a4] [f4,a4,c5]").s("square").gain(0.12).lpf(2000),',
      '  // Arpeggio: chord tones with reverb for space',
      '  n("a4 c5 e5 a5 c5 e5 g5 c6 d5 f#5 a5 d6 f5 a5 c6 f6").s("triangle").gain(0.06).lpf(2000).room(.4),',
      '  // Timpani-like low hit on 1 of each measure (replaces kick)',
      '  s("sbd ~ ~ ~").lpf(100).gain(0.25)',
      ')',
    ].join('\n'),
  },
  {
    // Let It Be-style chord progression (Beatles I-V-vi-IV).
    id: 'let-it-be-style',
    name: 'Let It Be (chords)',
    artist: 'Beatles-style',
    score: [
      '// Let It Be-style — C G Am F, McCartney piano-ballad + gospel warmth',
      'stack(',
      '  // Bass: root notes (left hand)',
      '  note("<c3 g2 a2 f2>").s("triangle").gain(0.30).lpf(500),',
      '  // Chord pad: soft sine (harmonic body)',
      '  note("<[c4,e4,g4] [g3,b3,d4] [a3,c4,e4] [f3,a3,c4]>").s("sine").gain(0.18),',
      '  // Piano arpeggio: hammer-then-decay envelope + room',
      '  n("<c5 g4 e4 g4 c5 g4 e4 g4>*2").s("triangle").decay(.3).sustain(.2).gain(0.07).lpf(2500).room(.3),',
      '  // Organ pad: square wave, filtered, slow swell (gospel warmth)',
      '  note("<c4 g3 a3 f3>").s("square").attack(.05).decay(.4).sustain(.3).gain(0.08).lpf(1500),',
      '  // Kick backbeat (1 и 3) — тише чем Creep',
      '  s("sbd ~ sbd ~").gain(0.30),',
      '  // Pink noise snare (warm, не white)',
      '  s("~ pink ~ pink").decay(.06).sustain(0).gain(0.12)',
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
      '// Wonderwall-style — Em7 G Dsus4 A7sus4, jangly Britpop feel',
      'stack(',
      '  // Bass (slightly more present)',
      '  note("<e2 g2 d2 a2>").s("triangle").gain(0.4).lpf(400),',
      '  // Chord pad as percussive strum (guitar-like attack)',
      '  note("<[e3,g3,b3,d4] [g3,b3,d4,f4] [d3,a3,d4,g4] [a3,c4,e4,g4]>").s("sine").attack(.001).decay(.15).gain(0.22),',
      '  // Mid arpeggio (Noel-style fingerpicking)',
      '  n("<e4 b3 d4 g3 e4 b3 d4 g3>*2").s("triangle").gain(0.08).lpf(2500),',
      '  // Jangly high arpeggio with delay+room (16th notes)',
      '  n("e5 b4 d5 g4 e5 b4 d5 g4 e5 b4 d5 g4 e5 b4 d5 g4").s("triangle").gain(0.05).lpf(3000).room(.3).delay(.25),',
      '  // Half-time kick: на 1 и «and»-of-3',
      '  s("sbd ~ ~ sbd").gain(0.4),',
      '  // Только hihat, без snare — Oasis-фирма (тише под strum)',
      '  s("white*8").decay(.04).sustain(0).gain(0.1)',
      ')',
    ].join('\n'),
  },
  {
    // Mary Had a Little Lamb — Traditional kids song.
    id: 'mary-had-a-little-lamb',
    name: 'Mary Had a Little Lamb',
    artist: 'Traditional',
    score: [
      '// Mary Had a Little Lamb — E D C D E E E D D D E G G.',
      '// Toy-piano melody + music-box arpeggio в playroom reverb.',
      'stack(',
      '  // Melody — toy piano: triangle + короткий pluck envelope + bright tinkly + playroom',
      '  note("e4 d4 c4 d4 e4 e4 e4 d4 d4 d4 e4 g4 g4").s("triangle").gain(0.4).decay(.15).sustain(.1).lpf(4500).room(.4),',
      '  // Bass — sustained C major под мелодией',
      '  note("[c3,g3]").s("triangle").gain(0.15),',
      '  // Music-box arpeggio — tinkly shimmer, тихий',
      '  n("c4 g4 e4 g4 c4 g4 e4 g4").s("triangle").gain(0.05).lpf(4500).room(.4),',
      '  // Soft hihat — детская песня, не агрессивно',
      '  s("white*4").decay(.04).sustain(0).gain(0.08)',
      ')',
    ].join('\n'),
  },
  {
    // EDM 4-on-floor: kick каждый бит + off-beat hi-hat + pluck lead.
    id: 'edm-house',
    name: 'EDM 4-on-floor',
    artist: 'House',
    score: [
      '// EDM house — 4-on-floor kick + off-beat hat + pluck lead + sub bass',
      'stack(',
      '  // Kick on every beat',
      '  s("bd*4").gain(0.55),',
      '  // Off-beat hi-hat (classic house shuffle)',
      '  s("~ hh ~ hh ~ hh ~ hh").decay(.05).gain(0.22),',
      '  // Pluck lead — supersaw через 8-step arpeggio',
      '  note("<a4 c5 e5 g5 b4 a4 c5 e5>").s("supersaw").decay(.15).sustain(0.2).gain(0.18).lpf(4000),',
      '  // Sub bass — root notes под lead',
      '  note("<a2 c3 e3 a2>").s("sawtooth").gain(0.35).lpf(300),',
      '  // Snare on 2 and 4',
      '  s("~ sd ~ sd").gain(0.30)',
      ')',
    ].join('\n'),
  },
  {
    // Hip-hop boom-bap: swing 16ths, hard kick 2&4, snare 3, vinyl noise.
    id: 'hiphop-boombap',
    name: 'Hip-hop boom-bap',
    artist: '90s NYC',
    score: [
      '// Hip-hop boom-bap — swing 16ths, hard kick 2&4, snare 3, vinyl noise',
      'stack(',
      '  // Hard kick on 2 and 4 (snare-side)',
      '  s("~ bd ~ bd ~ bd ~ bd").gain(0.55).decay(.05),',
      '  // Snare on 3',
      '  s("~ ~ sd ~ ~ ~ sd ~").gain(0.45),',
      '  // Swing 16ths hi-hat — humanized feel',
      '  s("hh*8").swing(0.5, 1/8).decay(.04).gain(0.20),',
      '  // Bass — root + fifth alternating',
      '  note("<a2 e2 a2 e2 a2 e2 a2 e2>").s("triangle").gain(0.30).lpf(500),',
      '  // Vinyl crackle — текстура под beat',
      '  s("white*16").hpf(8000).gain(0.05)',
      ')',
    ].join('\n'),
  },
  {
    // Jazz ii-V-I: Dmin7 → G7 → Cmaj7 walking bass + comping chords.
    id: 'jazz-ii-v-i',
    name: 'Jazz ii-V-I',
    artist: 'Bebop',
    score: [
      '// Jazz ii-V-I — Dmin7 → G7 → Cmaj7 walking bass + comping',
      'stack(',
      '  // Walking bass — Dmin7: D-F-A-C; G7: G-B-D-F; Cmaj7: C-E-G-B',
      '  note("d2 f2 a2 c3 g2 b2 d3 f3 c3 e3 g3 b3").s("triangle").gain(0.30).lpf(600),',
      '  // Comping chords — sus extensions',
      '  chord("<Dmin7 G7 Cmaj7>").voicing().s("triangle").gain(0.18).room(.3),',
      '  // Brushed snare — soft ghost notes',
      '  s("~ ~ sd ~ ~ ~ sd ~").decay(.15).sustain(0.1).gain(0.18),',
      '  // Ride cymbal — light 8ths',
      '  s("rd*8").decay(.3).sustain(0.05).gain(0.12).hpf(5000),',
      '  // Sparse piano lead — C-E-G arpeggio',
      '  n("c5 e5 g5 e5 c5 e5 g5 e5").s("triangle").gain(0.10).room(.4)',
      ')',
    ].join('\n'),
  },
  {
    // Ambient drone: long-attack sine drone + slow LFO + sparse bells.
    id: 'ambient-drone',
    name: 'Ambient drone',
    artist: 'Eno',
    score: [
      '// Ambient drone — long-attack sine drone + slow LFO + sparse bells',
      'stack(',
      '  // Slow drone — C2 + G2 sustained',
      '  note("[c2,g2]").s("sine").attack(2).release(4).gain(0.20),',
      '  // Slow LFO modulating filter for movement',
      '  note("[c2,g2]").s("sine").lpf(sine.range(400, 2000).slow(8)).gain(0.15),',
      '  // Sparse bells — random pentatonic hits every 4-8 steps',
      '  note("<~ ~ c5 ~ ~ g4 ~ ~ c5 ~ ~ ~ e5 ~ ~ g4>").s("triangle").attack(.01).decay(1.5).sustain(0).gain(0.10).room(.6),',
      '  // Texture pad — high-passed white noise',
      '  s("white*4").hpf(4000).lpf(12000).gain(0.04).room(.7)',
      ')',
    ].join('\n'),
  },
  {
    // Bossa nova: syncopated clave + nylon comping + shaker.
    id: 'bossa-nova',
    name: 'Bossa Nova',
    artist: 'Jobim',
    score: [
      '// Bossa nova — syncopated clave + nylon comping + shaker',
      'stack(',
      '  // Clave pattern (3+2 son) — syncopated cross-rhythm',
      '  s("rim ~ ~ rim rim ~ ~ rim ~ ~ rim rim ~").decay(.08).gain(0.25),',
      '  // Bass — bossa syncopated pattern',
      '  note("<~ a2 ~ a2 a2 ~ e2 d2 ~ c2 e2 a2 ~>").s("triangle").gain(0.30).lpf(500),',
      '  // Nylon-string comping — bossa chord pattern',
      '  chord("<Dm7 G7>").voicing().s("triangle").decay(.3).sustain(0.1).gain(0.18),',
      '  // Shaker — light 16ths',
      '  s("~ sh ~ sh ~ sh ~ sh ~ sh ~ sh ~ sh ~").decay(.04).gain(0.15),',
      '  // Sparse melodic lead — pentatonic flair',
      '  n("e5 ~ d5 ~ c5 ~ b4 a4 ~ g4 ~").s("triangle").gain(0.10).room(.3)',
      ')',
    ].join('\n'),
  },
  {
    // Trap modern: 808 sub + hi-hat rolls + sparse lead.
    id: 'trap-modern',
    name: 'Trap',
    artist: 'Modern',
    score: [
      '// Trap — 808 sub + hi-hat rolls + sparse lead',
      'stack(',
      '  // 808 sub — long decay low-end hits',
      '  s("~ ~ bd ~ ~ ~ bd ~").decay(1.2).sustain(0).gain(0.55).lpf(120),',
      '  // Sparse snare on 3',
      '  s("~ ~ sd ~ ~ ~ ~ ~").decay(.1).gain(0.30),',
      '  // Hi-hat rolls — 32nd notes on 16ths',
      '  s("hh*4 [hh hh] hh*2 [hh hh hh]").decay(.03).gain(0.25),',
      '  // Sparse bell lead — minor pentatonic',
      '  n("~ ~ ~ c5 ~ ~ eb5 ~ ~ ~ g4 ~ ~ c5 ~").s("triangle").decay(.5).gain(0.12).room(.3),',
      '  // Sub bass drone',
      '  note("a1 ~ ~ ~ ~ ~ ~ ~").s("sine").gain(0.25)',
      ')',
    ].join('\n'),
  },
  {
    // Reggaeton: dembow rhythm (3+3+2) + detuned synth bass.
    id: 'reggaeton',
    name: 'Reggaetón',
    artist: 'Dembow',
    score: [
      '// Reggaetón — dembow rhythm (3+3+2) + detuned synth bass',
      'stack(',
      '  // Dembow: kick on 1,3, snare on 2,4, hat on 8ths',
      '  s("bd ~ sd ~ bd ~ sd hh ~").gain(0.50),',
      '  // Detuned synth bass — octaves + 5th root',
      '  note("<a1 a2 e2 a1 a1 a2 e2 a1>").s("sawtooth").detune(8).gain(0.32).lpf(800),',
      '  // Pluck chord stab on 4',
      '  s("~ ~ ~ sd:0.1 ~ ~ ~ ~").gain(0.20),',
      '  // Sparse marimba lead',
      '  n("~ c5 ~ ~ eb5 ~ ~ d5 ~ c5 ~ ~ b4").s("triangle").decay(.4).gain(0.12).room(.2),',
      '  // Rim percussion for texture',
      '  s("~ ~ rim ~ ~ rim ~").decay(.05).gain(0.12)',
      ')',
    ].join('\n'),
  },
  {
    // IDM glitch: polymetric 5/4 + 7/8, bit-reduced samples.
    id: 'idm-glitch',
    name: 'IDM glitch',
    artist: 'Autechre',
    score: [
      '// IDM glitch — polymetric 5/4 + 7/8, bit-reduced + random gating',
      'stack(',
      '  // 5/4 polymeter kick — every 5 steps of 8ths',
      '  s("bd ~ ~ ~ ~ bd ~ ~ ~").gain(0.45),',
      '  // 7/8 polymeter snare — independent cycle',
      '  s("~ ~ ~ sd ~ ~ sd ~").gain(0.35),',
      '  // Hi-hat with random gating (Euclidean-like)',
      '  s("hh*8").euclid(5, 8).decay(.03).gain(0.20),',
      '  // Bit-reduced noise percussion',
      '  s("white*8").bitcrush(4, 8000).decay(.05).gain(0.10),',
      '  // Detuned sine melody — irregular rhythm',
      '  n("~ c5 ~ ~ eb5 ~ ~ g4 ~ ~ ~ c5 ~").s("sine").detune(15).gain(0.10).room(.4)',
      ')',
    ].join('\n'),
  },
  {
    // Dreampop / shoegaze: 16th-note strum + chorus-washed pad + soft vocal.
    id: 'dreampop',
    name: 'Dreampop',
    artist: 'Shoegaze',
    score: [
      '// Dreampop / shoegaze — 16th-note strum + chorus pad + soft lead',
      'stack(',
      '  // 16th-note strum pattern (jangly)',
      '  s("~ sd:0.05 ~ sd:0.05 ~ sd:0.05 ~ sd:0.05").decay(.08).gain(0.20),',
      '  // Chorus-washed chord pad — 4ths and 5ths',
      '  chord("<Am F C G>").voicing().s("triangle").lpf(2500).room(.6).gain(0.16),',
      '  // Bass — root notes',
      '  note("<a2 f2 c2 g2>").s("triangle").gain(0.28).lpf(500),',
      '  // Soft vocal lead — pentatonic melody',
      '  n("a4 c5 e5 c5 a4 g4 a4 c5").s("triangle").gain(0.10).room(.5).lpf(3000),',
      '  // Soft kick on 1 and 3',
      '  s("bd ~ ~ bd ~ ~ ~ ~").decay(.10).gain(0.20)',
      ')',
    ].join('\n'),
  },
  {
    // Step-Grid demo: готовый rock-бит, чтобы при первом открытии
    // 🎹 Step была видна сетка с активными ячейками.
    id: 'step-grid-demo',
    name: 'Step Grid demo',
    artist: 'Rock',
    score: [
      '// Step-Grid demo — rock beat (bd 0,2 / sd 1,3 / hh every)',
      'stack(',
      '  s("bd ~ bd ~ ~ ~ ~ ~"),',
      '  s("~ sd ~ sd ~ ~ ~ ~"),',
      '  s("hh hh hh hh hh hh hh hh"),',
      '  s("~ ~ ~ ~ ~ ~ ~ ~")',
      ')',
    ].join('\n'),
  },
  {
    // Piano ballad — Salamander Grand Piano v3 (CC0) + simple chord progression.
    // Piano bank auto-registered on first eval (lazy load).
    id: 'piano-ballad',
    name: 'Piano ballad',
    artist: 'Salamander',
    score: [
      '// Piano ballad — Salamander Grand Piano v3 (CC0) + vi-IV-I-V',
      'stack(',
      '  // Right hand — 8th-note arpeggio в стиле Billy Joel',
      '  n("a4 c5 e5 c5 f4 a4 c5 e5 g4 b4 d5 b4 c5 e5 g4 c5 e5").s("piano").gain(0.5).room(.4),',
      '  // Left hand — vi-IV-I-V chord roots',
      '  note("<f3 [a3,c4] g3 [b3,d4] a3 [c4,e4] e3 [g3,b3] f3 [a3,c4] g3 [b3,d4] a3 [c4,e4] e3 [g3,b3]>").s("piano").gain(0.4).room(.3),',
      '  // Soft kick on 1 и 3',
      '  s("bd ~ ~ bd ~ ~ ~ ~").decay(.15).gain(0.18),',
      '  // Brush snare — light off-beat',
      '  s("~ ~ sd ~ ~ ~ sd ~").decay(.20).sustain(0.05).gain(0.15)',
      ')',
    ].join('\n'),
  },
  {
    // 808 classic — pure synthesis, no samples. Sine sweep kick + noise
    // snare + hpf hat. Droppable в любой live-coding сессии.
    id: '808-classic',
    name: '808 classic (synth)',
    artist: 'Tone-baked',
    score: [
      '// 808 classic — pure synthesis (sine sweep kick + noise snare + hpf hat)',
      'stack(',
      '  // 808 kick — sine sweep с long decay',
      '  s("bd bd bd bd").s("sine").lpf(80).decay(0.4).sustain(0).gain(0.5),',
      '  // 808 snare — noise + tone burst',
      '  s("~ sd ~ sd").s("white").hpf(1500).lpf(8000).decay(0.15).gain(0.40),',
      '  // Closed hat — short burst, каждый 8-й',
      '  s("~ ~ hh ~ ~ ~ hh ~").s("white").hpf(8000).decay(0.05).gain(0.22),',
      '  // Open hat — последний 16-й',
      '  s("~ ~ ~ ~ ~ ~ ~ oh").s("white").hpf(8000).decay(0.25).gain(0.20),',
      '  // Bass — sub-bass через sine + lpf',
      '  note("<a1 a1 a1 a1 e1 a1 a1 a1>").s("sine").lpf(150).gain(0.40)',
      ')',
    ].join('\n'),
  },
];
