import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { useApp } from '../../state/store';

/**
 * Apple-style "blur roll" text: every character occupies its own slot; only the
 * slots whose character changed animate. The outgoing glyph slides away with a
 * vertical motion blur while the incoming glyph slides in from the opposite side
 * and sharpens. Direction follows the numeric change (up for increases).
 */
export function BlurText({ text, direction = 1, className }: { text: string; direction?: number; className?: string }) {
  const reduce = useReducedMotion();
  const playing = useApp((s) => s.playing);
  // While time runs (or the value changes faster than the roll can finish), the roll would
  // only blur into noise and cost a spring animation per glyph per update: show plain text.
  const last = useRef({ text, at: 0, fast: false });
  if (last.current.text !== text) {
    const now = performance.now();
    last.current.fast = now - last.current.at < 260;
    last.current.at = now;
    last.current.text = text;
  }
  if (reduce || playing || last.current.fast) return <span className={`blur-text ${className ?? ''}`}>{text}</span>;
  // Key every character by (token from the right, position within token from the right):
  // units like "d" and "h" keep their identity when a number gains or loses a digit,
  // so only digits that actually changed flip, and nothing slides sideways.
  const tokens = text.match(/\d+|\D/g) ?? [];
  const keyed: { ch: string; key: string }[] = [];
  tokens.forEach((tok, ti) => {
    const tr = tokens.length - 1 - ti;
    Array.from(tok).forEach((ch, ci) => keyed.push({ ch, key: `${tr}.${tok.length - 1 - ci}` }));
  });
  const dir = direction >= 0 ? 1 : -1;
  return (
    <span className={`blur-text ${className ?? ''}`} aria-label={text} role="text">
      {keyed.map(({ ch, key }) => (
        <span key={key} className="bt-slot" aria-hidden>
          <AnimatePresence initial={false} mode="popLayout" custom={dir}>
            <motion.span
              key={ch}
              className="bt-char"
              custom={dir}
              variants={{
                enter: (d: number) => ({ y: `${38 * d}%`, opacity: 0, filter: 'blur(2px)', scaleY: 1.05 }),
                center: { y: '0%', opacity: 1, filter: 'blur(0px)', scaleY: 1 },
                exit: (d: number) => ({ y: `${-38 * d}%`, opacity: 0, filter: 'blur(2px)', scaleY: 1.05 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
            >
              {ch === ' ' ? '\u00a0' : ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

export function BlurNumber({ value, format, className }: { value: number | null | undefined; format: (v: number) => string; className?: string }) {
  const prev = useRef<number | null>(null);
  const v = value ?? null;
  const dir = v !== null && prev.current !== null && v < prev.current ? -1 : 1;
  prev.current = v;
  return <BlurText text={v === null || !Number.isFinite(v) ? '—' : format(v)} direction={dir} className={className} />;
}
