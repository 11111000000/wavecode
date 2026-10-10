/**
 * Встроенные пресеты — известные мелодии/прогрессии.
 *
 * Каждый пресет имеет СВОЙ ритмический рисунок (не общий шаблон):
 *   - Creep: indie-rock 4/4, kick+snare backbeat, 8th-note hihat
 *   - EDM 4-on-floor: House, 4-on-floor + pluck lead
 *   - Hip-hop boom-bap: swing 16ths, hard kick, snare 3
 *   - Jazz ii-V-I: walking bass + comping chords
 *   - Ambient drone: long-attack sine + slow LFO
 *   - Bossa Nova: 3+2 clave + nylon comping + shaker
 *   - Trap: 808 sub + hat rolls
 *   - Reggaeton: dembow + detuned synth bass
 *   - IDM glitch: 5/4 + 7/8 polymeter
 *   - Dreampop: 16th-note strum + chorus pad
 *   - Step Grid demo: rock beat для 🎹 Step
 *   - Piano ballad: Salamander Piano v3 (CC0)
 *   - 808 classic (synth): чистый Strudel-синтез, no samples
 *   - Analog bass (synth): CC0 Moog-стиль
 *   - 808 king (samples): CC0 Freesound drums
 *   - Lush pad (synth): CC0 Vanyamba + IDM Atmosphare
 *   - Retro lead (synth): CC0 Garzul Minimoog
 *   - Toms funk (samples): CC0 toms
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
    // EDM 4-on-floor: kick каждый бит + off-beat hi-hat + pluck lead.
    id: 'edm-house',
    name: 'EDM 4-on-floor',
    artist: 'House',
    score: [
      '// EDM house — 4-on-floor kick + off-beat hat + pluck lead + sub bass',
      'stack(',
      '  // Kick on every beat',
      '  s("drums:bd*4").gain(0.55),',
      '  // Off-beat hi-hat (classic house shuffle)',
      '  s("~ hh ~ hh ~ hh ~ hh").decay(.05).gain(0.22),',
      '  // Pluck lead — supersaw через 8-step arpeggio',
      '  note("<a4 c5 e5 g5 b4 a4 c5 e5>").s("supersaw").decay(.15).sustain(0.2).gain(0.18).lpf(4000),',
      '  // Sub bass — root notes под lead',
      '  note("<a2 c3 e3 a2>").s("sawtooth").gain(0.35).lpf(300),',
      '  // Snare on 2 and 4',
      '  s("~ drums:sd ~ drums:sd").gain(0.30)',
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
      '  s("drums:hh*8").swing(0.5, 1/8).decay(.04).gain(0.20),',
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
      '  s("drums:hh*8").euclid(5, 8).decay(.03).gain(0.20),',
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
      '  s("~ drums:sd ~ drums:sd").s("white").hpf(1500).lpf(8000).decay(0.15).gain(0.40),',
      '  // Closed hat — short burst, каждый 8-й',
      '  s("~ ~ hh ~ ~ ~ hh ~").s("white").hpf(8000).decay(0.05).gain(0.22),',
      '  // Open hat — последний 16-й',
      '  s("~ ~ ~ ~ ~ ~ ~ oh").s("white").hpf(8000).decay(0.25).gain(0.20),',
      '  // Bass — sub-bass через sine + lpf',
      '  note("<a1 a1 a1 a1 e1 a1 a1 a1>").s("sine").lpf(150).gain(0.40)',
      ')',
    ].join('\n'),
  },
  {
    // Analog bass — CC0 Moog sample bank (`synth:bass-*`). Steady 4-on-the-floor
    // with sub-octave motion + tape-stop whoosh at the end. Pitched down
    // from C2/E1/A1 recordings (Strudel handles transposition).
    id: 'analog-bass',
    name: 'Analog bass',
    artist: 'CC0 Moog',
    score: [
      '// Analog bass — CC0 Moog sample pack (synth:bass-*) + tape stop',
      'stack(',
      '  // Bass: roots on 1, sub-fifth on 3, octave on 4',
      '  note("<c2 c2 a1 e1 c2 c2 g1 c2>").s("synth:bass-c2").gain(0.45).lpf(500),',
      '  // Counter-bass: fifth + octave motion (octave higher)',
      '  note("<g2 g2 e2 b1 g2 g2 d2 g2>").s("synth:bass-c2").gain(0.20).lpf(800),',
      '  // Soft kick on 1 and 3 (synthesized — no sample needed)',
      '  s("bd ~ ~ ~ bd ~ ~ ~").decay(.12).sustain(0).gain(0.30),',
      '  // 8th-note hihat — light, no snare (bass-forward groove)',
      '  s("white*8").hpf(8000).decay(.03).sustain(0).gain(0.12)',
      ')',
    ].join('\n'),
  },
  {
    // 808-king — классический 808 beat через CC0 Freesound-сэмплы.
    // Банк `drums` регистрируется автоматически при первом eval.
    // kick 4-on-floor + snare backbeat + closed hat 8ths + clap on 7.
    id: '808-king',
    name: '808 king (samples)',
    artist: 'Freesound CC0',
    score: [
      '// 808 king — CC0 Freesound samples, 4-on-floor + backbeat + clap fill',
      'stack(',
      '  // Kick — каждый бит (808-стиль)',
      '  s("drums:bd*4").gain(0.55),',
      '  // Snare — backbeat (2 и 4)',
      '  s("~ drums:sd ~ drums:sd").gain(0.40),',
      '  // Closed hat — 8-е ноты',
      '  s("drums:hh*8").gain(0.22),',
      '  // Clap — на 7-м шаге как fill',
      '  s("~ ~ ~ ~ ~ ~ ~ drums:cp").gain(0.35),',
      '  // Sub-bass — тоническая основа',
      '  note("<a1 a1 a1 a1>").s("sine").lpf(120).gain(0.30)',
      ')',
    ].join('\n'),
  },
  {
    // Lush pad — CC0 Vanyamba choir/Fantasy pad + CAT-FOX IDM Atmosphare.
    // Long attack + release for cinematic feel. C-E-G-A chord progression.
    id: 'lush-pad',
    name: 'Lush pad',
    artist: 'CC0 Choir+IDM',
    score: [
      '// Lush pad — CC0 sustained pads (synth:pad-*) + strings + soft bass',
      'stack(',
      '  // Sustained chord pad — slow attack/release для cinematic feel',
      '  note("[c3,e3,g3] [e3,g3,b3] [g3,b3,d4] [a3,c4,e4]")',
      '    .s("synth:pad-c3").attack(0.5).release(2).gain(0.32).room(.6),',
      '  // High pad layer — fifth up, для shimmer',
      '  note("[g3,b3,d4] [b3,d4,f#4] [d4,f#4,a4] [e4,g4,c5]")',
      '    .s("synth:pad-e3").attack(0.7).release(2.5).gain(0.20).room(.7),',
      '  // Strings — sustained C4 sample как foundation',
      '  note("[c4,g4] [e4,b4] [g4,d5] [a4,e5]")',
      '    .s("synth:strings-c4").attack(1.0).release(3).gain(0.18).room(.5),',
      '  // Sub-bass — root notes на каждый аккорд',
      '  note("<c2 e2 g2 a2>").s("synth:bass-c2").gain(0.18).lpf(300).room(.3)',
      ')',
    ].join('\n'),
  },
  {
    // Retro lead — CC0 Garzul Minimoog vibrating E-4 + G-4. Classic
    // 80s-style lead line with vibrato + delay.
    id: 'retro-lead',
    name: 'Retro lead',
    artist: 'CC0 Minimoog',
    score: [
      '// Retro lead — CC0 Minimoog (synth:lead-*) + delay, classic 80s feel',
      'stack(',
      '  // Lead line — восходящая фраза E G E B A G E',
      '  note("e4 ~ g4 ~ e5 ~ b4 ~ a4 g4 e4 ~").s("synth:lead-e4")',
      '    .gain(0.35).delay(.25).room(.4),',
      '  // Octave-down echo (двойная линия через полтакта)',
      '  note("~ ~ e3 ~ ~ ~ g3 ~ ~ ~ ~ e3 ~").s("synth:lead-g4")',
      '    .gain(0.20).delay(.375).room(.4),',
      '  // Soft kick — backbeat minimal (1 и 3)',
      '  s("bd ~ ~ ~ bd ~ ~ ~").decay(.10).sustain(0).gain(0.18),',
      '  // Bass — root notes (поддержка lead линии)',
      '  note("<e2 e2 e2 e2 g2 e2 b2 e2>").s("synth:bass-c2").gain(0.25).lpf(400)',
      ')',
    ].join('\n'),
  },
  {
    // toms-funk — функ-том филинг через 3 toms (low/mid/high).
    // Использует cc0 сэмплы tom-l / tom-m / tom-h.
    id: 'toms-funk',
    name: 'Toms funk (samples)',
    artist: 'Freesound CC0',
    score: [
      '// toms funk — филинг через 3 toms (low/mid/high), CC0 Freesound',
      'stack(',
      '  // Tom fill — low → mid → high, по такту',
      '  s("~ ~ drums:tom-l ~ drums:tom-m ~ drums:tom-h ~").gain(0.45),',
      '  // Креш — на каждом такте как fill-акцент',
      '  s("~ ~ ~ ~ ~ ~ ~ drums:crash").gain(0.30),',
      '  // Райд — длинный «шум» на фоне (время от времени)',
      '  s("drums:ride ~ ~ ~ ~ ~ ~ ~").gain(0.25),',
      '  // Лёгкий kick для басовой основы',
      '  s("bd ~ ~ ~ ~ ~ ~ ~").gain(0.30)',
      ')',
    ].join('\n'),
  },
];
