import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ephemerisNow, useSiteModel } from '../../hooks/data';
import { instantAt, type SiteModel } from '../../lib/science/analysis';
import { bestStation, stationViews } from '../../lib/science/comms';
import { say, useVoice, type LineId } from '../../lib/voice';
import { playheadTime, useApp } from '../../state/store';

/** Listens to mission time while it plays and calls out sunrise/sunset, AOS/LOS and station handovers. */
export function VoiceCallouts() {
  const site = useApp((s) => s.scenarios[s.active].site);
  const model = useSiteModel(site).model;
  const ref = useRef<SiteModel>(model);
  ref.current = model;
  useEffect(() => {
    let prev: { sun: boolean; earth: boolean; station: string | null; key: string } | null = null;
    return useApp.subscribe((st) => {
      if (!useVoice.getState().on) return void (prev = null);
      const eph = ephemerisNow();
      if (!eph) return;
      const m = ref.current;
      const t = playheadTime(st.scenarios[st.active], st.elapsed);
      const x = instantAt(eph, m, t, st.criteria);
      const best = x.earth.visible ? bestStation(stationViews(eph, m.frame, t))?.station.id ?? null : null;
      const now = { sun: x.sun.visible, earth: x.earth.visible, station: best, key: m.key };
      if (prev && prev.key === now.key && st.playing) {
        let line: LineId | null = null;
        if (now.earth !== prev.earth) line = now.earth ? 'earthrise' : 'earthset';
        else if (now.sun !== prev.sun) line = now.sun ? 'sunrise' : 'sunset';
        else if (now.station && prev.station && now.station !== prev.station) line = `handover-${now.station}` as LineId;
        if (line) void say(line);
      }
      prev = now;
    });
  }, []);
  return null;
}

export function VoiceToggle() {
  const on = useVoice((s) => s.on);
  return (
    <button type="button" className={`icon-btn flat ${on ? 'voice-on' : ''}`} onClick={() => useVoice.getState().toggle()} aria-pressed={on} title={on ? 'Mission-control callouts on' : 'Mission-control callouts (sunrise, AOS/LOS, handovers)'}>
      {on ? <Volume2 size={15} /> : <VolumeX size={15} />}
      <span className="voice-label">Callouts</span>
    </button>
  );
}
