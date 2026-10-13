/**
 * Run async tasks with a max-concurrency limit. Returns results in
 * completion order (not input order). Failures are surfaced as
 * rejected promises in the results array — caller decides how to
 * handle. If you want all-settled behavior, use Promise.all on the
 * returned promises individually.
 */
export const withConcurrency = <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  return Promise.all(workers).then(() => results);
};
