import { motion } from 'motion/react';

const spring = { type: 'spring', stiffness: 420, damping: 28 } as const;

/** Eye whose upper lid closes down onto the lower one (and the pupil shrinks away) when off. */
export function EyeIcon({ open, size = 14 }: { open: boolean; size?: number }) {
  const upperOpen = 'M2 12 C 5.5 5.5, 18.5 5.5, 22 12';
  const upperShut = 'M2 12 C 5.5 15.2, 18.5 15.2, 22 12';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="toggle-icon">
      <path d="M2 12 C 5.5 18.5, 18.5 18.5, 22 12" />
      <motion.path initial={false} animate={{ d: open ? upperOpen : upperShut }} transition={spring} />
      <motion.circle cx="12" cy="12" r="3" initial={false} animate={{ scale: open ? 1 : 0, opacity: open ? 1 : 0 }} transition={spring} style={{ transformOrigin: '12px 12px' }} />
      {/* lashes appear on the closed lid */}
      {[6.5, 12, 17.5].map((x, i) => (
        <motion.line key={x} x1={x} x2={x + (i - 1) * 0.9} y1={14.6 + (i === 1 ? 0.6 : 0)} y2={17 + (i === 1 ? 0.8 : 0)} initial={false} animate={{ opacity: open ? 0 : 1, pathLength: open ? 0 : 1 }} transition={{ ...spring, delay: open ? 0 : 0.08 }} />
      ))}
    </svg>
  );
}

/** Flashlight whose beam fans out when on. */
export function LampIcon({ on, size = 14 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="toggle-icon">
      <path d="M3 15.5 L7.5 20 L11 16.5 L7 12.5 Z" />
      <path d="M7 12.5 L10 9.5 L14.5 14 L11 16.5" />
      {[
        'M13 8 L16 5',
        'M15.5 11 L20 9.5',
        'M11 5.5 L12.5 1.5',
      ].map((d, i) => (
        <motion.path key={d} d={d} initial={false} animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }} transition={{ ...spring, delay: on ? i * 0.05 : 0 }} />
      ))}
    </svg>
  );
}
