import { describe, it, expect } from 'vitest';
import {
  detectLayerSound,
  findSoundCall,
  hasExplicitSound,
  isMelodicLayer,
  replaceLayerSound,
} from './layerSound';

/**
 * layerSound — чтение и переписывание `.s("…")` в тексте слоя.
 *
 * Тесты закрывают три класса ошибок:
 *   1. регулярка нашла бы `.s(` внутри строки или комментария;
 *   2. «последний» вызов `.s()` в цепочке — тот, что реально звучит;
 *   3. дописывание `.s()` в конец не должно ломать хвостовой комментарий.
 */
describe('layerSound', () => {
  describe('findSoundCall', () => {
    it('находит обычный вызов .s("…")', () => {
      const call = findSoundCall('note("c4").s("piano")');
      expect(call).not.toBeNull();
      expect(call!.id).toBe('piano');
      expect(call!.quote).toBe('"');
    });

    it('находит вызов в одинарных кавычках', () => {
      const call = findSoundCall("note('c4').s('triangle')");
      expect(call?.id).toBe('triangle');
      expect(call?.quote).toBe("'");
    });

    it('берёт ПОСЛЕДНИЙ вызов — в цепочке побеждает последний', () => {
      const call = findSoundCall('note("c4").s("piano").s("triangle")');
      expect(call?.id).toBe('triangle');
    });

    it('не путает .s("…") с .setCpm(…) и .sustain(…)', () => {
      expect(findSoundCall('note("c4").sustain(0).setCpm(120)')).toBeNull();
    });

    it('не находит .s(…) внутри строкового литерала', () => {
      expect(findSoundCall('note("c4") // пишет .s("piano")')).toBeNull();
    });

    it('не находит .s(…) внутри блочного комментария', () => {
      expect(findSoundCall('/* было .s("piano") */ note("c4")')).toBeNull();
    });

    it('не находит .s(…) с нестроковым аргументом', () => {
      expect(findSoundCall('note("c4").s(someVar)')).toBeNull();
    });

    it('не находит .s(…) с несколькими аргументами', () => {
      expect(findSoundCall('note("c4").s("bd", "sd")')).toBeNull();
    });

    it('не находит s("…") без точки — это выбор сэмпла, а не инструмент', () => {
      expect(findSoundCall('s("drums_bd*4")')).toBeNull();
    });
  });

  describe('detectLayerSound', () => {
    it('возвращает имя звука слоя', () => {
      expect(detectLayerSound('note("c4").s("synth_pad")')).toBe('synth_pad');
    });

    it('возвращает null, если звук не задан', () => {
      expect(detectLayerSound('note("c4")')).toBeNull();
    });
  });

  describe('hasExplicitSound', () => {
    it('различает «задан явно» и «по умолчанию»', () => {
      expect(hasExplicitSound('note("c4").s("piano")')).toBe(true);
      expect(hasExplicitSound('note("c4")')).toBe(false);
    });
  });

  describe('isMelodicLayer', () => {
    it('нота — мелодический слой', () => {
      expect(isMelodicLayer('note("c4")')).toBe(true);
      expect(isMelodicLayer('n("c4 e4")')).toBe(true);
    });

    it('сэмпл — не мелодический слой', () => {
      expect(isMelodicLayer('s("drums_bd*4")')).toBe(false);
      expect(isMelodicLayer('setCpm(120)')).toBe(false);
    });
  });

  describe('replaceLayerSound', () => {
    it('переписывает существующий звук', () => {
      expect(replaceLayerSound('note("c4").s("piano")', 'sawtooth')).toBe(
        'note("c4").s("sawtooth")',
      );
    });

    it('переписывает последний из нескольких', () => {
      expect(replaceLayerSound('note("c4").s("piano").s("triangle")', 'square')).toBe(
        'note("c4").s("piano").s("square")',
      );
    });

    it('дописывает .s(), если звука не было', () => {
      expect(replaceLayerSound('note("c4")', 'triangle')).toBe(
        'note("c4").s("triangle")',
      );
    });

    it('не ломает хвостовой комментарий', () => {
      const out = replaceLayerSound('note("c4") // мелодия', 'triangle');
      expect(out).toBe('note("c4").s("triangle") // мелодия');
    });

    it('сохраняет исходные кавычки', () => {
      expect(replaceLayerSound("note('c4').s('piano')", 'triangle')).toBe(
        "note('c4').s('triangle')",
      );
    });

    it('не трогает остальную цепочку', () => {
      const out = replaceLayerSound(
        'note("c4").s("piano").gain(0.5).lpf(4000)',
        'triangle',
      );
      expect(out).toBe('note("c4").s("triangle").gain(0.5).lpf(4000)');
    });
  });
});
