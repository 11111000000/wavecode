/* <reference types="solid-js" /> */
import { render } from 'solid-js/web';
import { wrapStrudelLogger } from './infrastructure/audio/strudelPatches';
import { logger } from './infrastructure/log';
import { App } from './App';
import './index.css';
import { setPendingShare } from './presentation/state/shareState';
import { parseShareUrl } from './domain/urlCodec';

// Wrap strudel logger early, before any Strudel module is dynamically imported.
// This strips `%c<msg>` + CSS-string emissions from log output so console viewers
// that don't render `%c` styling don't get `background-color: …` appended to
// messages. See strudelPatches.ts for the full rationale.
wrapStrudelLogger();

// Install the log ring-buffer capture as the next bootstrap step. Order is
// load-bearing — see `infrastructure/log/logger.ts` header for the full
// rationale, but the short version is:
//
//   1. wrapStrudelLogger()  — strips %c + CSS-arg from console.log
//   2. logger.install()     — captures all subsequent console.* to the buffer
//   3. installConsoleGlobals() (in App onMount) — window.error → pushToast
//
// Without this call, the ring buffer is empty until the user first opens
// the ConsoleSheet — which means every Strudel/cyclist/sampler log from
// boot until the first sheet open is silently dropped. logger.install()
// is idempotent (`installed` flag in logger.ts) so calling it again from
// anywhere later is a no-op.
logger.install();

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found in index.html');

// Clear fallback "loading..." before Solid mounts.
root.replaceChildren();

// Parse `?s=...` до монтирования App. Если есть — кладём encoded payload
// в глобальный pending state. App.tsx после `repo.loadScore()` решит:
//   - IDB пуст → auto-dispatch pending (URL wins по дефолту).
//   - IDB не пуст → оставить pending для модалки «Load shared snippet»
//     (юзер явно подтверждает перезапись локальной работы).
setPendingShare(parseShareUrl(window.location.search));

render(() => <App />, root);
