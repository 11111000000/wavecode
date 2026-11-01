import { expect, type Page } from '@playwright/test';

/**
 * Wait until the app has persisted the selected preset to IndexedDB.
 *
 * The preset id is written with a 500 ms debounce
 * (`useAutoSave.ts` — `saveActiveTimer`). Until that write lands,
 * IndexedDB still holds the previous id, and a reload restores THAT
 * one and overwrites localStorage with it — so a reload fired straight
 * after the selection looks like the selection was never persisted.
 *
 * Polling IndexedDB is deterministic; a fixed sleep would be a race
 * against the debounce.
 *
 * The database and store names are not hard-coded: `idb-keyval` picks
 * them, and the app only ever opens one database, so the first one
 * reported by `indexedDB.databases()` is the app's.
 */
export const waitForPresetPersisted = async (page: Page, presetId: string): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate(async (key) => {
          const dbs = await indexedDB.databases();
          if (!dbs.length) return null;
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(dbs[0].name as string);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const store = db.objectStoreNames[0];
          if (!store) return null;
          return new Promise<unknown>((resolve) => {
            const req = db.transaction(store, 'readonly').objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
          });
        }, 'wavecode-active-preset-v1'),
      { timeout: 5000, message: `preset "${presetId}" was not persisted to IndexedDB` },
    )
    .toBe(presetId);
};
