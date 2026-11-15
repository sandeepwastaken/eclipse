import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { perfStats, useQuality, type Tier } from '../../lib/perf/quality';

/**
 * Holds the frame rate by moving between quality tiers (Auto mode only).
 *
 * The scene renders on demand, so idle gaps between frames say nothing about speed. Where the
 * browser exposes GPU timer queries (EXT_disjoint_timer_query_webgl2) the governor reads the true
 * GPU cost of every frame, which also reveals headroom while v-sync caps the frame rate. Elsewhere
 * it falls back to frame intervals, counted only while the scene is drawing continuously.
 */
export function QualityGovernor() {
  const gl = useThree((s) => s.gl);
  const t = useMemo(() => {
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const ext = ctx.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    return {
      ctx,
      ext,
      active: null as WebGLQuery | null,
      pending: [] as WebGLQuery[],
      gpu: [] as { at: number; ms: number }[],
      frames: [] as { at: number; ms: number }[],
      last: 0,
      changedAt: performance.now(),
      blocked: new Map<Tier, number>(),
      goodSince: 0,
    };
  }, [gl]);

  useEffect(() => {
    const dbg = t.ctx.getExtension('WEBGL_debug_renderer_info');
    const name = String(dbg ? t.ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : t.ctx.getParameter(t.ctx.RENDERER));
    perfStats.gpuName = name.replace(/^ANGLE \(|\)$/g, '').replace(/ Direct3D.*$/, '').replace(/\s+\(0x[0-9A-F]+\)/i, '');
    useQuality.getState().init(name);
    return useQuality.subscribe((s, p) => {
      if (s.tier !== p.tier) {
        t.changedAt = performance.now();
        t.gpu.length = 0;
        t.frames.length = 0;
        t.goodSince = 0;
      }
    });
  }, [t]);

  // First in the frame: open a GPU timer around everything rendered this frame.
  useFrame(() => {
    if (t.ext && !t.active && t.pending.length < 4) {
      t.active = t.ctx.createQuery();
      if (t.active) t.ctx.beginQuery(t.ext.TIME_ELAPSED_EXT, t.active);
    }
  }, -1000);

  // Last in the frame: close the timer, collect finished ones, decide.
  useFrame(() => {
    const now = performance.now();
    const { ctx, ext } = t;
    if (ext && t.active) {
      ctx.endQuery(ext.TIME_ELAPSED_EXT);
      t.pending.push(t.active);
      t.active = null;
    }
    if (ext) {
      const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT);
      while (t.pending.length && ctx.getQueryParameter(t.pending[0], ctx.QUERY_RESULT_AVAILABLE)) {
        const q = t.pending.shift()!;
        const ns = ctx.getQueryParameter(q, ctx.QUERY_RESULT) as number;
        ctx.deleteQuery(q);
        if (!disjoint && ns > 0) t.gpu.push({ at: now, ms: ns / 1e6 });
      }
    }
    if (t.last && now - t.last < 160) t.frames.push({ at: now, ms: now - t.last });
    t.last = now;
    const cut = now - 1500;
    while (t.gpu.length && t.gpu[0].at < cut) t.gpu.shift();
    while (t.frames.length && t.frames[0].at < cut) t.frames.shift();

    // Continuous drawing: at least ~12 frames a second over the window (idle ticks are slower).
    const continuous = t.frames.length >= 18;
    const frameMs = t.frames.length ? median(t.frames.map((f) => f.ms)) : 0;
    const gpuMs = t.gpu.length >= 6 ? median(t.gpu.map((f) => f.ms)) : NaN;
    perfStats.continuous = continuous;
    perfStats.frameMs = frameMs;
    perfStats.fps = continuous && frameMs > 0 ? 1000 / frameMs : 0;
    perfStats.gpuMs = gpuMs;

    const q = useQuality.getState();
    if (q.mode !== 'auto' || now - t.changedAt < 2000) return;
    const tier = q.tier;
    let verdict: 'down' | 'up' | null = null;
    if (Number.isFinite(gpuMs) && t.gpu.length >= 20) {
      // 60 fps leaves ~16.7 ms per frame, and the browser's compositor needs a slice of it.
      if (gpuMs > 14.5) verdict = 'down';
      else if (gpuMs < 5.5) verdict = 'up';
    } else if (continuous) {
      if (frameMs > 23) verdict = 'down';
      else if (frameMs < 17.6) verdict = 'up';
    }
    if (verdict === 'down' && tier > 0) {
      const next = (tier - 1) as Tier;
      t.blocked.set(tier, now + 60_000); // don't bounce straight back up
      q.auto(next);
    } else if (verdict === 'up' && tier < 3) {
      const next = (tier + 1) as Tier;
      if ((t.blocked.get(next) ?? 0) > now) return;
      if (!t.goodSince) t.goodSince = now;
      if (now - t.goodSince > 3500) q.auto(next);
    } else t.goodSince = 0;
  }, 1000);
  return null;
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

/** With the lens off, nothing else draws the frame (labels use a positive useFrame priority). */
export function DirectRender() {
  useFrame(({ gl, scene, camera }) => {
    gl.setRenderTarget(null);
    gl.render(scene, camera);
  }, 1);
  return null;
}
