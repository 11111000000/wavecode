import { z } from 'zod';

/**
 * Tool: editScore
 *
 * Pure tool — заменяет oldText на newText в score.
 * Используется AI-агентом через LLM function calling.
 */

export const editScoreInput = z.object({
  oldText: z.string().min(1),
  newText: z.string(),
});

export type EditScoreInput = z.infer<typeof editScoreInput>;

export const editScoreDescription =
  'Точечная правка блока в score: заменить oldText на newText. oldText должен встречаться ровно один раз.';

export const applyEdit = (
  score: string,
  oldText: string,
  newText: string,
): string => {
  const idx = score.indexOf(oldText);
  if (idx === -1) {
    throw new Error('applyEdit: oldText not found in score');
  }
  if (score.indexOf(oldText, idx + 1) !== -1) {
    throw new Error('applyEdit: oldText occurs more than once; provide more context');
  }
  return score.slice(0, idx) + newText + score.slice(idx + oldText.length);
};