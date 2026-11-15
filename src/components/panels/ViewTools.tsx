import { Compass, Crosshair, Mountain, RadioTower, Rotate3d, Sun, Globe2 } from 'lucide-react';
import { useDownlink } from './Downlink';
import { EyeIcon, LampIcon } from '../ui/ToggleIcons';
import { AnimatePresence, motion } from 'motion/react';
import { useApp } from '../../state/store';
import { useLock } from '../surface/viewState';
import { LockIcon } from '../ui/LockIcon';

export function ViewTools() {
  const view = useApp((s) => s.view);
  const command = useApp((s) => s.command);
  const relief = useApp((s) => s.reliefExaggeration);
  const setRelief = useApp((s) => s.setRelief);
  const overlays = useApp((s) => s.overlays);
  const setOverlays = useApp((s) => s.setOverlays);
  const lamp = useApp((s) => s.lamp);
  const setLamp = useApp((s) => s.setLamp);
  const lock = useLock((s) => s.lock);
  const toggleLock = (b: 'sun' | 'earth') => useLock.getState().setLock(lock === b ? null : b);
  const dl = useDownlink((s) => s.open);
  const sendBtn = (
    <button type="button" className={`tool ${dl ? 'is-on' : ''}`} onClick={() => useDownlink.getState().setOpen(!dl)} aria-pressed={dl} title="Transmit the current view to a ground station">
      <RadioTower size={14} /> Send
    </button>
  );
  return (
    <div className="view-tools-top">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={view}
          className="tool-row"
          initial={{ opacity: 0, y: -6, filter: 'blur(3px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -6, filter: 'blur(3px)' }}
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        >
          {view === 'orbit' ? (
            <>
              <button type="button" className="tool" onClick={() => command('site')}><Crosshair size={14} /> Site</button>
              <button type="button" className="tool" onClick={() => command('pole')}><Compass size={14} /> Pole</button>
              <button type="button" className="tool" onClick={() => command('reset')}><Rotate3d size={14} /> Reset</button>
              <button type="button" className={`tool ${relief > 1 ? 'is-on' : ''}`} onClick={() => setRelief(relief > 1 ? 1 : 4)} title="Vertical exaggeration of LOLA relief (visual only)">
                <Mountain size={14} /> Relief ×4
              </button>
              {sendBtn}
            </>
          ) : (
            <>
              <button type="button" className="tool" onClick={() => command('lander')}><Crosshair size={14} /> Lander</button>
              <button type="button" className={`tool ${lock === 'sun' ? 'is-locked' : ''}`} onClick={() => command('sun')} onDoubleClick={() => toggleLock('sun')} aria-label="Face Sun" aria-pressed={lock === 'sun'} title="Click to face the Sun · double-click to lock on">
                <Sun size={14} /> Sun
                <AnimatePresence>{lock === 'sun' && <LockIcon key="l" />}</AnimatePresence>
              </button>
              <button type="button" className={`tool ${lock === 'earth' ? 'is-locked' : ''}`} onClick={() => command('earth')} onDoubleClick={() => toggleLock('earth')} aria-label="Face Earth" aria-pressed={lock === 'earth'} title="Click to face Earth · double-click to lock on">
                <Globe2 size={14} /> Earth
                <AnimatePresence>{lock === 'earth' && <LockIcon key="l" />}</AnimatePresence>
              </button>
              <button type="button" className="tool" onClick={() => command('reset')}><Rotate3d size={14} /> Overview</button>
              <button type="button" className={`tool ${overlays ? 'is-on' : ''}`} onClick={() => setOverlays(!overlays)} aria-pressed={overlays}>
                <EyeIcon open={overlays} /> Guides
              </button>
              <button type="button" className={`tool ${lamp ? 'is-on' : ''}`} onClick={() => setLamp(!lamp)} aria-pressed={lamp} title="Extra light: a lamp shining from the camera">
                <LampIcon on={lamp} /> Light
              </button>
              {sendBtn}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
