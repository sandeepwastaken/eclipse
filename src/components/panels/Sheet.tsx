import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { useApp } from '../../state/store';

export function Sheet({ title, eyebrow, children, width }: { title: string; eyebrow?: string; children: ReactNode; width?: number }) {
  const close = () => useApp.getState().setSheet(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet glass"
        style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
        initial={{ opacity: 0, scale: 0.96, filter: 'blur(16px)', x: '-50%', y: '-46%' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', x: '-50%', y: '-50%' }}
        exit={{ opacity: 0, scale: 0.97, filter: 'blur(16px)', x: '-50%', y: '-47%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        <div className="sheet-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <div className="title">{title}</div>
          </div>
          <button type="button" className="icon-btn flat" onClick={close} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </motion.div>
    </>
  );
}
