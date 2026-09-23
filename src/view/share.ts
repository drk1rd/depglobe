import type { Model } from '../model';
import { fmt } from './fx';
import type { GlobeView } from './globe';

export type CardFormat = 'wide' | 'square' | 'story';

export const CARD_SIZE: Record<CardFormat, { w: number; h: number }> = {
  wide: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

// palette (strict)
const BG = '#03040b';
const INK = '#eef3ff';
const MUTED = '#8b93b8';
const DIM = '#545b80';
const CYAN = '#34f5ff';
const VIOLET = '#8a5cff';
const PINK = '#ff3ea5';
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

/** Where the globe pixels come from: a square crop centred at (cx, cy) with radius r, in source pixels. */
export interface GlobeSrc { src: CanvasImageSource; cx: number; cy: number; r: number }

/** Per-frame animation state for the reel (all 0..1). */
export interface CardAnim { number: number; flags: number[] }

export async function loadCardFonts() {
  await Promise.all([
    document.fonts.load('900 120px Unbounded'),
    document.fonts.load('400 30px Unbounded'),
    document.fonts.load('500 30px "Space Grotesk"'),
    document.fonts.load('600 24px "JetBrains Mono"'),
  ]).catch(() => {});
}

// deterministic starfield so the reel doesn't twinkle frame-to-frame
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

/** Background, atmosphere glows and stars for a format, at the format's logical size. */
export function paintBackdrop(x: Ctx, format: CardFormat) {
  const { w: W, h: H } = CARD_SIZE[format];
  x.fillStyle = BG;
  x.fillRect(0, 0, W, H);
  const glow = (gx: number, gy: number, r: number, col: string) => {
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  };
  if (format === 'wide') {
    glow(900, 315, 460, 'rgba(138,92,255,0.35)');
    glow(120, 620, 420, 'rgba(52,245,255,0.14)');
    glow(1150, 40, 300, 'rgba(255,62,165,0.18)');
  } else if (format === 'square') {
    glow(540, 330, 520, 'rgba(138,92,255,0.34)');
    glow(80, 1060, 460, 'rgba(52,245,255,0.14)');
    glow(1040, 60, 380, 'rgba(255,62,165,0.18)');
  } else {
    glow(540, 830, 760, 'rgba(138,92,255,0.34)');
    glow(60, 1900, 620, 'rgba(52,245,255,0.14)');
    glow(1040, 120, 520, 'rgba(255,62,165,0.18)');
  }
  const rand = rng(format === 'wide' ? 7 : format === 'square' ? 11 : 13);
  const n = Math.round((W * H) / 3400);
  for (let i = 0; i < n; i++) {
    x.fillStyle = `rgba(220,230,255,${rand() * 0.7})`;
    x.beginPath();
    x.arc(rand() * W, rand() * H, rand() * 1.2 * (format === 'wide' ? 1 : 1.3), 0, Math.PI * 2);
    x.fill();
  }
}

function paintGlobe(x: Ctx, g: GlobeSrc, GX: number, GY: number, GR: number) {
  // soft halo behind the disc
  const halo = x.createRadialGradient(GX, GY, GR * 0.6, GX, GY, GR * 1.35);
  halo.addColorStop(0, 'rgba(138,92,255,0.22)');
  halo.addColorStop(1, 'rgba(138,92,255,0)');
  x.fillStyle = halo;
  x.beginPath();
  x.arc(GX, GY, GR * 1.35, 0, Math.PI * 2);
  x.fill();

  x.save();
  x.beginPath();
  x.arc(GX, GY, GR, 0, Math.PI * 2);
  x.closePath();
  x.clip();
  x.drawImage(g.src, g.cx - g.r, g.cy - g.r, g.r * 2, g.r * 2, GX - GR, GY - GR, GR * 2, GR * 2);
  x.restore();

  // rim glow
  const rim = x.createRadialGradient(GX, GY, GR * 0.92, GX, GY, GR * 1.12);
  rim.addColorStop(0, 'rgba(77,107,255,0)');
  rim.addColorStop(0.5, 'rgba(77,107,255,0.35)');
  rim.addColorStop(1, 'rgba(77,107,255,0)');
  x.fillStyle = rim;
  x.beginPath();
  x.arc(GX, GY, GR * 1.12, 0, Math.PI * 2);
  x.fill();
}

const brandGrad = (x: Ctx, x0: number, x1: number) => {
  const g = x.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, CYAN);
  g.addColorStop(0.5, VIOLET);
  g.addColorStop(1, PINK);
  return g;
};

/** Shrink `px` until `text` fits in `maxW`; leaves x.font set. */
function fit(x: Ctx, text: string, font: (px: number) => string, px: number, maxW: number) {
  let p = px;
  x.font = font(p);
  while (x.measureText(text).width > maxW && p > 14) x.font = font(--p);
  return p;
}

/** "dep" (light) + "globe" (gradient). Returns total width. */
function paintBrand(x: Ctx, left: number, y: number, size: number, align: 'left' | 'center' = 'left') {
  x.font = `400 ${size}px Unbounded`;
  const dw = x.measureText('dep').width;
  x.font = `900 ${size}px Unbounded`;
  const gw = x.measureText('globe').width;
  const L = align === 'center' ? left - (dw + gw) / 2 : left;
  x.textAlign = 'left';
  x.font = `400 ${size}px Unbounded`;
  x.fillStyle = INK;
  x.fillText('dep', L, y);
  x.font = `900 ${size}px Unbounded`;
  x.fillStyle = brandGrad(x, L + dw, L + dw + gw);
  x.fillText('globe', L + dw, y);
  return dw + gw;
}

/** "humans in N countries" with N in pink. */
function paintCountriesLine(x: Ctx, m: Model, cx: number, y: number, size: number, align: 'left' | 'center') {
  const pre = 'humans in ';
  const cn = `${m.stats.countries}`;
  const post = ' countries';
  x.font = `400 ${size}px Unbounded`;
  const pw = x.measureText(pre).width;
  const ow = x.measureText(post).width;
  x.font = `900 ${size}px Unbounded`;
  const cw = x.measureText(cn).width;
  const L = align === 'center' ? cx - (pw + cw + ow) / 2 : cx;
  x.textAlign = 'left';
  x.font = `400 ${size}px Unbounded`;
  x.fillStyle = INK;
  x.fillText(pre, L, y);
  x.font = `900 ${size}px Unbounded`;
  x.fillStyle = PINK;
  x.fillText(cn, L + pw, y);
  x.font = `400 ${size}px Unbounded`;
  x.fillStyle = INK;
  x.fillText(post, L + pw + cw, y);
}

function paintFlags(
  x: Ctx,
  m: Model,
  cx: number,
  y: number,
  o: { size: number; gap: number; pct: number; align: 'left' | 'center'; alphas?: number[] },
) {
  const top = m.countries.slice(0, 6);
  if (!top.length) return;
  x.font = `${o.size}px ${EMOJI}`;
  const widths = top.map((c) => x.measureText(c.flag).width);
  const total = widths.reduce((s, w) => s + w, 0) + o.gap * (top.length - 1);
  let fx = o.align === 'center' ? cx - total / 2 : cx;
  x.textAlign = 'left';
  top.forEach((c, i) => {
    const a = o.alphas?.[i] ?? 1;
    if (a <= 0) {
      fx += widths[i] + o.gap;
      return;
    }
    x.save();
    x.globalAlpha = a;
    const lift = (1 - a) * o.size * 0.3;
    x.font = `${o.size}px ${EMOJI}`;
    x.fillStyle = INK;
    x.fillText(c.flag, fx, y + lift);
    x.font = `600 ${o.pct}px "JetBrains Mono"`;
    x.fillStyle = MUTED;
    const label = `${Math.round(c.share * 100)}%`;
    x.fillText(label, fx + (widths[i] - x.measureText(label).width) / 2, y + o.size * 0.72 + lift);
    x.restore();
    fx += widths[i] + o.gap;
  });
}

function paintFooter(x: Ctx, siteUrl: string, cx: number, y: number, size: number, align: 'left' | 'center') {
  const q = 'Who wrote YOUR code? → ';
  const url = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  x.font = `600 ${size}px "JetBrains Mono"`;
  const qw = x.measureText(q).width;
  const uw = x.measureText(url).width;
  const L = align === 'center' ? cx - (qw + uw) / 2 : cx;
  x.textAlign = 'left';
  x.fillStyle = DIM;
  x.fillText(q, L, y);
  x.fillStyle = CYAN;
  x.fillText(url, L + qw, y);
}

const easeOut = (k: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 4);

/**
 * Paint a full card at the format's logical size onto `x` (scale the context first for hi-dpi).
 * `backdrop`, when given, is drawn instead of regenerating the starfield (used by the reel).
 */
export function paintCard(
  x: Ctx,
  m: Model,
  siteUrl: string,
  format: CardFormat,
  g: GlobeSrc,
  opts: { anim?: CardAnim; backdrop?: CanvasImageSource } = {},
) {
  const { w: W, h: H } = CARD_SIZE[format];
  if (opts.backdrop) x.drawImage(opts.backdrop, 0, 0, W, H);
  else paintBackdrop(x, format);
  x.textBaseline = 'alphabetic';

  const repo = m.result.repo;
  const people = fmt(m.stats.people * (opts.anim ? easeOut(opts.anim.number) : 1));
  const numGrad = (L: number, w: number) => brandGrad(x, L, L + w);

  if (format === 'wide') {
    paintGlobe(x, g, 890, 318, 282);
    const L = 64;
    paintBrand(x, L, 78, 24);

    fit(x, repo, (p) => `600 ${p}px "JetBrains Mono"`, 30, 520);
    x.textAlign = 'left';
    x.fillStyle = CYAN;
    x.fillText(repo, L, 168);

    x.font = '500 28px "Space Grotesk"';
    x.fillStyle = MUTED;
    x.fillText('is built by', L, 214);

    const px = fit(x, people, (p) => `900 ${p}px Unbounded`, 132, 520);
    const ny = 214 + px * 0.95;
    x.fillStyle = numGrad(L, x.measureText(people).width);
    x.fillText(people, L, ny);

    const y2 = ny + 58;
    paintCountriesLine(x, m, L, y2, 38, 'left');
    paintFlags(x, m, L, y2 + 72, { size: 36, gap: 44, pct: 14, align: 'left', alphas: opts.anim?.flags });
    paintFooter(x, siteUrl, L, H - 44, 17, 'left');
    return;
  }

  if (format === 'square') {
    paintGlobe(x, g, 540, 316, 276);
    paintBrand(x, 56, 66, 22);
    const C = W / 2;

    fit(x, repo, (p) => `600 ${p}px "JetBrains Mono"`, 30, 940);
    x.textAlign = 'center';
    x.fillStyle = CYAN;
    x.fillText(repo, C, 668);

    const px = fit(x, people, (p) => `900 ${p}px Unbounded`, 136, 940);
    const nw = x.measureText(people).width;
    const ny = 680 + px * 0.95;
    x.textAlign = 'center';
    x.fillStyle = numGrad(C - nw / 2, nw);
    x.fillText(people, C, ny);

    const y2 = ny + 56;
    paintCountriesLine(x, m, C, y2, 36, 'center');
    paintFlags(x, m, C, y2 + 74, { size: 40, gap: 52, pct: 15, align: 'center', alphas: opts.anim?.flags });
    paintFooter(x, siteUrl, C, H - 38, 17, 'center');
    return;
  }

  // story — safe margins ≥180px top/bottom for IG/TikTok chrome
  const C = W / 2;
  paintGlobe(x, g, 540, 830, 440);
  paintBrand(x, C, 262, 30, 'center');

  fit(x, repo, (p) => `600 ${p}px "JetBrains Mono"`, 34, 900);
  x.textAlign = 'center';
  x.fillStyle = CYAN;
  x.fillText(repo, C, 334);

  const px = fit(x, people, (p) => `900 ${p}px Unbounded`, 176, 960);
  const nw = x.measureText(people).width;
  const ny = 1300 + px * 0.95;
  x.textAlign = 'center';
  x.fillStyle = numGrad(C - nw / 2, nw);
  x.fillText(people, C, ny);

  const y2 = ny + 68;
  paintCountriesLine(x, m, C, y2, 46, 'center');
  paintFlags(x, m, C, y2 + 96, { size: 56, gap: 68, pct: 20, align: 'center', alphas: opts.anim?.flags });
  paintFooter(x, siteUrl, C, H - 186, 24, 'center');
}

/** Render a static share card (2× for crispness) and return it as a PNG blob. */
export async function makeShareCard(m: Model, globe: GlobeView, siteUrl: string, format: CardFormat = 'wide'): Promise<Blob> {
  await loadCardFonts();
  const shot = await globe.snapshot();
  const { w: W, h: H } = CARD_SIZE[format];
  const S = 2;
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = H * S;
  const x = c.getContext('2d')!;
  x.scale(S, S);
  paintCard(x, m, siteUrl, format, { src: shot.img, cx: shot.cx, cy: shot.cy, r: shot.r });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not render the card.'))), 'image/png'));
}
