/* <reference types="solid-js" /> */
import { render } from 'solid-js/web';
import { App } from './App';
import './index.css';
import './debug.css';
import { setPendingShare } from './presentation/state/shareState';
import { parseShareUrl } from './domain/urlCodec';

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
