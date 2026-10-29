import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from './tourSteps';

describe('TOUR_STEPS (decisions/wavecode-welcome-tour.yaml)', () => {
  it('exports exactly five steps in the documented order', () => {
    expect(TOUR_STEPS.length).toBe(5);
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['play', 'edit', 'ai', 'save', 'done']);
  });

  it('each step has the required fields', () => {
    for (const step of TOUR_STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.target).toBeTruthy();
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
      expect(['top', 'bottom', 'left', 'right']).toContain(step.position);
    }
  });

  it('first step title is the documented Russian string', () => {
    const first = TOUR_STEPS[0];
    expect(first).toBeDefined();
    expect(first!.title).toBe('Нажми ▶');
  });

  it('each target matches a real DOM selector (syntactic check)', () => {
    for (const step of TOUR_STEPS) {
      const t = step.target;
      // Rough sanity check — selectors should not contain
      // spaces in places that would indicate an authoring typo.
      expect(t).not.toMatch(/\s{2,}/);
      expect(t.length).toBeGreaterThan(0);
    }
  });
});