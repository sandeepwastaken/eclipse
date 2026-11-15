import { Gauge } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { TIER_NAMES, useQuality, type Tier } from '../../lib/perf/quality';

/** Quality control in the top bar: Auto (adaptive) or a fixed tier, plus the HUD toggle. */
export function QualityMenu() {
  const [open, setOpen] = useState(false);
  const mode = useQuality((s) => s.mode);
  const tier = useQuality((s) => s.tier);
  const { setMode } = useQuality.getState();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="qmenu" ref={box}>
      <button type="button" className={`icon-btn ${open ? 'is-on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Render quality" title="Render quality">
        <Gauge size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="qmenu-pop glass" role="menu" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
            <div className="eyebrow" style={{ padding: '2px 4px 8px' }}>Render quality</div>
            {(['auto', 3, 2, 1, 0] as const).map((m) => (
              <button key={String(m)} type="button" role="menuitemradio" aria-checked={mode === m} className={`qitem ${mode === m ? 'is-on' : ''}`} onClick={() => setMode(m as 'auto' | Tier)}>
                <span>{m === 'auto' ? 'Auto' : TIER_NAMES[m]}</span>
                <span className="faint">{m === 'auto' ? `holds 60 fps · now ${TIER_NAMES[tier]}` : m === 3 ? 'max resolution, 4K shadows' : m === 2 ? 'full lens, MSAA' : m === 1 ? 'light lens, FXAA' : 'fastest, any GPU'}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
