import { describe, it, expect } from 'vitest';
import {
  EMPTY_ROLL_MODEL,
  extractRollModel,
  layerColor,
  rollCycleBounds,
} from './rollModel';
import { BUILTIN_PRESETS } from '~/domain/presets';

/**
 * The roll model is the arrangement: which layers play, how loud,
 * where the sections are and where the drum hits land. These tests
 * pin that structure — it is what the visualisation draws.
 */
describe('extractRollModel', () => {
  it('an empty score is an empty model', () => {
    expect(extractRollModel('')).toEqual(EMPTY_ROLL_MODEL);
  });

  it('a stack of two notes is two layers', () => {
    const model = extractRollModel('stack(note("c4"), note("g4"))');
    expect(model.layers).toHaveLength(2);
    expect(model.layers.every((l) => l.kind === 'melody')).toBe(true);
    expect(model.notes).toHaveLength(2);
  });

  it('a layer keeps its colour by its slot, not by its content', () => {
    const model = extractRollModel('stack(note("c4"), s("drums_bd"))');
    const melody = model.layers.find((l) => l.kind === 'melody')!;
    const drum = model.layers.find((l) => l.kind === 'drum')!;
    // Melodies get the cool half of the wheel, drums the warm one —
    // the first melody layer is cyan, the first drum layer amber.
    expect(layerColor(melody)).toBe('hsl(174 80% 60%)');
    expect(layerColor(drum)).toBe('hsl(8 85% 62%)');
  });

  it('reads the gain of a layer', () => {
    const model = extractRollModel('stack(note("c4").gain(0.25), note("g4").gain(0.5))');
    expect(model.layers[0]!.gain).toBeCloseTo(0.25, 6);
    expect(model.layers[1]!.gain).toBeCloseTo(0.5, 6);
  });

  it('a drum row becomes a layer of hits', () => {
    const model = extractRollModel('stack(s("drums_bd ~ drums_bd ~"))');
    expect(model.notes).toHaveLength(0);
    expect(model.hits).toHaveLength(2);
    expect(model.layers[0]!.kind).toBe('drum');
    expect(model.layers[0]!.sampleName).toBe('drums_bd');
    // The two hits are one bar apart: the mini-notation is 4 steps.
    expect(model.hits[0]!.startCycle).toBeCloseTo(0, 6);
    expect(model.hits[1]!.startCycle).toBeCloseTo(0.5, 6);
  });

  it('a repeated drum token becomes repeated hits', () => {
    const model = extractRollModel('stack(s("drums_hh*8"))');
    expect(model.hits).toHaveLength(8);
    expect(model.hits[1]!.startCycle).toBeCloseTo(0.125, 6);
  });

  it('a cat becomes sections with their spans', () => {
    const model = extractRollModel(
      'cat([stack(note("c4")), stack(note("d4")), stack(note("e4"))])',
    );
    expect(model.sections).toHaveLength(3);
    expect(model.sections[0]!.startCycle).toBe(0);
    expect(model.sections[0]!.endCycle).toBe(1);
    expect(model.sections[2]!.endCycle).toBe(3);
    expect(model.periodCycles).toBe(3);
  });

  it('a section lists the layers that sound in it', () => {
    const model = extractRollModel(
      'cat([stack(note("c4"), note("g3")), stack(note("d4"), s("drums_bd"))])',
    );
    expect(model.sections[0]!.layerIds).toHaveLength(2);
    expect(model.sections[1]!.layerIds).toHaveLength(2);
  });

  it('the Creep preset is 8 sections, 6 layers, verse and chorus apart', () => {
    const creep = BUILTIN_PRESETS.find((p) => p.id === 'creep');
    if (!creep) throw new Error('creep preset missing');
    const model = extractRollModel(creep.score);
    expect(model.sections).toHaveLength(8);
    expect(model.layers.filter((l) => l.kind === 'melody')).toHaveLength(2);
    expect(model.layers.filter((l) => l.kind === 'drum')).toHaveLength(4);
    expect(model.periodCycles).toBe(8);
    expect(model.timeScale).toBeCloseTo(1.3, 6);
    // The verse sections carry two layers, the chorus brings the kit.
    expect(model.sections[0]!.layerIds).toHaveLength(2);
    expect(model.sections[4]!.layerIds.length).toBeGreaterThan(2);
    expect(model.hits.length).toBeGreaterThan(0);
  });

  it('every built-in preset parses into a model', () => {
    for (const preset of BUILTIN_PRESETS) {
      const model = extractRollModel(preset.score);
      expect(model.notes.length + model.hits.length).toBeGreaterThan(0);
    }
  });
});

describe('rollCycleBounds', () => {
  it('an empty model keeps the wide default axis', () => {
    expect(rollCycleBounds(EMPTY_ROLL_MODEL)).toEqual({ lo: 0, hi: 16 });
  });

  it('the axis starts at the pattern phase 0', () => {
    const model = extractRollModel('cat([note("c4"), note("d4"), note("e4")])');
    expect(rollCycleBounds(model).lo).toBe(0);
  });

  it('the axis ends one bar after the last bar of the repetition', () => {
    const model = extractRollModel('cat([note("c4"), note("d4"), note("e4")])');
    expect(rollCycleBounds(model).hi).toBe(4);
  });

  it('a drum-only score is not an empty score', () => {
    const model = extractRollModel('stack(s("drums_bd ~"))');
    expect(rollCycleBounds(model)).toEqual({ lo: 0, hi: 4 });
  });
});
