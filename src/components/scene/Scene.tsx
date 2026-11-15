import { Canvas, useThree } from '@react-three/fiber';
import { animate, AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Handheld } from './Handheld';
import { Lens } from './Lens';
import { SceneLabels } from './SceneLabels';
import { OrbitView } from './OrbitView';
import { viewTransition } from './transition';
import { MoonPhaseLoader } from '../ui/MoonPhaseLoader';
import { DirectRender, QualityGovernor } from './QualityGovernor';
import { CaptureHook } from './capture';
import { useProfile } from '../../lib/perf/quality';
import { loadSiteTerrain } from '../../lib/terrain/sources';
import { customTerrain } from '../../hooks/data';
import { siteLatLon, useApp, type ViewMode } from '../../state/store';

const loadSurface = () => import('../surface/SurfaceView');
const SurfaceView = lazy(loadSurface);

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function prefetchSurface(): Promise<unknown> {
  const st = useApp.getState();
  const ref = st.scenarios[st.active].site;
  const [lat, lon] = siteLatLon(ref);
  const terrain = ref.kind === 'curated' ? loadSiteTerrain(ref.id) : customTerrain(lat, lon);
  return Promise.all([terrain, loadSurface()]).catch(() => undefined);
}

/** Canvas resolution: the device-pixel ratio that fits the tier's pixel budget on this screen. */
function useRenderDpr() {
  const p = useProfile();
  const [size, setSize] = useState(() => [window.innerWidth, window.innerHeight]);
  useEffect(() => {
    const on = () => setSize([window.innerWidth, window.innerHeight]);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const fit = Math.sqrt(p.pixels / Math.max(1, size[0] * size[1]));
  return Math.round(THREE.MathUtils.clamp(fit, 0.5, Math.min(window.devicePixelRatio || 1, p.maxDpr)) * 20) / 20;
}

/** Tone mapping lives in the lens pass; with the lens off, the renderer applies it instead. */
function ToneMapSwitch({ direct }: { direct: boolean }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.toneMapping = direct ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = direct ? 0.9 : 1;
    invalidate();
  }, [gl, direct, invalidate]);
  return null;
}

/** Renders on demand: any store change (time, site, criteria…) requests a frame. */
function Invalidator() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const unsub = useApp.subscribe(() => invalidate());
    // Async assets (texture LOD upgrades, Earth maps, models) land outside React: redraw when they do,
    // plus a slow heartbeat as a safety net for anything that slips through.
    THREE.DefaultLoadingManager.onLoad = () => invalidate();
    THREE.DefaultLoadingManager.onProgress = () => invalidate();
    const beat = window.setInterval(() => invalidate(), 1500);
    return () => {
      unsub();
      window.clearInterval(beat);
    };
  }, [invalidate]);
  return null;
}

/**
 * One WebGL canvas hosts both views. Switching views is a single continuous camera
 * move: the leaving view flies to a shared "gate" pose above the site, the views swap
 * under a brief dip, and the arriving view continues from the identical pose.
 */
export function Scene() {
  const target = useApp((s) => s.view);
  const [shown, setShown] = useState<ViewMode>(target);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const dpr = useRenderDpr();
  const post = useProfile().post;
  const veil = useRef<HTMLDivElement>(null);
  const pendingReady = useRef(false);
  const onViewReady = useCallback(() => {
    setReady(true);
    if (!pendingReady.current) return;
    pendingReady.current = false;
    // Two frames: the first compiles shaders and uploads geometry, the second is the real picture.
    requestAnimationFrame(() => requestAnimationFrame(() => setBusy(false)));
  }, []);
  const [gl2] = useState(webglAvailable);

  useEffect(() => {
    if (target === shown) return;
    let cancelled = false;
    const el = veil.current;
    const set = (v: number) => {
      if (el) el.style.background = `rgba(0,0,0,${v})`;
    };
    (async () => {
      const prefetch = target === 'surface' ? prefetchSurface() : Promise.resolve();
      let fetched = false;
      void prefetch.then(() => (fetched = true));
      await viewTransition.exit?.(target);
      if (cancelled) return;
      // Only if the terrain is still downloading once the camera has arrived, show the loader.
      if (!fetched) {
        setBusy(true);
        await prefetch;
      }
      if (cancelled) return;
      // A brief dip hides the frame where one scene is swapped for the other.
      await animate(0, 0.85, { duration: 0.12, ease: 'easeIn', onUpdate: set });
      if (cancelled) return;
      viewTransition.arrivedFrom = shown;
      // Building the surface (terrain mesh, shaders, lander, rocks) takes a moment after the
      // swap: keep the loader up until the new view reports it has rendered.
      // Either way, show the loader until the arriving view has drawn its first real frame.
      pendingReady.current = true;
      setBusy(true);
      setShown(target);
      window.setTimeout(() => void animate(0.85, 0, { duration: 0.5, ease: [0.16, 1, 0.3, 1], onUpdate: set }), 90);
    })();
    return () => {
      cancelled = true;
      if (!pendingReady.current) setBusy(false);
      set(0);
    };
  }, [target, shown]);

  if (!gl2) {
    return (
      <div className="loading">
        <div className="loading-inner" style={{ maxWidth: 360, textAlign: 'center' }}>
          WebGL 2 is unavailable in this browser, so the 3D views are off. Every calculation, the timeline and comparisons still work.
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      <Canvas
        frameloop="demand"
        dpr={dpr}
        gl={{ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 38, near: 0.001, far: 5000, position: [0, -1.2, 2.4] }}
        onCreated={({ gl, scene, camera, get }) => {
          // Exposed for automated browser tests and debugging.
          (window as unknown as { __eclipse: unknown }).__eclipse = { gl, scene, camera, get };
          gl.toneMapping = THREE.NoToneMapping; // ACES is applied in the lens pass
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.setClearColor('#000000');
        }}
        shadows={shown === 'surface'}
      >
        <QualityGovernor />
        <CaptureHook />
        <ToneMapSwitch direct={post === 'off'} />
        <Invalidator />
        {shown === 'orbit' ? (
          <OrbitView onReady={onViewReady} />
        ) : (
          <Suspense fallback={null}>
            <SurfaceView onReady={onViewReady} />
          </Suspense>
        )}
        <Handheld />
        {post === 'off' ? <DirectRender /> : <Lens />}
      </Canvas>
      <SceneLabels view={shown} />
      <div ref={veil} className="veil" />
      <AnimatePresence initial={false}>
        {(!ready || busy) && (
          <motion.div className={`loading ${ready ? 'is-overlay' : ''}`} key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
            <MoonPhaseLoader />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
