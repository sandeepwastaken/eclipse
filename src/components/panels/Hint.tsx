import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';

const COPY = {
  orbit: 'Pick a site, or click anywhere on the Moon',
  surface: 'WASD to walk · drag to look · double-click the lander to move it',
} as const;

function seen(key: string) {
  try {
    return window.localStorage.getItem(`hint:${key}`) === '1';
  } catch {
    return false;
  }
}
function markSeen(key: string) {
  try {
    window.localStorage.setItem(`hint:${key}`, '1');
  } catch {
    /* private mode: the hint simply shows again next time */
  }
}

/** One-line coach mark per view; disappears after the first interaction or a few seconds. */
export function Hint() {
  const view = useApp((s) => s.view);
  const [show, setShow] = useState<null | keyof typeof COPY>(null);
  useEffect(() => {
    if (seen(view)) return;
    const start = window.setTimeout(() => setShow(view), view === 'surface' ? 7500 : 1500);
    const stop = window.setTimeout(() => {
      setShow(null);
      markSeen(view);
    }, view === 'surface' ? 15000 : 9000);
    let unsub = () => {};
    const dismiss = () => {
      setShow(null);
      markSeen(view);
      unsub();
    };
    unsub = useApp.subscribe((st, prev) => {
      if (st.scenarios !== prev.scenarios || st.elapsed !== prev.elapsed) dismiss();
    });
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
      unsub();
      setShow(null);
    };
  }, [view]);
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="hint" key={show} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.35 }}>
          {COPY[show]}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
