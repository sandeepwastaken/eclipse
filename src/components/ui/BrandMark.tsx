import { useEffect, useRef } from 'react';

const FRAMES = 120; // 3° apart, west-to-east, frame 0 = the near side (the static logo)
const COLS = 12;
const PX = 96;
const DEG_PER_S = 360 / 9; // the same 9 s per turn as the promo spin

/**
 * The logo. Hovering turns the Moon at its promo-spin speed; leaving eases it back to the
 * near side the short way round. Frames come from scripts/make_logo.py (the same method as the
 * logo and the spin), so every frame is the real Moon in the logo's style.
 */
export function BrandMark() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const st = useRef({ angle: 0, hover: false, raf: 0, last: 0, from: 0, to: 0, t0: 0, easing: false });
  const sheet = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}assets/moon-spin-sprite.webp`;
    img.decode().then(() => (sheet.current = img), () => undefined);
    return () => cancelAnimationFrame(st.current.raf);
  }, []);

  const draw = () => {
    const c = canvas.current, img = sheet.current;
    if (!c || !img) return;
    const g = c.getContext('2d')!;
    const s = st.current;
    g.clearRect(0, 0, c.width, c.height);
    const a = ((s.angle % 360) + 360) % 360;
    if (a < 0.5 || a > 359.5) return; // at rest the crisp vector logo underneath shows
    const i = Math.round(a / (360 / FRAMES)) % FRAMES;
    g.drawImage(img, (i % COLS) * PX, Math.floor(i / COLS) * PX, PX, PX, 0, 0, c.width, c.height);
  };

  const loop = (now: number) => {
    const s = st.current;
    const dt = Math.min(0.1, (now - (s.last || now)) / 1000);
    s.last = now;
    if (s.hover) {
      s.angle += DEG_PER_S * dt;
    } else if (s.easing) {
      // Ease-out back to the near side over ~0.5 s.
      const k = Math.min(1, (now - s.t0) / 500);
      const e = 1 - Math.pow(1 - k, 3);
      s.angle = s.from + (s.to - s.from) * e;
      if (k >= 1) {
        s.easing = false;
        s.angle = 0;
      }
    }
    draw();
    if (s.hover || s.easing) s.raf = requestAnimationFrame(loop);
    else s.raf = 0;
  };

  const start = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const s = st.current;
    s.hover = true;
    s.easing = false;
    if (!s.raf) {
      s.last = 0;
      s.raf = requestAnimationFrame(loop);
    }
  };
  const stop = () => {
    const s = st.current;
    if (!s.hover) return;
    s.hover = false;
    // Back to 0° by the shorter way round.
    const a = ((s.angle % 360) + 360) % 360;
    s.from = a > 180 ? a - 360 : a;
    s.to = 0;
    s.angle = s.from;
    s.t0 = performance.now();
    s.easing = true;
    if (!s.raf) s.raf = requestAnimationFrame(loop);
  };

  return (
    <div className="brand-mark" aria-hidden onPointerEnter={start} onPointerLeave={stop}>
      <canvas ref={canvas} width={PX} height={PX} />
    </div>
  );
}
