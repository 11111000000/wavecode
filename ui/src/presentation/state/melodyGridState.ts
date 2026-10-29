import { createSignal } from 'solid-js';
import {
  emptyMelody,
  toggleCellInMelody,
  addCell,
  removeCell,
  isCellActive,
  countMelodyDiff,
  melodiesEqual,
  type MelodyCell,
  type MelodyGrid,
  type MelodyMode,
  MELODY_MODES,
} from '~/domain/music/melodyGridTypes';
import {
  extractMelodyFromScore,
  commitMelodyToScore,
  canEditMelodyLayer,
  type CommitMelodyOptions,
} from '~/domain/music/melodyExtract';

/**
 * Melody Grid reactive state — MODE-AWARE.
 *
 * Mirrors `ui/src/presentation/state/gridState.ts` for the drum
 * StepGrid. Three signals form the full state:
 *   - `melodyMode()` — current interaction mode (view | sketch | edit).
 *   - `melodyDraft()` — what the UI renders. In view mode this mirrors
 *     the score. In sketch mode it's the user's draft (may differ
 *     from melodyLastCommitted). In edit mode it's always equal
 *     to melodyLastCommitted (every tap is a commit).
 *   - `melodyLastCommitted()` — melody at the moment of the last
 *     commit/parse. Used to compute `dirtyMelodyCount()`.
 *
 * Drum grid state (`gridState.ts`) and melody state (this file)
 * live in their own modules BY DESIGN — different domains
 * (drums / melody), different AST gates, different storage
 * shapes (boolean matrix vs sparse (step, midi) tuples).
 * Merging them would tangle the two domains for no benefit;
 * keeping them parallel lets us evolve each independently.
 *
 * See decisions/wavecode-melody-grid.yaml for the design.
 */

// --- Mode signal -----------------------------------------------------------

const [melodyMode, setMelodyModeSig] = createSignal<MelodyMode>('view');

export const getMelodyMode = (): MelodyMode => melodyMode();
export const setMelodyModeDirect = (m: MelodyMode): void => {
  setMelodyModeSig(m);
};
void MELODY_MODES;

// --- Melody signals --------------------------------------------------------

const [melodyDraft, setMelodyDraftSig] = createSignal<MelodyGrid>(emptyMelody());
const [melodyLastCommitted, setMelodyLastCommittedSig] =
  createSignal<MelodyGrid>(emptyMelody());

/** Current visible melody (what `<MelodyGrid />` renders). */
export const getMelodyDraft = (): MelodyGrid => melodyDraft();

/** Melody at the moment of the last commit/parse. */
export const getMelodyLastCommitted = (): MelodyGrid => melodyLastCommitted();

/** Direct setter for IDB restore. */
export const setMelodyLastCommitted = (g: MelodyGrid): void => {
  setMelodyLastCommittedSig(g);
};

/** Number of cells that differ between draft and lastCommitted. */
export const dirtyMelodyCount = (): number =>
  countMelodyDiff(melodyDraft(), melodyLastCommitted());

/** True iff draft and lastCommitted have the same cell set. */
export const isMelodyDraftClean = (): boolean =>
  melodiesEqual(melodyDraft(), melodyLastCommitted());

const setMelodyDraft = (g: MelodyGrid): void => {
  setMelodyDraftSig(g);
};

/** Direct setter for the draft (use sparingly — mostly for IDB). */
export const setMelodyDraftDirect = (g: MelodyGrid): void => {
  setMelodyDraft(g);
};

// --- Cell toggles (draft-only) --------------------------------------------

/** Toggle a cell in the draft. Returns the new draft. Pure on
 *  signals, no side effects. */
export const toggleMelodyCell = (step: number, midi: number): MelodyGrid => {
  const next = toggleCellInMelody(melodyDraft(), step, midi);
  setMelodyDraft(next);
  return next;
};

/** Add a single cell (test-time helper; UI uses toggleMelodyCell). */
export const addMelodyCell = (cell: MelodyCell): MelodyGrid => {
  const next = addCell(melodyDraft(), cell);
  setMelodyDraft(next);
  return next;
};

/** Remove a single cell. */
export const removeMelodyCell = (step: number, midi: number): MelodyGrid => {
  const next = removeCell(melodyDraft(), step, midi);
  setMelodyDraft(next);
  return next;
};

/** Check whether a cell is currently active in the draft. */
export const isMelodyCellActive = (step: number, midi: number): boolean =>
  isCellActive(melodyDraft(), step, midi);

/** Clear the draft (and lastCommitted in sketch mode so the next
 *  view-mode read is consistent). */
export const clearMelodyDraft = (): void => {
  const empty = emptyMelody();
  setMelodyDraftSig(empty);
  setMelodyLastCommittedSig(empty);
};

// --- Mode transitions ------------------------------------------------------

/**
 * Enter view mode. The melody is parsed from the score and both
 * draft and lastCommitted are set to the same value (so dirty
 * count is 0).
 */
export const enterMelodyView = (score: string): void => {
  const parsed = loadMelodyFromScoreInternal(score);
  setMelodyDraftSig(parsed);
  setMelodyLastCommittedSig(parsed);
  setMelodyModeSig('view');
};

/**
 * Enter sketch mode. The draft is kept if it's non-empty (the
 * user is mid-draft), otherwise parsed from the score. This
 * matches the drum grid's "draft is sacred once started" contract.
 */
export const enterMelodySketch = (score: string): void => {
  const current = melodyDraft();
  if (current.length === 0) {
    const parsed = loadMelodyFromScoreInternal(score);
    setMelodyDraftSig(parsed);
    setMelodyLastCommittedSig(parsed);
  }
  setMelodyModeSig('sketch');
};

/**
 * Enter edit mode. Requires a parseable score (i.e. it has a
 * top-level `note(…)` / `n(…)` call reachable from the top
 * level). Returns `{ ok: true }` on success, or
 * `{ ok: false, reason }` on failure.
 */
export const enterMelodyEdit = (
  score: string,
): { readonly ok: boolean; readonly reason?: string } => {
  if (!canEditMelodyLayer(score)) {
    return {
      ok: false,
      reason:
        'Edit mode requires a top-level melody call (note(…) or n(…)). Switch to Sketch to add a melody layer.',
    };
  }
  const parsed = loadMelodyFromScoreInternal(score);
  setMelodyDraftSig(parsed);
  setMelodyLastCommittedSig(parsed);
  setMelodyModeSig('edit');
  return { ok: true };
};

// --- Commit / apply --------------------------------------------------------

/**
 * Sketch mode ↑ commit. Returns the new score string (so the
 * caller can dispatch `replaceScore`) and advances
 * lastCommitted = draft. Returns null on failure (no note-call
 * reachable, no stack to splice into, empty score, …).
 */
export const commitMelodyDraft = (
  currentScore: string,
  opts: CommitMelodyOptions = {},
): string | null => {
  const draft = melodyDraft();
  const out = commitMelodyToScore(currentScore, draft, opts);
  if (!out.ok) return null;
  setMelodyLastCommittedSig(draft);
  return out.score;
};

/**
 * Edit-mode per-tap. Splices the current draft into the score
 * via `commitMelodyToScore` and returns the new score. Returns
 * null when the score is no longer parseable.
 */
export const applyMelodyEditToLayer = (
  currentScore: string,
  opts: CommitMelodyOptions = {},
): string | null => {
  const draft = melodyDraft();
  const out = commitMelodyToScore(currentScore, draft, opts);
  if (!out.ok) return null;
  setMelodyLastCommittedSig(draft);
  return out.score;
};

// --- Internal helpers ------------------------------------------------------

/** Best-effort parse of a score into a melody (uses extractMelodyFromScore). */
const loadMelodyFromScoreInternal = (score: string): MelodyGrid => {
  const out = extractMelodyFromScore(score);
  return out.ok ? out.cells : emptyMelody();
};

// --- Convenience: IDB snapshot --------------------------------------------

/**
 * Persisted MelodyGrid state. `null` from `loadMelodyState` means
 * "no state saved yet" — caller should seed the defaults
 * (mode=view, empty melody).
 */
export type MelodyStateSnapshot = {
  readonly mode: MelodyMode;
  readonly draft: MelodyGrid;
  readonly lastCommitted: MelodyGrid;
};

/** Current snapshot for IDB persistence. */
export const snapshotMelodyState = (): MelodyStateSnapshot => ({
  mode: melodyMode(),
  draft: melodyDraft(),
  lastCommitted: melodyLastCommitted(),
});

/** Restore from an IDB snapshot. Pure on signals. */
export const restoreMelodyState = (snap: MelodyStateSnapshot): void => {
  setMelodyModeSig(snap.mode);
  setMelodyDraftSig(snap.draft);
  setMelodyLastCommittedSig(snap.lastCommitted);
};
