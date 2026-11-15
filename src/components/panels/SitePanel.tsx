import { CalendarSearch, MapPin, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GlassPanel, Morph, Segmented } from '../ui/primitives';
import { GROUP_LABELS, SITES, type SiteGroup } from '../../data/sites';
import { fmtLat, fmtLon, fromInputUtc, toInputUtc } from '../../lib/format';
import { DAY_MS } from '../../lib/science/constants';
import { DURATIONS, siteKey, siteLatLon, useApp, type ScenarioId } from '../../state/store';

function CoordinateFields({ id }: { id: ScenarioId }) {
  const site = useApp((s) => s.scenarios[id].site);
  const setSite = useApp((s) => s.setSite);
  const [lat0, lon0] = siteLatLon(site);
  const [lat, setLat] = useState(lat0.toFixed(4));
  const [lon, setLon] = useState(lon0.toFixed(4));
  useEffect(() => {
    setLat(lat0.toFixed(4));
    setLon(lon0.toFixed(4));
  }, [lat0, lon0]);
  const latN = Number(lat), lonN = Number(lon);
  const latOk = lat.trim() !== '' && Number.isFinite(latN) && latN >= -90 && latN <= 90;
  const lonOk = lon.trim() !== '' && Number.isFinite(lonN) && lonN >= -180 && lonN <= 360;
  const dirty = latN !== Number(lat0.toFixed(4)) || lonN !== Number(lon0.toFixed(4));
  const apply = () => latOk && lonOk && dirty && setSite(id, { kind: 'custom', lat: latN, lon: lonN });
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="row">
        <label htmlFor={`lat-${id}`}>Latitude, longitude (°E)</label>
      </div>
      <div className="grid-2">
        <input id={`lat-${id}`} className="input" inputMode="decimal" value={lat} aria-invalid={!latOk} aria-label="Latitude in degrees, −90 to 90" onChange={(e) => setLat(e.target.value)} onBlur={apply} />
        <input id={`lon-${id}`} className="input" inputMode="decimal" value={lon} aria-invalid={!lonOk} aria-label="Longitude in degrees east, −180 to 180" onChange={(e) => setLon(e.target.value)} onBlur={apply} />
      </div>
      <div className="row note">
        <span>{latOk ? fmtLat(latN, 2) : 'Latitude −90…90'} · {lonOk ? fmtLon(((lonN + 540) % 360) - 180, 2) : 'Longitude −180…180'}</span>
        <button type="submit" className="chip" disabled={!dirty || !latOk || !lonOk}>Analyze</button>
      </div>
    </form>
  );
}

function ScheduleFields({ id }: { id: ScenarioId }) {
  const sc = useApp((s) => s.scenarios[id]);
  const setLanding = useApp((s) => s.setLanding);
  const setDuration = useApp((s) => s.setDuration);
  const setSheet = useApp((s) => s.setSheet);
  const [text, setText] = useState(toInputUtc(sc.landing));
  useEffect(() => setText(toInputUtc(sc.landing)), [sc.landing]);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="field">
        <label htmlFor={`landing-${id}`}>Landing · UTC</label>
        <input
          id={`landing-${id}`}
          type="datetime-local"
          className="input"
          min="2026-01-01T00:00"
          max="2028-12-31T00:00"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const t = fromInputUtc(e.target.value);
            if (Number.isFinite(t)) setLanding(id, t);
          }}
        />
        <div className="chip-row" role="group" aria-label="Shift landing date">
          {[-7, -1, 1, 7].map((d) => (
            <button key={d} type="button" className="chip tnum" onClick={() => setLanding(id, sc.landing + d * DAY_MS)}>
              {d > 0 ? `+${d}d` : `−${-d}d`}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Mission duration</label>
        <Segmented
          small
          label="Mission duration"
          value={sc.durationDays}
          onChange={(v) => setDuration(id, v)}
          options={DURATIONS.filter((d) => d !== 180).map((d) => ({ value: d, label: d === 365 ? '1y' : `${d}d` }))}
        />
      </div>
      <button type="button" className="icon-btn flat" style={{ justifySelf: 'start' }} onClick={() => setSheet('dates')}>
        <CalendarSearch size={14} /> Best landing dates
      </button>
    </div>
  );
}

export function SitePanel() {
  const compare = useApp((s) => s.compare);
  const active = useApp((s) => s.active);
  const setActive = useApp((s) => s.setActive);
  const scenarios = useApp((s) => s.scenarios);
  const setSite = useApp((s) => s.setSite);
  const [q, setQ] = useState('');
  const current = siteKey(scenarios[active].site);
  const other = compare ? siteKey(scenarios[active === 'A' ? 'B' : 'A'].site) : null;
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map<SiteGroup, typeof SITES>();
    for (const s of SITES) {
      if (needle && !`${s.name} ${s.code} ${s.blurb}`.toLowerCase().includes(needle)) continue;
      m.set(s.group, [...(m.get(s.group) ?? []), s]);
    }
    return [...m.entries()];
  }, [q]);

  return (
    <GlassPanel className="panel panel-left" from="left" delay={0.05}>
      <div className="panel-head" style={{ display: 'grid', gap: 12 }}>
        {compare && (
          <Segmented
            small
            label="Edit scenario"
            value={active}
            onChange={setActive}
            options={[
              { value: 'A', label: 'Scenario A' },
              { value: 'B', label: 'Scenario B' },
            ]}
          />
        )}
        <div className="search">
          <Search size={15} className="faint" />
          <input placeholder="Search landing sites" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search landing sites" />
        </div>
      </div>
      <div className="panel-scroll">
        <Morph k={`${active}`}>
          <div className="section" style={{ paddingTop: 4 }}>
            <ScheduleFields id={active} />
          </div>
          {groups.map(([g, list]) => (
            <div className="site-group" key={g}>
              <h3>{GROUP_LABELS[g]}</h3>
              {list.map((s) => (
                <button key={s.id} type="button" className={`site-item ${current === s.id ? 'is-active' : ''}`} onClick={() => setSite(active, { kind: 'curated', id: s.id })}>
                  <span className="site-name">
                    {current === s.id && <span className="site-tag">{active}</span>}
                    {other === s.id && <span className="site-tag b">{active === 'A' ? 'B' : 'A'}</span>}
                    {s.name}
                  </span>
                  <span className="site-code">{s.code}</span>
                  <span className="site-meta tnum">{fmtLat(s.lat, 2)} · {fmtLon(s.lon, 2)}</span>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <div className="section note">
              <MapPin size={14} /> No match. Use custom coordinates below, or click the Moon.
            </div>
          )}
          <details className="section disclosure">
            <summary>Custom coordinates</summary>
            <div style={{ marginTop: 12 }}>
              <CoordinateFields id={active} />
            </div>
          </details>
          <div style={{ height: 8 }} />
        </Morph>
      </div>
    </GlassPanel>
  );
}
