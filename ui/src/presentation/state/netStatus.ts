import { createSignal } from 'solid-js';

/**
 * netStatus — «мы в сети?».
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6, «Тишина»): индикатора офлайна
 * в приложении не было вообще — при пропаже сети интерфейс молча
 * переставал работать (запросы к LLM уходили в никуда, сэмплы не
 * грузились, и пользователь не понимал почему).
 *
 * Теперь состояние сети — часть ЕДИНОГО статус-кластера в верхней
 * панели (см. StatusStrip.tsx).
 *
 * Слушатели вешает `installNetListeners()`: он возвращает функцию
 * отписки, чтобы компонент мог вызвать её в onCleanup. Несколько
 * подписчиков не мешают друг другу — все они пишут в один сигнал.
 */

const initialOnline = (): boolean => {
  if (typeof navigator === 'undefined') return true;
  // jsdom и часть браузеров не знают про navigator.onLine — считаем,
  // что сеть есть, иначе показали бы ложный «офлайн».
  return navigator.onLine !== false;
};

const [isOnline, setIsOnline] = createSignal<boolean>(initialOnline());

export const netStatus = {
  isOnline,
  /** Вешает слушатели online/offline. Возвращает отписку. */
  installNetListeners(): () => void {
    if (typeof window === 'undefined') return () => {};
    const goOnline = (): void => { setIsOnline(true); };
    const goOffline = (): void => { setIsOnline(false); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  },
} as const;
