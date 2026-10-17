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
 *   - Dreampop: 16th-note strum + chorus pad
 *   - Step Grid demo: rock beat для 🎹 Step
 *   - Piano ballad: Salamander Piano v3 (CC0)
 *   - 808 classic (synth): чистый Strudel-синтез, no samples
 *   - Analog bass (synth): CC0 Moog-стиль
 *   - 808 king (samples): CC0 Freesound drums
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
      '// Creep (Radiohead) — G → B → C → Cm, indie-rock с Hendrix-style аранжировкой',
      'stack(',
      '  // Chord pad — voicing() берёт chord-name → Tonal/Chord-symbol, даёт правильную инверсию',
      '  chord("<G B C Cm>").voicing().s("triangle").gain(0.18).lpf(1500).room(.3),',
      '  // Acoustic guitar arpeggio — sawtooth + slight shape() эмулирует string',
      '  note("<g3 b3 d4 b3 c4 b3 c4 ees4 / e3 g3 c4 g3 e3 g3 c4 g3>").s("sawtooth").shape(0.3).gain(0.12).lpf(2500).room(.4),',
      '  // Bass — root notes, G2/B2/C3/C3',
      '  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),',
      '  // Acoustic kit: kick на 1/3, snare backbeat, 8th-note hihat',
      '  s("drums_bd ~ drums_bd ~").gain(0.55),',
      '  s("~ drums_sd ~ drums_sd").gain(0.28),',
      '  s("drums_hh*8").decay(.04).sustain(0).gain(0.15)',
      ')',
    ].join('\n'),
  },
  {
    // EDM house — multi-section: filter build → drop → breakdown → drop2 (~8 sec).
    // Filter sweep использует slow() внутри секций для organic build.
    id: 'edm-house',
    name: 'EDM 4-on-floor',
    artist: 'House',
    score: [
      '// EDM house — build → drop → breakdown → drop2 (cat of 4 sections)',
      'cat([',
      '  // ===== Section 1: BUILD — 4-on-floor с поднимающимся filter на lead =====',
      '  stack(',
      '    s("drums_bd*4").gain(0.45),',
      '    // Filter sweep — lpf на supersaw поднимается с 400 до 4000 через slow(2)',
      '    note("<a4 c5 e5 g5>").s("supersaw").decay(.15).sustain(0.2).gain(0.14).lpf(saw.range(400, 4000).slow(1)),',
      '    // Sub bass + soft chord stab на офф-битах',
      '    chord("<Am F>").voicing().s("square").attack(.001).decay(.15).sustain(0).gain(0.06).room(.3),',
      '    s("~ ~ ~ cp ~ ~ ~ ~").gain(0.20)',
      '  ),',
      '  // ===== Section 2: DROP — full kit + supersaw + chord stab + sub =====',
      '  stack(',
      '    s("drums_bd*4").gain(0.55),',
      '    s("<~ hh [~ hh] hh ~ hh [~ hh hh]>").swing(0.2).decay(.05).gain(0.22),',
      '    note("<a4 c5 e5 g5 a4 c5 e5 g5>").s("supersaw").decay(.15).sustain(0.2).gain(0.18).lpf(4000),',
      '    chord("<Am F C G>").voicing().s("square").attack(.001).decay(.15).sustain(0).gain(0.12).lpf(2500).room(.3),',
      '    note("<a1 c2 f1 g1>").s("sine").lpf(120).gain(0.40),',
      '    s("~ drums_sd ~ drums_sd").gain(0.20),',
      '    s("~ ~ ~ cp ~ ~ ~ cp").gain(0.18)',
      '  ),',
      '  // ===== Section 3: BREAKDOWN — только lead + soft chord pad, без kick =====',
      '  stack(',
      '    // Только lead, медленнее арпеджио (sequence вместо <>)',
      '    note("a4 c5 e5 g5 a4 c5 e5 g5").s("supersaw").decay(.3).sustain(0.4).gain(0.16).lpf(3000).room(.5),',
      '    // Soft pad через chord().voicing() с reverb',
      '    chord("<Am F C G>").voicing().s("triangle").attack(.05).decay(.3).sustain(.1).gain(0.10).room(.6),',
      '    // Тихий hi-hat для движения',
      '    s("~ hh ~ hh ~ hh ~ hh").decay(.05).gain(0.10).room(.4),',
      '    // Crash в начале секции',
      '    s("drums_crash ~ ~ ~ ~ ~ ~ ~").decay(.4).gain(0.20).room(.5)',
      '  ),',
      '  // ===== Section 4: DROP2 — full energy + сверху crash + sub-bass motion =====',
      '  stack(',
      '    s("drums_bd*4").gain(0.60),',
      '    s("<~ hh [~ hh] hh ~ hh [~ hh hh]>").swing(0.2).decay(.05).gain(0.25),',
      '    note("<a4 c5 e5 g5 a4 c5 e5 g5>").s("supersaw").decay(.15).sustain(0.2).gain(0.20).lpf(4500),',
      '    chord("<Am F C G>").voicing().s("square").attack(.001).decay(.15).sustain(0).gain(0.14).lpf(2500).room(.3),',
      '    // Sub-bass с motion — октавный bounce',
      '    note("<a1 ~ a1 c2 a1 ~ a1 g1>").s("sine").lpf(120).gain(0.45),',
      '    s("~ drums_sd ~ drums_sd").gain(0.22),',
      '    s("~ ~ ~ cp ~ ~ ~ cp").gain(0.20),',
      '    // Crash downbeat',
      '    s("drums_crash ~ ~ ~ ~ ~ ~ ~").gain(0.30)',
      '  )',
      '])',
    ].join('\n'),
  },
  {
    // Hip-hop boom-bap: swing 16ths, hard kick 2&4, snare 3, vinyl noise.
    id: 'hiphop-boombap',
    name: 'Hip-hop boom-bap',
    artist: '90s NYC',
    score: [
      '// Hip-hop boom-bap — RZA-style swing 16ths + piano sample chord + vinyl crackle',
      'stack(',
      '  // Hard kick on 2 и 4 (snare-side)',
      '  s("~ bd ~ bd ~ bd ~ bd").gain(0.55).decay(.05),',
      '  // Snare backbeat — 2 и 4 (было только на 3)',
      '  s("~ ~ sd ~ ~ ~ sd ~").gain(0.45),',
      '  // Swing 16ths hi-hat — humanized feel, через swing(0.5, 1/8)',
      '  s("drums_hh*8").swing(0.5, 1/8).decay(.04).gain(0.20),',
      '  // Bass — root + fifth alternating',
      '  note("<a2 e2 a2 e2 a2 e2 a2 e2>").s("triangle").gain(0.30).lpf(500),',
      '  // Piano sample-loop chord — A minor → D minor → A minor → E minor (Wu-Tang feel)',
      '  // Применяем chord().voicing() — пускай Tonal расставит голоса',
      '  chord("<Am Dm Am Em>").voicing().s("piano_a4").decay(.4).sustain(.2).gain(0.10).room(.4),',
      '  // Vinyl crackle — поднято с 0.05 до 0.10',
      '  s("white*16").hpf(8000).gain(0.10)',
      ')',
    ].join('\n'),
  },
  {
    // Jazz ii-V-I: Dmin7 → G7 → Cmaj7 walking bass + comping chords.
    id: 'jazz-ii-v-i',
    name: 'Jazz ii-V-I',
    artist: 'Bebop',
    score: [
      '// Jazz ii-V-I — walking bass + comping + brass stab + brushed kit (12-step cycle, ii-V-I-VI turnaround)',
      'stack(',
      '  // Walking bass — Dmin7: D-F-A-C; G7: G-B-D-F; Cmaj7: C-E-G-B; A7b9: A-C-E-G-Bb (4-bar turnaround)',
      '  // Tonic в low octave, walking через Dmin7 → G7 → Cmaj7 → A7b9 (ii-V-I-VI)',
      '  note("d2 f2 a2 c3 g2 b2 d3 f3 c3 e3 g3 b3 a2 c3 e3 g3").s("triangle").gain(0.30).lpf(600),',
      '  // Comping chords — sus extensions, 4 аккорда (один на 3 бита)',
      '  chord("<Dmin7 G7 Cmaj7 A7b9>").voicing().s("triangle").gain(0.18).room(.3),',
      '  // Piano comping (top of comp chord) — короткие stabs с fast decay',
      '  chord("<Dmin7 G7 Cmaj7 A7b9>").voicing().s("piano_a4").attack(.001).decay(.2).sustain(0).gain(0.12).room(.4),',
      '  // Brass stab (square wave, low gain) — добавляет warmth',
      '  chord("<Dmin7 G7 Cmaj7 A7b9>").voicing().s("square").attack(.001).decay(.25).gain(0.05).lpf(2000),',
      '  // Brushed snare — ghost notes (на 1, «and»-of-2, 4, «and»-of-4)',
      '  s("~ sd ~ sd ~ ~ ~ sd ~").decay(.15).sustain(0.1).gain(0.18),',
      '  // Ride cymbal — light 8ths',
      '  s("drums_ride*8").decay(.3).sustain(0.05).gain(0.12).hpf(5000),',
      '  // Sparse piano lead — Cmaj7 arpeggio 8-note motif с chord-tone accents',
      '  note("c5 e5 g5 b5 a5 g5 e5 g5").s("triangle").gain(0.10).room(.4)',
      ')',
    ].join('\n'),
  },
  {
    // Ambient drone: slow pulse + bell motif + filtered noise + slow LFO bass pulse.
    id: 'ambient-drone',
    name: 'Ambient drone',
    artist: 'Eno',
    score: [
      '// Ambient drone — slow pulse + bell motif + filtered noise + slow LFO bass pulse',
      'stack(',
      '  // Slow bass drone — C2 + G2 sustained',
      '  note("[c2,g2]").s("sine").attack(2).release(4).gain(0.18),',
      '  // Slow LFO modulating filter for movement',
      '  note("[c2,g2]").s("sine").lpf(sine.range(400, 2000).slow(8)).gain(0.12),',
      '  // Mid pad — sustained chord медленно меняется (C → Am → F → G через brackets)',
      '  note("[c3,e3,g3] [a2,c3,e3] [f2,a2,c3] [g2,b2,d3]")',
      '    .s("triangle").attack(1).release(3).gain(0.10).room(.7),',
      '  // Sparse bell motif — pentatonic, 16-step, чтобы был rhythmic feel не статичный хаос',
      '  // C5 — E5 — G5 — E5 пентатоника через ритмический ostinato',
      '  note("<~ c5 ~ e5 g5 ~ e5 ~ c5 ~ ~ g5 ~ e5 ~ c5 ~>").s("triangle").attack(.01).decay(1.5).sustain(0).gain(0.12).room(.7),',
      '  // Texture noise — high-passed, sustained',
      '  s("white*4").hpf(4000).lpf(12000).gain(0.04).room(.7),',
      '  // Subtle sub-pulse на c1 каждые 8 шагов (для ритмической опоры)',
      '  note("c1 ~ ~ ~ ~ ~ ~ ~ c1 ~ ~ ~ ~ ~ ~").s("sine").lpf(60).gain(0.10)',
      ')',
    ].join('\n'),
  },
  {
    // Bossa nova: syncopated clave + nylon comping + shaker.
    id: 'bossa-nova',
    name: 'Bossa Nova',
    artist: 'Jobim',
    score: [
      '// Bossa Nova (Jobim) — Dm7 → G7 → Cmaj7 → Fmaj7, 3+2 son clave',
      'stack(',
      '  // 3+2 son clave — 16-step syncopated cross-rhythm (классика)',
      '  s("rim ~ ~ rim ~ rim ~ ~ rim ~ ~ rim ~ rim ~ ~").decay(.08).gain(0.25),',
      '  // Bass — bossa syncopated, всё в 16-step для синхронности с clave',
      '  note("<a2 ~ a2 ~ g2 ~ ~ a2 ~ f2 ~ a2 c3 ~ a2>").s("triangle").gain(0.30).lpf(500),',
      '  // Nylon-string comping — 4 аккорда, voice-leading между голосами',
      '  chord("<Dm7 G7 Cmaj7 Fmaj7>").voicing().s("triangle").decay(.3).sustain(0.1).gain(0.20).room(.3),',
      '  // Shaker — light 16ths',
      '  s("~ sh ~ sh ~ sh ~ sh ~ sh ~ sh ~ sh ~ sh ~").decay(.04).gain(0.15),',
      '  // Sparse melodic lead — pentatonic в C major / dorian, 16-step cycle',
      '  note("e5 ~ ~ d5 ~ c5 ~ ~ b4 a4 ~ ~ g4 ~ ~").s("triangle").gain(0.10).room(.3)',
      ')',
    ].join('\n'),
  },
  {
    // Trap Atlanta — multi-section: build (hats + sub) → drop (full 808 + hat rolls) →
    // breakdown (sparse bell + clap) → drop2 (full again + crash). ~8 sec.
    id: 'trap-atlanta',
    name: 'Trap Atlanta',
    artist: 'Modern trap',
    score: [
      '// Trap Atlanta — build → drop → breakdown → drop2 (cat of 4 sections)',
      'cat([',
      '  // ===== Section 1: BUILD (1 cycle) — sparse sub + hat buildup + sub bass =====',
      '  stack(',
      '    note("<a1 ~ ~ ~ ~ ~ ~ ~>").s("sine").lpf(80).decay(1.0).sustain(0).gain(0.45),',
      '    s("hh*8 [hh hh]").decay(.05).gain(0.30),',
      '    // Sub-rumble через noise (LPF-фильтрованный)',
      '    s("white*4").lpf(200).gain(0.10)',
      '  ),',
      '  // ===== Section 2: DROP (1 cycle) — full 808 + hat rolls + clap =====',
      '  stack(',
      '    note("<a1 [a1 a1] ~ a1 ~ [a1 a1] e2 a1 ~>").s("sine").lpf(80).decay(1.0).sustain(0).gain(0.55),',
      '    s("bd ~ ~ ~ ~ ~ ~ ~").s("sawtooth").lpf(120).decay(.3).sustain(0).gain(0.45),',
      '    s("~ ~ cp ~ ~ ~ ~ ~").decay(.15).gain(0.40),',
      '    s("~ ~ sd ~ ~ ~ ~ ~").decay(.1).gain(0.25),',
      '    s("hh*8 [hh hh hh]").decay(.05).gain(0.25),',
      '    // Bell lead — minor pentatonic во время drop',
      '    note("~ ~ ~ c5 ~ ~ eb5 ~ ~ ~ g4 ~ ~ ~ a4 ~ eb5 ~ ~").s("triangle").decay(.5).gain(0.12).room(.4),',
      '    s("~ sh ~ ~ ~ sh ~ sh").decay(.04).gain(0.15)',
      '  ),',
      '  // ===== Section 3: BREAKDOWN (1 cycle) — sparse bell + reverb tail + clap ghost =====',
      '  stack(',
      '    // Long sub tail через sine + reverb',
      '    note("a1 ~ ~ ~ ~ ~ ~ ~").s("sine").lpf(80).decay(2).sustain(0).gain(0.30).room(.6),',
      '    // Sparse bell — minor pentatonic, slow ostinato',
      '    note("c5 ~ ~ ~ ~ eb5 ~ ~ ~ ~ ~ g4 ~ ~ ~").s("triangle").attack(.05).decay(1.5).gain(0.14).room(.7),',
      '    // Filtered noise pad для atmospheric feel',
      '    s("white*8").hpf(2000).lpf(8000).gain(0.05).room(.6),',
      '    // Clap ghost на третьем бите',
      '    s("~ ~ cp ~ ~ ~ ~ ~").decay(.20).gain(0.20)',
      '  ),',
      '  // ===== Section 4: DROP2 (1 cycle) — full kit + crash intro =====',
      '  stack(',
      '    note("<a1 [a1 a1] ~ a1 ~ [a1 a1] e2 a1 ~>").s("sine").lpf(80).decay(1.0).sustain(0).gain(0.60),',
      '    s("bd ~ ~ ~ ~ ~ ~ ~").s("sawtooth").lpf(120).decay(.3).sustain(0).gain(0.50),',
      '    s("~ ~ cp ~ ~ ~ ~ ~").decay(.15).gain(0.45),',
      '    s("~ ~ sd ~ ~ ~ ~ ~").decay(.1).gain(0.30),',
      '    s("hh*8 [hh hh hh]").decay(.05).gain(0.28),',
      '    note("~ ~ ~ c5 ~ ~ eb5 ~ ~ ~ g4 ~ ~ ~ a4 ~ eb5 ~ ~").s("triangle").decay(.5).gain(0.14).room(.4),',
      '    s("~ sh ~ ~ ~ sh ~ sh").decay(.04).gain(0.18),',
      '    // Crash на downbeat второй drop-секции',
      '    s("drums_crash ~ ~ ~ ~ ~ ~ ~").gain(0.35)',
      '  )',
      '])',
    ].join('\n'),
  },
  {
    // Reggaeton: dembow rhythm (3+3+2) + detuned synth bass.
    id: 'reggaeton',
    name: 'Reggaetón',
    artist: 'Dembow',
    score: [
      '// Reggaetón — dembow rhythm (3+3+2 = 8-step) + synth bell bass + marimba lead',
      'stack(',
      '  // Классический dembow: kick на 1,3, snare на 2,4, hat на каждой 8-й',
      '  s("bd ~ sd ~ bd ~ sd hh ~").gain(0.50),',
      '  // Detuned synth bass — dembow bell pattern (octave + fifth)',
      '  // 8 бит, мотическая фигура: a1-a2-e2-a1 повторяется с вариациями 5ths',
      '  note("<a1 a2 e2 a1 a2 e2 a2 a1>").s("sawtooth").detune(8).gain(0.32).lpf(800),',
      '  // Marimba lead — pentatonic в A minor, 16-step cycle (вдвое длиннее dembow)',
      '  // каждая нота получает 1/16 cycle, чтобы успевать под dembow',
      '  note("<a5 ~ ~ c5 ~ b4 ~ ~ a4 ~ ~ c5 ~ b4 ~ ~>").s("triangle").decay(.4).gain(0.12).room(.3),',
      '  // Rim click на офф-битах для текстуры',
      '  s("~ ~ rim ~ ~ rim ~ rim ~ ~ rim ~ ~ rim ~").decay(.05).gain(0.10),',
      '  // Subtle shaker на каждой 16-й',
      '  s("~ sh ~ sh ~ sh ~ sh ~ sh ~ sh ~ sh ~").decay(.04).gain(0.12)',
      ')',
    ].join('\n'),
  },
  {
    // Dreampop / shoegaze: 16th-note strum + chorus-washed pad + soft vocal.
    id: 'dreampop',
    name: 'Dreampop',
    artist: 'Shoegaze',
    score: [
      '// Dreampop / shoegaze — jangly 16th strum + chorus-washed pad + soft lead',
      'stack(',
      '  // 16th-note guitar strum — sawtooth + shape(0.4) эмулирует струнную',
      '  // плюс heavy reverb+delay для shoegaze wash',
      '  note("<e4 ~ b4 ~ e4 ~ b4 ~ e4 ~ b4 ~ g4 ~ d4 ~ g4 ~ d4 ~>").s("sawtooth").shape(0.4).gain(0.10).lpf(2500).room(.6).delay(.3),',
      '  // Chorus-washed chord pad — Am → F → C → G (классика dreampop)',
      '  chord("<Am F C G>").voicing().s("triangle").lpf(2000).room(.7).gain(0.16),',
      '  // Bass — root notes, слегка up чтобы держать groove',
      '  note("<a2 f2 c2 g2 a2 f2 c2 g2>").s("triangle").gain(0.30).lpf(500),',
      '  // Soft vocal lead — triangle с медленной attack и reverb (lo-fi vocal feel)',
      '  note("a4 ~ c5 ~ e5 ~ c5 ~ a4 ~ g4 ~ a4 ~ c5 ~ e5 ~ c5 ~").s("triangle").attack(.05).decay(.3).sustain(.1).gain(0.10).room(.5).lpf(2500),',
      '  // Soft kick на 1 и 3 (sampled с deep lpf)',
      '  s("drums_bd ~ ~ drums_bd ~ ~ ~ ~").decay(.10).gain(0.22)',
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
    // Uses `piano_a4` for the right hand (range f4..d5, all within ±4 semitones
    // of A4) and `piano_c4` for the left hand (range f3..d4, all within ±5
    // semitones of C4). Strudel pitch-shifts the sample to each target note.
    id: 'piano-ballad',
    name: 'Piano ballad',
    artist: 'Salamander',
    score: [
      '// Piano ballad — Salamander Piano v3 (CC0) + vi-IV-I-V → vi-iii-IV-V progression',
      'stack(',
      '  // Right hand — 16th-note arpeggio (Billy Joel style), wider range',
      '  note("a4 c5 e5 c5 f4 a4 c5 e5 b4 d5 f5 d5 c5 e5 g5 e5 f4 a4 c5 e5 a4 c5 e5 g4").s("piano_a4").gain(0.45).room(.4),',
      '  // Left hand — vi-IV-I-V chord roots c разными voicings через brackets',
      '  // Am(ACE), F(FAC), C(CEG), G(GBD) — каждая 4 бита',
      '  note("<[a2,c3,e3] [f2,a2,c3] [c3,e3,g3] [g2,b2,d3]>").s("piano_c4").gain(0.40).room(.3),',
      '  // Soft sustained pad layer — triangle через chord().voicing() для подложки',
      '  chord("<Am F C G>").voicing().s("triangle").gain(0.10).room(.5),',
      '  // Soft kick on 1 и 3',
      '  s("drums_bd ~ ~ drums_bd ~ ~ ~ ~").decay(.15).gain(0.20),',
      '  // Brush snare — backbeat на 2 и 4',
      '  s("~ ~ drums_sd ~ ~ ~ drums_sd ~").decay(.20).sustain(0.05).gain(0.16)',
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
      '  // Kick — паттерн 808 на 1 и «and»-of-2: bd ~ ~ bd ~ ~ bd ~',
      '  s("bd ~ ~ bd ~ ~ bd ~").s("sine").lpf(80).decay(0.4).sustain(0).gain(0.55),',
      '  // Snare — noise burst с band-pass (2 и 4 = backbeat)',
      '  s("~ drums_sd ~ drums_sd").s("white").hpf(1500).lpf(8000).decay(0.15).gain(0.40),',
      '  // Closed hat — off-beat 8ths (classic house/808)',
      '  s("~ ~ hh ~ ~ ~ hh ~").s("white").hpf(8000).decay(0.05).gain(0.22),',
      '  // Open hat — раз в cycle, long sustain',
      '  s("oh ~ ~ ~ ~ ~ ~ ~").s("white").hpf(8000).decay(0.25).gain(0.20),',
      '  // Sub bass с motion — 8 бит, octave bounce + fifth',
      '  note("<a1 ~ a1 ~ a1 e1 a1 ~>").s("sine").lpf(120).gain(0.45)',
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
      '// Analog bass — CC0 Moog sample pack (synth:bass-*) + subtle kit + counter-bass motion',
      'stack(',
      '  // Main bass: roots+fifths+octaves с melodic motion (8 шагов через 4 аккорда)',
      '  note("<c2 c2 g1 c2 c2 c2 a1 c2>").s("synth_bass-c2").gain(0.45).lpf(500),',
      '  // Counter-bass: octave-up chord-fifth motion',
      '  note("<e2 e2 c2 g1 e2 e2 a1 e2>").s("synth_bass-c2").gain(0.18).lpf(800),',
      '  // Sub-bass sub-frequency через sine (octave below)',
      '  note("<c1 ~ c1 ~ c1 g1 c1 ~>").s("sine").lpf(80).gain(0.30),',
      '  // Soft kick on 1 и «and»-of-3',
      '  s("bd ~ ~ ~ bd ~ ~ bd").decay(.10).sustain(0).gain(0.28),',
      '  // Subtle closed hihat — 8ths',
      '  s("white*8").hpf(8000).decay(.03).sustain(0).gain(0.12),',
      '  // Brush snare accent на 4',
      '  s("~ ~ ~ ~ sd ~ ~ ~").decay(.12).gain(0.18)',
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
      '// 808 king (samples) — 4-on-floor + backbeat + clap fill + sub-bass with motion',
      'stack(',
      '  // Kick — каждый бит (4-on-floor)',
      '  s("drums_bd*4").gain(0.55),',
      '  // Snare — backbeat (2 и 4)',
      '  s("~ drums_sd ~ drums_sd").gain(0.40),',
      '  // Closed hat — 8-е ноты с лёгкой shuffle',
      '  s("drums_hh*8").swing(0.15).gain(0.22),',
      '  // Clap — на 7-м шаге как fill',
      '  s("~ ~ ~ ~ ~ ~ ~ drums_cp").gain(0.35),',
      '  // Sub-bass с melodic motion (4 аккорда через 8 бит — A1, A1, A1, E1 sub-octave)',
      '  note("<a1 a1 a1 a1 a2 e1 a1 a1>").s("sine").lpf(120).gain(0.30),',
      '  // Open hat accent на «and»-of-4',
      '  s("~ ~ ~ ~ ~ ~ ~ oh").decay(.20).gain(0.18)',
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
      '// Retro lead (CC0 Minimoog) — lead line + octave echo + chord stab + bass motion',
      'stack(',
      '  // Lead line — iconic phrase E G E B A G E (16-step)',
      '  note("e4 ~ g4 ~ e5 ~ b4 ~ a4 g4 e4 b4 ~").s("synth_lead-e4")',
      '    .gain(0.35).delay(.25).room(.4),',
      '  // Octave-down echo (двойная линия через полтакта)',
      '  note("~ ~ e3 ~ ~ ~ g3 ~ ~ ~ ~ e3 ~").s("synth_lead-g4")',
      '    .gain(0.20).delay(.375).room(.4),',
      '  // Chord stab — Em9 → G → A → Em (4 аккорда, 8 бит каждый)',
      '  chord("<Em G A Em>").voicing().s("synth_pad-c3").attack(.001).decay(.2).sustain(0).gain(0.10).room(.4),',
      '  // Bass — root с melodic motion (root, fifth, root, root, root, fifth, octave, root)',
      '  note("<e2 e2 b1 e2 e2 g2 e2 b1>").s("synth_bass-c2").gain(0.25).lpf(400),',
      '  // Soft kick — backbeat minimal (1 и 3) с gain boost',
      '  s("bd ~ ~ ~ bd ~ ~ ~").decay(.10).sustain(0).gain(0.22),',
      '  // Closed hi-hat accents',
      '  s("~ ~ hh ~ ~ ~ hh ~").decay(.05).sustain(0).gain(0.15)',
      ')',
    ].join('\n'),
  },
  {
    // toms-funk — full funk groove with tom fills as transitions within kit.
    // Использует cc0 сэмплы tom-l / tom-m / tom-h + crash + ride.
    id: 'toms-funk',
    name: 'Toms funk (samples)',
    artist: 'Freesound CC0',
    score: [
      '// Toms funk (samples) — full funk groove с tom fills как transitions, CC0 Freesound',
      'stack(',
      '  // Kick на 1 и «and»-of-3 (funk pocket)',
      '  s("bd ~ ~ bd ~ ~ ~ ~ bd ~ bd ~ ~ ~ ~ bd").gain(0.45),',
      '  // Snare backbeat с ghost notes (funk triplet feel)',
      '  s("~ ~ sd ~ ~ ~ ~ sd ~ ~ ~ sd ~ sd ~ ~").gain(0.30),',
      '  // Hi-hat — 16ths с shuffle для groove',
      '  s("drums_hh*16").swing(0.3, 1/16).decay(.04).gain(0.18),',
      '  // Bass — root + fifth alternating (8 бит)',
      '  note("<a2 e2 a2 e2 a2 e2 a2 e2>").s("triangle").gain(0.35).lpf(500),',
      '  // Tom fill — low → mid → high по последней половине cycle (fill-in)',
      '  s("~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ drums_tom-l drums_tom-m drums_tom-h").gain(0.40),',
      '  // Crash accent на первом бите (downbeat mark)',
      '  s("drums_crash ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~").gain(0.25),',
      '  // Ride — bridge support в середине cycle',
      '  s("~ ~ ~ ~ ~ ~ ~ ~ drums_ride ~ ~ ~ ~ ~ ~ ~").gain(0.20)',
      ')',
    ].join('\n'),
  },
];

/**
 * Result of running a preset's score through Strudel's transpiler
 * in a sandbox. Used by the dev-time preset lint to surface warnings
 * (e.g. `n("note_name")` misuse, missing samples, etc.) without
 * firing the audio scheduler.
 */
export type PresetValidationResult = {
  readonly presetId: string;
  readonly warnings: readonly { level: 'warn' | 'error'; message: string }[];
  readonly elapsedMs: number;
  readonly error?: string;
};

/**
 * Run a preset's score through Strudel's transpiler in a sandbox and
 * collect `console.warn` / `console.error` calls emitted during
 * evaluation. Returns the captured diagnostics plus a thrown-error
 * message if the transpiler itself rejected the snippet.
 *
 * The transpiler and console are injected so tests can supply a mock
 * `console` (real `console.warn` would pollute test output) and a
 * stub `transpiler.evaluate` that does not require the audio
 * modules to be loaded.
 *
 * Throws nothing: if `transpiler.evaluate` rejects, the error message
 * is captured in `result.error` and `warnings` is empty.
 */
export const validatePreset = async (
  preset: Preset,
  opts: {
    transpiler: {
      evaluate: (code: string, transpiler: unknown) => Promise<unknown>;
      transpiler?: unknown;
    };
    console: Pick<Console, 'warn' | 'error'>;
  },
): Promise<PresetValidationResult> => {
  const warnings: { level: 'warn' | 'error'; message: string }[] = [];
  const realWarn = opts.console.warn;
  const realError = opts.console.error;
  const captureWarn: typeof opts.console.warn = (...args: unknown[]) => {
    warnings.push({ level: 'warn', message: args.map(String).join(' ') });
    realWarn.apply(opts.console, args);
  };
  const captureError: typeof opts.console.error = (...args: unknown[]) => {
    warnings.push({ level: 'error', message: args.map(String).join(' ') });
    realError.apply(opts.console, args);
  };
  opts.console.warn = captureWarn;
  opts.console.error = captureError;
  const startedAt = performance.now();
  try {
    await opts.transpiler.evaluate(preset.score, opts.transpiler.transpiler);
  } catch (err) {
    const elapsedMs = performance.now() - startedAt;
    return {
      presetId: preset.id,
      warnings: [],
      elapsedMs,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    opts.console.warn = realWarn;
    opts.console.error = realError;
  }
  const elapsedMs = performance.now() - startedAt;
  return {
    presetId: preset.id,
    warnings: Object.freeze(warnings),
    elapsedMs,
  };
};
