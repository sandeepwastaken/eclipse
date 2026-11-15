import { Columns2, EyeOff, Info, Keyboard, Link2, Orbit, Mountain } from 'lucide-react';
import { QualityMenu } from './QualityMenu';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Segmented } from '../ui/primitives';
import { BrandMark } from '../ui/BrandMark';
import { useApp } from '../../state/store';
import { shareUrl } from '../../lib/url';

export function TopBar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const compare = useApp((s) => s.compare);
  const setCompare = useApp((s) => s.setCompare);
  const setSheet = useApp((s) => s.setSheet);
  const [toast, setToast] = useState<string | null>(null);
  const copy = async () => {
    const url = shareUrl(useApp.getState());
    try {
      await navigator.clipboard.writeText(url);
      setToast('Link copied');
    } catch {
      window.history.replaceState(null, '', url);
      setToast('Link is in the address bar');
    }
    window.setTimeout(() => setToast(null), 1800);
  };
  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <div>
          <div className="brand-name">ECLIPSE</div>
        </div>
      </div>
      <Segmented
        label="View"
        value={view}
        onChange={setView}
        options={[
          { value: 'orbit', label: <><Orbit size={15} strokeWidth={2} /> Orbit</> },
          { value: 'surface', label: <><Mountain size={15} strokeWidth={2} /> Surface</> },
        ]}
      />
      <div className="top-actions">
        <button type="button" className={`icon-btn ${compare ? 'is-on' : ''}`} onClick={() => setCompare(!compare)} aria-pressed={compare}>
          <Columns2 size={16} /> <span className="label">Compare</span>
        </button>
        <QualityMenu />
        <button type="button" className="icon-btn hide-sm" onClick={() => useApp.getState().setUiHidden(true)} aria-label="Hide interface" title="Hide interface (H)">
          <EyeOff size={16} />
        </button>
        <button type="button" className="icon-btn hide-sm" onClick={() => setSheet('keys')} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Keyboard size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={copy} aria-label="Copy share link">
          <Link2 size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => setSheet('methodology')} aria-label="Methodology and sources">
          <Info size={16} />
        </button>
      </div>
      <AnimatePresence>
        {toast && (
          <motion.div className="toast glass" initial={{ opacity: 0, y: -6, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -6, filter: 'blur(3px)' }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
