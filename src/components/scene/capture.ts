import { useFrame, useThree } from '@react-three/fiber';

/**
 * Grab the next rendered frame as a 2D canvas. The WebGL drawing buffer is only readable in the
 * same task that rendered it, so the copy happens in a useFrame that runs after the lens pass.
 */
const pending: ((c: HTMLCanvasElement) => void)[] = [];
let invalidateRef: (() => void) | null = null;

export function captureFrame(width = 512): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    pending.push((src) => {
      const h = Math.round((width * src.height) / Math.max(1, src.width));
      const c = document.createElement('canvas');
      c.width = width;
      c.height = h;
      c.getContext('2d')!.drawImage(src, 0, 0, width, h);
      resolve(c);
    });
    invalidateRef?.();
  });
}

export function CaptureHook() {
  const invalidate = useThree((s) => s.invalidate);
  invalidateRef = invalidate;
  useFrame(({ gl }) => {
    while (pending.length) pending.shift()!(gl.domElement);
  }, 999);
  return null;
}
