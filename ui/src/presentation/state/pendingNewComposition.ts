/**
 * pendingNewComposition — мост между лендингом и редактором.
 *
 * Лендинг (Hero «Создать») хочет «открыть редактор И создать новую
 * композицию», а не «открыть редактор и загрузить прошлую». Но мы
 * специально отделили компоненты: `Hero` не знает про `appStore`,
 * `useAppBootstrap` не знает про `?prompt=`-query. Мост —
 * sessionStorage:
 *
 *   click «Создать»
 *      ↓ setPendingNew(text)
 *   navigate #/app
 *      ↓ onMount AppShell → useAppBootstrap
 *      ↓ consumePendingNew() → есть?
 *          да → createNewComposition(prompt) вместо restoreFromIdb
 *          нет → restoreFromIdbOrShare() как обычно
 *
 * sessionStorage, а не signal/import, потому что Hero и AppShell —
 * разные компоненты и могут жить в разных жизненных циклах, а
 * sessionStorage переживает навигацию `#/landing ↔ #/app`.
 *
 * Ключ НЕ в IDB (постоянный), а в session — после релоада страницы
 * буфер очищается, чтобы юзер не попадал в «застрял в новой
 * композиции» при reload.
 */

const KEY = 'wavecode-pending-new-v1';

type PendingPayload = {
  readonly prompt: string | undefined;
};

const safeParse = (raw: string | null): PendingPayload | null => {
  if (raw === null) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (typeof obj !== 'object' || obj === null) return null;
    const prompt = obj.prompt;
    return {
      prompt: typeof prompt === 'string' && prompt.length > 0
        ? prompt
        : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Поставить флаг «создать новую композицию при следующем mount
 * AppShell». Если `prompt` пустой/undefined — флаг просто
 * означает «новая композиция без стартового промпта».
 */
export const setPendingNew = (prompt?: string): void => {
  try {
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      sessionStorage.setItem(KEY, '{}');
      return;
    }
    sessionStorage.setItem(KEY, JSON.stringify({ prompt: prompt.trim() }));
  } catch {
    /* sessionStorage недоступен — флаг просто не выставится;
       юзер попадёт в обычный restoreFromIdbOrShare, ничего не сломается */
  }
};

/**
 * Снять флаг и вернуть payload (или `null`, если флага нет).
 * Вызывается ровно один раз из useAppBootstrap, после чего
 * ключ очищается — повторный mount в той же сессии отработает
 * штатно (restore from IDB).
 */
export const consumePendingNew = (): PendingPayload | null => {
  let payload: PendingPayload | null = null;
  try {
    payload = safeParse(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
  } catch {
    payload = null;
  }
  return payload;
};

/** Тестовая проверка: выставлен ли сейчас флаг (без чтения). */
export const hasPendingNew = (): boolean => {
  try {
    return sessionStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
};
