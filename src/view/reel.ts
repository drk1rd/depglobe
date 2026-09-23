import type { Model } from '../model';
import type { GlobeView } from './globe';
import { CARD_SIZE, loadCardFonts, paintBackdrop, paintCard } from './share';

const FPS = 30;
/**
 * The encoder can take a few hundred ms to begin capturing on first use, which would make the file shorter than
 * promised. Hold the opening pose that long before the clock starts; a reel slightly over length beats one under.
 */
const WARMUP = 0.4;
const MIMES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

/**
 * Record a vertical (1080×1920) video of the live globe spinning inside the Story layout.
 * Resolves with the encoded blob once the recorder stops.
 */
export async function recordReel(
  m: Model,
  globe: GlobeView,
  siteUrl: string,
  opts: { seconds?: number; onProgress?: (k: number) => void } = {},
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  if (typeof MediaRecorder === 'undefined') throw new Error('Recording isn’t supported in this browser — try Chrome or Safari 17+.');
  const seconds = opts.seconds ?? 8;
  await loadCardFonts();

  const { w: W, h: H } = CARD_SIZE.story;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const x = out.getContext('2d')!;

  // static backdrop rendered once; the per-frame pass just blits it
  const back = document.createElement('canvas');
  back.width = W;
  back.height = H;
  paintBackdrop(back.getContext('2d')!, 'story');

  const mime = MIMES.find((t) => MediaRecorder.isTypeSupported(t));
  const ext: 'mp4' | 'webm' = mime?.startsWith('video/mp4') ? 'mp4' : 'webm';
  const stream = out.captureStream(FPS);
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 14_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const ctl = globe.g.controls() as any;
  const prev = { autoRotate: ctl.autoRotate, autoRotateSpeed: ctl.autoRotateSpeed };
  ctl.autoRotate = true;
  ctl.autoRotateSpeed = 2.2;
  document.body.classList.add('recording');
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    ctl.autoRotate = prev.autoRotate;
    ctl.autoRotateSpeed = prev.autoRotateSpeed;
    document.body.classList.remove('recording');
    stream.getTracks().forEach((t) => t.stop());
  };

  const flags = m.countries.slice(0, 6).length;
  const drawFrame = (t: number) => {
    const geo = globe.frameGeometry();
    paintCard(x, m, siteUrl, 'story', { src: geo.canvas, cx: geo.cx, cy: geo.cy, r: geo.r }, {
      backdrop: back,
      anim: {
        number: t / 1.5,
        flags: Array.from({ length: flags }, (_, i) => Math.max(0, Math.min(1, (t - 0.6 - i * 0.14) / 0.45))),
      },
    });
  };

  return new Promise((resolve, reject) => {
    let raf = 0;
    let t0 = 0;
    rec.onerror = (e) => {
      cancelAnimationFrame(raf);
      restore();
      reject((e as ErrorEvent).error ?? new Error('Recording failed.'));
    };
    rec.onstop = () => {
      restore();
      const blob = new Blob(chunks, { type: rec.mimeType || mime || `video/${ext}` });
      if (!blob.size) reject(new Error('The recorder produced no data.'));
      else resolve({ blob, ext });
    };
    const frame = (now: number) => {
      if (!t0) t0 = now + WARMUP * 1000;
      const t = (now - t0) / 1000; // negative during warm-up: the scene holds its opening pose
      drawFrame(Math.max(0, t));
      opts.onProgress?.(Math.max(0, Math.min(1, t / seconds)));
      if (t >= seconds) {
        rec.stop();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    drawFrame(0);
    rec.onstart = () => (raf = requestAnimationFrame(frame));
    try {
      rec.start(250);
    } catch (e) {
      restore();
      reject(e);
    }
  });
}
