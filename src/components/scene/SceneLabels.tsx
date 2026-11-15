import { useMemo } from 'react';
import { registerLabel } from './labels';
import { LockBadge } from './LockBadge';
import { SITES } from '../../data/sites';
import { siteKey, useApp, type ScenarioId } from '../../state/store';

function OrbitMarkers() {
  const scenarios = useApp((s) => s.scenarios);
  const compare = useApp((s) => s.compare);
  const active = useApp((s) => s.active);
  const setSite = useApp((s) => s.setSite);
  const tagged = useMemo(() => {
    const map = new Map<string, ScenarioId[]>();
    (compare ? (['A', 'B'] as const) : (['A'] as const)).forEach((id) => {
      const k = siteKey(scenarios[id].site);
      map.set(k, [...(map.get(k) ?? []), id]);
    });
    return map;
  }, [scenarios, compare]);
  const customs = (compare ? (['A', 'B'] as const) : (['A'] as const)).filter((id) => scenarios[id].site.kind === 'custom');
  return (
    <>
      {SITES.map((s) => {
        const tags = tagged.get(s.id);
        const tag = tags?.includes(active) ? active : tags?.[0];
        return (
          <div key={s.id} ref={registerLabel(`site:${s.id}`)} className="anchor" style={{ opacity: 0 }}>
            <button type="button" className={`marker ${tags ? 'is-selected' : ''} ${tag ? `tag-${tag}` : ''}`} onClick={() => setSite(active, { kind: 'curated', id: s.id })} aria-label={`Select ${s.name}`}>
              <span className="marker-dot" />
              {tag && <span className="marker-tag">{tag}</span>}
              <span className="marker-label">{s.name}</span>
            </button>
          </div>
        );
      })}
      {customs.map((id) => (
        <div key={`c-${id}`} ref={registerLabel(`custom:${id}`)} className="anchor" style={{ opacity: 0 }}>
          <div className={`marker is-selected tag-${id}`}>
            <span className="marker-dot" />
            <span className="marker-tag">{id}</span>
            <span className="marker-label">Custom site</span>
          </div>
        </div>
      ))}
      <div ref={registerLabel('pick')} className="anchor" style={{ opacity: 0 }}>
        <div className="pick-tip">
          <span className="tnum" />
          <span className="pick-hint">Click to analyze</span>
        </div>
      </div>
    </>
  );
}

export const CARDINALS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]] as const;

function SurfaceLabels() {
  const overlays = useApp((s) => s.overlays);
  return (
    <div style={{ display: overlays ? 'contents' : 'none' }}>
      {CARDINALS.map(([l]) => (
        <div key={l} ref={registerLabel(`card:${l}`)} className="anchor" style={{ opacity: 0 }}>
          <div className={`cardinal ${l.length > 1 ? 'minor' : ''}`}>{l}</div>
        </div>
      ))}
      <div ref={registerLabel('sky:sun')} className="anchor" style={{ opacity: 0 }}>
        <div className="sky-label tnum" />
      </div>
      <div ref={registerLabel('sky:earth')} className="anchor" style={{ opacity: 0 }}>
        <div className="sky-label tnum" />
      </div>
    </div>
  );
}

/** DOM layer above the canvas holding every label anchored to a 3D point. */
export function SceneLabels({ view }: { view: 'orbit' | 'surface' }) {
  return <div className="label-layer">{view === 'orbit' ? <OrbitMarkers /> : <><SurfaceLabels /><LockBadge /></>}</div>;
}
