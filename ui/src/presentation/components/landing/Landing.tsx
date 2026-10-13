import { onCleanup, onMount, type JSX } from 'solid-js';
import { TopNav } from './sections/TopNav';
import { Hero } from './sections/Hero';
import { SnippetShowcase } from './sections/SnippetShowcase';
import { EditorMockup } from './sections/EditorMockup';
import { Features } from './sections/Features';
import { Architecture } from './sections/Architecture';
import { Panels } from './sections/Panels';
import { TechStack } from './sections/TechStack';
import { QuickStart } from './sections/QuickStart';
import { Footer } from './sections/Footer';

/**
 * Landing — корневой компонент лендинга.
 *
 * На время жизни добавляет класс `wc-landing-active` на <body>,
 * чтобы разморозить overflow/scroll и дать странице нормально
 * скроллиться. На cleanup — снимает класс.
 *
 * Подсветка якорных ссылок в TopNav использует браузерный
 * scroll-spy через IntersectionObserver (минимально, без зависимостей).
 */
export function Landing(): JSX.Element {
  onMount(() => {
    document.body.classList.add('wc-landing-active');

    // Плавный scroll к якорным ссылкам внутри страницы
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const a = target.closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href === '#' || !href.startsWith('#')) return;
      const id = href.slice(1);
      // внутренний якорь, начинающийся не с "top"
      const el = id ? document.getElementById(id) : null;
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    document.addEventListener('click', onClick);
    onCleanup(() => document.removeEventListener('click', onClick));
  });

  onCleanup(() => {
    document.body.classList.remove('wc-landing-active');
  });

  return (
    <div class="landing">
      <TopNav />
      <main>
        <Hero />
        <SnippetShowcase />
        <EditorMockup />
        <Features />
        <Architecture />
        <Panels />
        <TechStack />
        <QuickStart />
      </main>
      <Footer />
    </div>
  );
}
