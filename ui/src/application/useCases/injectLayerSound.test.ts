import { describe, it, expect } from 'vitest';
import { injectLayerSound } from './injectLayerSound';

/**
 * injectLayerSound — точечная правка инструмента слоя в партитуре.
 *
 * Главное, что тут проверяется: номер слоя в правке совпадает с
 * номером строки микшера (то есть с перечислением
 * `validateForMixer`), а остальные слои не затрагиваются.
 */
describe('injectLayerSound', () => {
  it('переписывает .s() нужного слоя в multi-section партитуре', () => {
    const score = [
      'cat(',
      '  stack(',
      '    note("c4").s("piano"),',
      '    note("g4").s("triangle")',
      '  ),',
      '  stack(',
      '    note("e4").s("synth_pad")',
      '  )',
      ')',
    ].join('\n');
    const out = injectLayerSound(score, 1, 'sawtooth');
    expect(out).toContain('note("g4").s("sawtooth")');
    expect(out).toContain('note("c4").s("piano")');
    expect(out).toContain('note("e4").s("synth_pad")');
  });

  it('дописывает .s(), если у слоя звука не было', () => {
    const score = 'stack(note("c4"), note("g4"))';
    const out = injectLayerSound(score, 0, 'triangle');
    expect(out).toBe('stack(note("c4").s("triangle"), note("g4"))');
  });

  it('не трогает соседние слои', () => {
    const score = 'stack(note("c4"), note("g4"), note("e4"))';
    const out = injectLayerSound(score, 1, 'square');
    expect(out).toBe('stack(note("c4"), note("g4").s("square"), note("e4"))');
  });

  it('возвращает партитуру без изменений для несуществующего слоя', () => {
    const score = 'stack(note("c4"))';
    expect(injectLayerSound(score, 7, 'triangle')).toBe(score);
  });

  it('возвращает партитуру без изменений для пустого ввода', () => {
    expect(injectLayerSound('', 0, 'triangle')).toBe('');
  });

  it('не принимает пустое имя звука', () => {
    const score = 'stack(note("c4"))';
    expect(injectLayerSound(score, 0, '  ')).toBe(score);
  });

  it('работает с партитурой без stack() — весь текст это один слой', () => {
    expect(injectLayerSound('note("c4")', 0, 'triangle')).toBe(
      'note("c4").s("triangle")',
    );
  });

  it('сохраняет форматирование и комментарии вокруг слоя', () => {
    const score = [
      '// преамбула',
      'stack(',
      '  // первый слой',
      '  note("c4"),',
      '  note("g4")',
      ')',
      '// постфикс',
    ].join('\n');
    const out = injectLayerSound(score, 1, 'triangle');
    expect(out).toContain('// преамбула');
    expect(out).toContain('// первый слой');
    expect(out).toContain('note("g4").s("triangle")');
    expect(out).toContain('// постфикс');
  });
});
