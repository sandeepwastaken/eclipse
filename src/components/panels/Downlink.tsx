import { CloudRain, RadioTower, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { captureFrame } from '../scene/capture';
import { currentTime } from '../scene/sim';
import { ephemerisNow, getEphemeris, useSiteModel } from '../../hooks/data';
import { instantAt, type SiteModel } from '../../lib/science/analysis';
import { bestStation, BANDS, fmtRate, lightTimeS, linkBudget, loadStationWeather, stationViews, stationWeatherNow, type Band } from '../../lib/science/comms';
import { useApp } from '../../state/store';
import { create } from 'zustand';
import { say } from '../../lib/voice';

type Weather = 'clear' | 'wet' | 'storm';

export const useDownlink = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

interface Run {
  img: HTMLCanvasElement;
  bits: number;
  sentBits: number;
  started: number;
  /** Real time the first bit reaches the station. */
  arrive: number;
  lines: number;
  drawn: number;
  state: 'flight' | 'receiving' | 'lost' | 'done' | 'blocked';
  why: string;
}

/**
 * "Send a photo home": the current view is transmitted from the lander. It reaches the station
 * after the real one-way light time, then arrives line by line at the rate the link budget allows
 * in the chosen band and weather. If Earth sinks behind terrain or the Moon sets at every station
 * mid-transfer, the signal is lost and picks up again when a station has it back. Only the payload
 * is invented: the geometry, light time and link budget are the app's real calculations.
 */
export function Downlink() {
  const open = useDownlink((s) => s.open);
  const band = useApp((s) => s.band);
  const setBand = useApp((s) => s.setBand);
  const [weather, setWeather] = useState<Weather>('clear');
  const siteRef = useApp((s) => s.scenarios[s.active].site);
  const siteModel = useSiteModel(siteRef).model;
  const modelRef = useRef<SiteModel>(siteModel);
  modelRef.current = siteModel;
  const view = useRef<HTMLCanvasElement>(null);
  const run = useRef<Run | null>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState({ station: '—', el: NaN, margin: NaN, rate: 0, lt: NaN, rain: 0, state: 'idle' as Run['state'] | 'idle', why: '' });
  useEffect(() => {
    void loadStationWeather();
  }, []);

  const linkNow = () => {
    const eph = ephemerisNow();
    const model = modelRef.current;
    if (!eph) return null;
    const t = currentTime();
    const inst = instantAt(eph, model, t, useApp.getState().criteria);
    const best = bestStation(stationViews(eph, model.frame, t));
    const month = new Date(t).getUTCMonth();
    const wx = best ? stationWeatherNow()?.stations[best.station.id]?.months[month] : null;
    const rain = weather === 'clear' || !wx ? 0 : weather === 'wet' ? Math.max(wx.r1, 1) : Math.max(wx.r01, 6);
    const L = best ? linkBudget(useApp.getState().band, best, rain) : null;
    return { inst, best, L, rain };
  };

  const send = async () => {
    await getEphemeris();
    const img = await captureFrame(480);
    const c = view.current;
    if (!c) return;
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    const now = performance.now();
    const k = linkNow();
    const lt = k?.best ? lightTimeS(k.best.rangeKm) : 1.28;
    // Payload: the full-resolution frame as raw 12-bit RGB, the way a science camera would send it.
    const glc = document.querySelector<HTMLCanvasElement>('.stage canvas');
    const bits = (glc ? glc.width * glc.height : 1e6) * 36;
    run.current = { img, bits, sentBits: 0, started: now, arrive: now + lt * 1000, lines: img.height, drawn: 0, state: 'flight', why: '' };
    setTick((x) => x + 1);
  };

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let last = performance.now();
    let shown = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const k = linkNow();
      const r = run.current;
      const earthUp = !!k?.inst.earth.visible;
      const rate = k?.L?.rate ?? 0;
      let why = '';
      if (!earthUp) why = 'Earth is behind terrain or below the horizon';
      else if (!k?.best) why = 'No station has the Moon above 10°';
      else if (!rate) why = `${band}-band link fails: ${k.L!.rainDb.toFixed(1)} dB of rain fade`;
      if (r && r.state !== 'done') {
        if (r.state === 'flight' && now >= r.arrive) r.state = 'receiving';
        if (r.state === 'receiving' || r.state === 'lost') {
          if (why) {
            if (r.state !== 'lost') void say('downlink-lost');
            r.state = 'lost';
            r.why = why;
          } else {
            r.state = 'receiving';
            r.sentBits = Math.min(r.bits, r.sentBits + rate * dt);
            const target = Math.floor((r.sentBits / r.bits) * r.lines);
            const c = view.current?.getContext('2d');
            if (c) {
              // Margin under ~1 dB: some lines arrive corrupted.
              const margin = k!.L!.marginDb;
              for (let y = r.drawn; y < target; y++) {
                if (margin < 3.6 && Math.random() < 0.18) {
                  c.fillStyle = `rgba(${150 + Math.random() * 100},${150 + Math.random() * 100},${150 + Math.random() * 100},0.8)`;
                  c.fillRect(0, y, r.img.width, 1);
                } else c.drawImage(r.img, 0, y, r.img.width, 1, 0, y, r.img.width, 1);
              }
              r.drawn = target;
            }
            if (r.sentBits >= r.bits) {
              r.state = 'done';
              void say('downlink-received');
            }
          }
        }
      }
      if (now - shown < 90 && r?.state !== 'done') {
        raf = requestAnimationFrame(loop);
        return;
      }
      shown = now;
      setStatus({
        station: k?.best ? `${k.best.station.name} · ${k.best.station.dish}` : '—',
        el: k?.best?.el ?? NaN,
        margin: k?.L && k.L.rate ? k.L.marginDb : NaN,
        rate: earthUp ? rate : 0,
        lt: k?.best ? lightTimeS(k.best.rangeKm) : NaN,
        rain: k?.L?.rainDb ?? 0,
        state: r ? r.state : 'idle',
        why: r?.state === 'lost' ? r.why : why,
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, weather, band]);

  const r = run.current;
  const pct = r ? Math.min(1, r.sentBits / r.bits) : 0;
  const stateText = !r ? (status.why ? `Can't send now: ${status.why}` : 'Ready: sends the current view') : r.state === 'flight' ? `In flight · ${Math.max(0, (r.arrive - performance.now()) / 1000).toFixed(2)} s light time` : r.state === 'receiving' ? 'Receiving' : r.state === 'lost' ? `Signal lost · ${r.why}` : 'Received';
  return (
    <AnimatePresence>
      {open && (
        <motion.section className="downlink glass" initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 14, filter: 'blur(6px)' }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} aria-label="Send a photo home">
          <div className="row">
            <span className="eyebrow">Send a photo home</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="dl-tx" onClick={() => void send()} disabled={r?.state === 'flight' || r?.state === 'receiving'}>
                <RadioTower size={13} /> Transmit
              </button>
              <button type="button" className="icon-btn flat" onClick={() => useDownlink.getState().setOpen(false)} aria-label="Close"><X size={14} /></button>
            </div>
          </div>
          <div className="dl-controls">
            <div className="segmented small" role="group" aria-label="Band">
              {(['S', 'X', 'Ka'] as Band[]).map((b) => (
                <button key={b} type="button" className="seg-btn" aria-pressed={band === b} onClick={() => setBand(b)}>
                  {band === b && <motion.span layoutId="dl-band" className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}{b}
                </button>
              ))}
            </div>
            <div className="segmented small" role="group" aria-label="Weather at the station">
              {(['clear', 'wet', 'storm'] as Weather[]).map((w) => (
                <button key={w} type="button" className="seg-btn" aria-pressed={weather === w} onClick={() => setWeather(w)} title={w === 'clear' ? 'Dry sky' : w === 'wet' ? 'Rain rate exceeded 1% of hours this month (ERA5)' : 'Rain rate exceeded 0.1% of hours this month (ERA5)'}>
                  {weather === w && <motion.span layoutId="dl-wx" className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}{w === 'clear' ? 'Clear' : w === 'wet' ? <><CloudRain size={12} /> 1%</> : <><CloudRain size={12} /> 0.1%</>}
                </button>
              ))}
            </div>
          </div>
          <div className={`dl-screen ${r ? '' : 'empty'}`}>
            <canvas ref={view} width={480} height={270} />
            {r && r.state !== 'done' && <div className="dl-scan" style={{ top: `${pct * 100}%` }} />}
            {!r && <span className="dl-empty">Press transmit: the view you see now is sent to whichever station has the Moon.</span>}
          </div>
          <div className={`dl-state ${status.state}`}>{stateText}</div>
          <div className="dl-figs tnum">
            <div className="span2"><span className="k">Station</span><span className="v">{status.station}</span></div>
            <div><span className="k">Moon there</span><span className="v">{Number.isFinite(status.el) ? `${status.el.toFixed(1)}°` : '—'}</span></div>
            <div><span className="k">Light time</span><span className="v">{Number.isFinite(status.lt) ? `${status.lt.toFixed(3)} s` : '—'}</span></div>
            <div><span className="k">{band} rate</span><span className="v">{fmtRate(status.rate)}</span></div>
            <div><span className="k">Margin</span><span className="v">{Number.isFinite(status.margin) ? `${status.margin.toFixed(1)} dB` : '—'}</span></div>
            <div><span className="k">Rain fade</span><span className="v">{status.rain.toFixed(1)} dB</span></div>
            <div className="wide"><span className="k">Received</span><span className="v">{r ? `${(r.sentBits / 8e6).toFixed(1)} / ${(r.bits / 8e6).toFixed(1)} MB` : '—'}</span><i style={{ width: `${pct * 100}%` }} /></div>
          </div>
          <p className="note">Payload: this frame as raw 12-bit RGB. Lander radio: {BANDS[band].txW} W into a {BANDS[band].txAntenna} (assumed CLPS-class). Rain levels are this station's ERA5 climatology for the month.</p>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
