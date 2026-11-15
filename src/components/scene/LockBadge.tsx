import { AnimatePresence, motion } from 'motion/react';
import { registerLabel } from './labels';
import { useLock } from '../surface/viewState';

const spring = { type: 'spring', stiffness: 520, damping: 22, mass: 0.6 } as const;

/**
 * Lock marker drawn around a tracked body. The padlock drops in with its shackle open,
 * then the shackle snaps shut; the ring turns dotted while the body is behind terrain.
 */
export function LockBadge() {
  const lock = useLock((s) => s.lock);
  const occluded = useLock((s) => s.occluded);
  return (
    <div ref={registerLabel('lock')} className="anchor" style={{ opacity: 0 }}>
      <AnimatePresence>
        {lock && (
          <motion.div key={lock} className={`lock-badge ${lock}`} initial={{ opacity: 0, scale: 1.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.28, ease: [0.2, 0.9, 0.3, 1] }}>
            <svg width="64" height="64" viewBox="-32 -32 64 64" aria-hidden>
              {/* Ring hugs the body's true on-screen disk; radius is set per frame by the scene. */}
              <motion.circle
                data-ring
                r="22"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                initial={{ pathLength: 0, rotate: -90 }}
                animate={{ pathLength: 1, rotate: -90, opacity: occluded ? 0 : 1 }}
                transition={{ duration: 0.5, ease: [0.3, 0.8, 0.3, 1] }}
              />
              <circle data-ring r="22" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeDasharray="1.5 4.5" style={{ opacity: occluded ? 0.85 : 0, transition: 'opacity 0.3s' }} />
              <g data-glyph transform="translate(0,34)">
                <motion.path
                  d="M-3.6 0 V-3.2 A3.6 3.6 0 0 1 3.6 -3.2 V0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  initial={{ y: -3.2 }}
                  animate={{ y: 0 }}
                  transition={{ ...spring, delay: 0.22 }}
                />
                <motion.rect x={-5} y={-0.4} width={10} height={7.6} rx={1.8} fill="currentColor" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2 }} />
              </g>
            </svg>
            <span className="lock-label" data-label>{lock === 'sun' ? 'Sun' : 'Earth'} locked{occluded ? ' · behind terrain' : ''}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
