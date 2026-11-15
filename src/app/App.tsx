import { AnimatePresence } from 'motion/react';
import { useEffect } from 'react';
import { Inspector } from '../components/panels/Inspector';
import { Methodology } from '../components/panels/Methodology';
import { LandingDates } from '../components/panels/LandingDates';
import { SitePanel } from '../components/panels/SitePanel';
import { PlaybackTicker, Timeline } from '../components/panels/Timeline';
import { TopBar } from '../components/panels/TopBar';
import { ViewTools } from '../components/panels/ViewTools';
import { Panorama } from '../components/panels/Panorama';
import { Hint } from '../components/panels/Hint';
import { Scene } from '../components/scene/Scene';
import { useEphemeris } from '../hooks/data';
import { parseUrl } from '../lib/url';
import { useApp } from '../state/store';
import { useWalkMode } from '../components/surface/viewState';
import { Downlink } from '../components/panels/Downlink';
import { VoiceCallouts } from '../components/panels/VoiceCallouts';
import { GlobalKeys, ShortcutsSheet, UiHiddenHint } from '../components/panels/Shortcuts';

export function App() {
  const { eph, error } = useEphemeris();
  const sheet = useApp((s) => s.sheet);
  const view = useApp((s) => s.view);
  const uiHidden = useApp((s) => s.uiHidden);
  // First-person walking clears the panorama so you can see your suit below you.
  const walking = useWalkMode((s) => s.fp);
  useEffect(() => {
    const parsed = parseUrl(window.location.search);
    if (parsed) useApp.getState().hydrate(parsed);
  }, []);
  return (
    <div className={`app view-${view} ${uiHidden ? 'ui-hidden' : ''}`}>
      <GlobalKeys />
      <Scene />
      <UiHiddenHint />
      <TopBar />
      <ViewTools />
      {eph && (
        <>
          <AnimatePresence>{view === 'orbit' && <SitePanel key="sites" />}</AnimatePresence>
          <Inspector />
          <Timeline />
          <PlaybackTicker />
          <Downlink />
          <VoiceCallouts />
          <Hint />
          <AnimatePresence>{view === 'surface' && !walking && <Panorama key="pano" />}</AnimatePresence>
        </>
      )}
      {error && (
        <div className="loading" style={{ zIndex: 40 }}>
          <div className="glass" style={{ padding: 24, maxWidth: 420 }}>
            <div className="title">Ephemeris unavailable</div>
            <p className="subtitle">{error} No results are shown rather than approximate ones.</p>
          </div>
        </div>
      )}
      <AnimatePresence>
        {sheet === 'methodology' && <Methodology key="m" />}
        {sheet === 'dates' && <LandingDates key="d" />}
        {sheet === 'keys' && <ShortcutsSheet key="k" />}
      </AnimatePresence>
    </div>
  );
}
