import { AnimatePresence, motion } from 'motion/react';
import { useId, type ReactNode } from 'react';

export function Segmented<T extends string | number>({ value, options, onChange, small, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; small?: boolean; label: string }) {
  const id = useId();
  return (
    <div className={`segmented ${small ? 'small' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="seg-btn" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={`thumb-${id}`} className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Panel content that morphs (opacity + blur + slight lift) whenever `k` changes. */
export function Morph({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={k}
        className={className}
        initial={{ opacity: 0, filter: 'blur(4px)', y: 6, scale: 0.99 }}
        animate={{ opacity: 1, filter: 'blur(0px)', y: 0, scale: 1 }}
        exit={{ opacity: 0, filter: 'blur(4px)', y: -4, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Glass surface that emerges with coordinated opacity, scale and blur. */
export function GlassPanel({ className, children, delay = 0, from = 'none' }: { className?: string; children: ReactNode; delay?: number; from?: 'left' | 'right' | 'bottom' | 'none' }) {
  const offset = from === 'left' ? { x: -16 } : from === 'right' ? { x: 16 } : from === 'bottom' ? { y: 16 } : {};
  return (
    <motion.section
      className={`glass ${className ?? ''}`}
      initial={{ opacity: 0, filter: 'blur(6px)', scale: 0.985, ...offset }}
      animate={{ opacity: 1, filter: 'blur(0px)', scale: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, filter: 'blur(6px)', scale: 0.985, ...offset }}
      transition={{ type: 'spring', stiffness: 260, damping: 32, delay }}
    >
      {children}
    </motion.section>
  );
}

export const SunGlyph = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="glyph">
    <circle cx="8" cy="8" r="3.2" fill="currentColor" />
    {Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return <line key={i} x1={8 + Math.cos(a) * 5.3} y1={8 + Math.sin(a) * 5.3} x2={8 + Math.cos(a) * 7} y2={8 + Math.sin(a) * 7} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />;
    })}
  </svg>
);

export const EarthGlyph = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="glyph">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2.5 8h11M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" fill="none" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

export const BothGlyph = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="glyph">
    <circle cx="6" cy="8" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="10" cy="8" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
