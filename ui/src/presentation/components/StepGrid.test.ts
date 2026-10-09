import { describe, it, expect } from 'vitest';
import {
  emptyGrid,
  setCell,
  gridToScore,
} from '~/domain/music/gridTypes';
import { GRID_ROWS } from '~/domain/music/gridTypes';

describe('StepGrid integration — grid-to-score pipeline', () => {
  it('empty grid → empty stack snippet', () => {
    const snippet = gridToScore(emptyGrid());
    expect(snippet).toContain('stack(');
    expect(snippet).toContain(')');
    // All rows are rest patterns
    for (let r = 0; r < GRID_ROWS.length; r += 1) {
      expect(snippet).toContain(`s("~ ~ ~ ~ ~ ~ ~ ~"`);
    }
  });

  it('single kick at step 0 → only first column of bd row has note', () => {
    let g = emptyGrid();
    g = setCell(g, 0, 0, true);
    const snippet = gridToScore(g);
    expect(snippet).toMatch(/s\("bd ~ ~ ~ ~ ~ ~ ~"\),/);
    // Other rows are silent
    expect(snippet).toMatch(/s\("~ ~ ~ ~ ~ ~ ~ ~"\),/);
  });

  it('classic rock beat (kick-snare-kick-snare + hihat every step)', () => {
    let g = emptyGrid();
    g = setCell(g, 0, 0, true); // bd on step 0
    g = setCell(g, 0, 2, true); // bd on step 2
    g = setCell(g, 1, 1, true); // sd on step 1
    g = setCell(g, 1, 3, true); // sd on step 3
    for (let c = 0; c < 8; c += 1) g = setCell(g, 2, c, true); // hh every step
    const snippet = gridToScore(g);
    expect(snippet).toMatch(/s\("bd ~ bd ~ ~ ~ ~ ~"\),/); // row 0: bd on 0,2 only
    expect(snippet).toMatch(/s\("~ sd ~ sd ~ ~ ~ ~"\),/); // row 1: sd on 1,3 only
    expect(snippet).toMatch(/s\("hh hh hh hh hh hh hh hh"\),/); // row 2: every step
  });
});
