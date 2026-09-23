import { HelloPanel } from './presentation/panels/HelloPanel';
import { ScorePanel } from './presentation/panels/ScorePanel';

export function App() {
  return (
    <main class="app">
      <header class="app-header">
        <h1>wavecode</h1>
        <span class="app-subtitle">live-coding · AI · Strudel</span>
      </header>
      <div class="app-body">
        <section class="score-panel">
          <ScorePanel />
        </section>
        <section class="hello-panel">
          <HelloPanel />
        </section>
      </div>
    </main>
  );
}