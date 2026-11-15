import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { DAY_MS, HOUR_MS } from '../../lib/science/constants';
import { useApp } from '../../state/store';

const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

/** Keyboard control everywhere, not only when the timeline has focus. */
export function GlobalKeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useApp.getState();
      const k = e.key;
      const onTimeline = !!(e.target as HTMLElement | null)?.closest?.('.tl-tracks');
      if (k === ' ' && !onTimeline && !(e.target as HTMLElement | null)?.closest?.('button')) {
        e.preventDefault();
        const max = Math.max(st.scenarios.A.durationDays, st.compare ? st.scenarios.B.durationDays : 0) * DAY_MS;
        if (!st.playing && st.elapsed >= max - 1000) st.setElapsed(0);
        st.setPlaying(!st.playing);
      } else if ((k === 'ArrowRight' || k === 'ArrowLeft') && !onTimeline) {
        e.preventDefault();
        st.setPlaying(false);
        st.setElapsed(st.elapsed + (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? DAY_MS : HOUR_MS));
      } else if (k === 'h' || k === 'H') st.setUiHidden(!st.uiHidden);
      else if (k === 'Escape' && st.uiHidden) st.setUiHidden(false);
      else if (k === 'v' || k === 'V') st.setView(st.view === 'orbit' ? 'surface' : 'orbit');
      else if (k === 'c' || k === 'C') st.setCompare(!st.compare);
      else if (k === 'g' || k === 'G') st.setOverlays(!st.overlays);
      else if (k === 'l' || k === 'L') st.setLamp(!st.lamp);
      else if (k === '?') st.setSheet(st.sheet === 'keys' ? null : 'keys');
      else if (k === 'b' || k === 'B') st.setBand(st.band === 'S' ? 'X' : st.band === 'X' ? 'Ka' : 'S');
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
  return null;
}

const KEYS: [string, string][] = [
  ['Space', 'Play / pause mission time'],
  ['← →', 'Step one hour (Shift: one day)'],
  ['V', 'Switch Orbit ⇄ Surface'],
  ['C', 'Compare two scenarios'],
  ['B', 'Cycle radio band S → X → Ka'],
  ['H', 'Hide the interface (Esc brings it back)'],
  ['W A S D', 'Walk on the surface (Shift: run)'],
  ['Double-click', 'Lock onto the Sun or Earth · pick up the lander'],
  ['G / L', 'Sky guides / headlamp (surface)'],
  ['?', 'This list'],
];

export function ShortcutsSheet() {
  return (
    <Sheet title="Keyboard shortcuts" eyebrow="Every view" width={520}>
      <div className="sheet-body">
        <dl className="keys">
          {KEYS.map(([k, d]) => (
            <div key={k} className="key-row">
              <dt>{k.split(' ').map((p, i) => <kbd key={i}>{p}</kbd>)}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Sheet>
  );
}

/** While the interface is hidden: a quiet pill that says how to get it back, then fades away. */
export function UiHiddenHint() {
  const hidden = useApp((s) => s.uiHidden);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!hidden) return setShow(false);
    let timer = 0;
    const poke = () => {
      setShow(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShow(false), 2200);
    };
    poke();
    window.addEventListener('pointermove', poke);
    return () => {
      window.removeEventListener('pointermove', poke);
      window.clearTimeout(timer);
    };
  }, [hidden]);
  return (
    <AnimatePresence>
      {hidden && show && (
        <motion.button type="button" className="ui-return" onClick={() => useApp.getState().setUiHidden(false)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.25 }}>
          Show interface <kbd>H</kbd>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
