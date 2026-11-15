import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/app.css';

// StrictMode is intentionally omitted: its double-mounted effects tear down the
// per-label React roots that drei <Html> creates inside the WebGL scene.
// Liquid-glass light: only the glass element under the pointer gets a soft, local glint
// (custom properties on that element), so moving the mouse repaints one element, not the UI.
{
  const SEL = '.glass, .segmented, .icon-btn, .tool-row';
  let current: HTMLElement | null = null;
  let raf = 0, x = 0, y = 0;
  const apply = () => {
    raf = 0;
    if (!current) return;
    const r = current.getBoundingClientRect();
    current.style.setProperty('--mx', `${x - r.left}px`);
    current.style.setProperty('--my', `${y - r.top}px`);
  };
  window.addEventListener('pointermove', (e) => {
    const el = (e.target as Element | null)?.closest?.(SEL) as HTMLElement | null;
    if (el !== current) {
      current?.classList.remove('is-lit');
      current = el;
      current?.classList.add('is-lit');
    }
    x = e.clientX;
    y = e.clientY;
    if (current && !raf) raf = requestAnimationFrame(apply);
  }, { passive: true });
}

createRoot(document.getElementById('root')!).render(<App />);
