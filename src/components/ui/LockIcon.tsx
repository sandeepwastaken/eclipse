import { motion } from 'motion/react';

/** Padlock that drops in with its shackle open, then snaps shut. */
export function LockIcon({ size = 13 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="-8 -10 16 18"
      aria-hidden
      initial={{ opacity: 0, scale: 0.4, y: -3 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.4, y: -3 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      style={{ overflow: 'visible' }}
    >
      <motion.path
        d="M-3.6 0 V-3.2 A3.6 3.6 0 0 1 3.6 -3.2 V0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        initial={{ y: -3.4 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 700, damping: 18, delay: 0.18 }}
      />
      <rect x={-5.2} y={-0.6} width={10.4} height={8} rx={1.9} fill="currentColor" />
    </motion.svg>
  );
}
