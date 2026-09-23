import type { Model } from '../model';
import { fmt } from './fx';
import type { GlobeView } from './globe';

const W = 1200;
const H = 630;

export async function makeShareCard(m: Model, globe: GlobeView, siteUrl: string): Promise<Blob> {
  await Promise.all([
    document.fonts.load('900 120px Unbounded'),
    document.fonts.load('400 30px Unbounded'),
    document.fonts.load('500 30px "Space Grotesk"'),
    document.fonts.load('600 24px "JetBrains Mono"'),
  ]).catch(() => {});
  const shot = await globe.snapshot();

  const S = 2;
  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = H * S;
  const x = c.getContext('2d')!;
  x.scale(S, S);

  // background
  x.fillStyle = '#03040b';
  x.fillRect(0, 0, W, H);
  const glow = (gx: number, gy: number, r: number, col: string) => {
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  };
  glow(900, 315, 460, 'rgba(138,92,255,0.35)');
  glow(120, 620, 420, 'rgba(52,245,255,0.14)');
  glow(1150, 40, 300, 'rgba(255,62,165,0.18)');
  for (let i = 0; i < 220; i++) {
    x.fillStyle = `rgba(220,230,255,${Math.random() * 0.7})`;
    x.beginPath();
    x.arc(Math.random() * W, Math.random() * H, Math.random() * 1.2, 0, Math.PI * 2);
    x.fill();
  }

  // globe
  const GX = 890, GY = 318, GR = 282;
  x.save();
  x.beginPath();
  x.arc(GX, GY, GR, 0, Math.PI * 2);
  x.closePath();
  x.clip();
  x.drawImage(shot.img, shot.cx - shot.r, shot.cy - shot.r, shot.r * 2, shot.r * 2, GX - GR, GY - GR, GR * 2, GR * 2);
  x.restore();
  const rim = x.createRadialGradient(GX, GY, GR * 0.92, GX, GY, GR * 1.12);
  rim.addColorStop(0, 'rgba(77,107,255,0)');
  rim.addColorStop(0.5, 'rgba(77,107,255,0.35)');
  rim.addColorStop(1, 'rgba(77,107,255,0)');
  x.fillStyle = rim;
  x.beginPath();
  x.arc(GX, GY, GR * 1.12, 0, Math.PI * 2);
  x.fill();

  // text
  const L = 64;
  const grad = (x0: number, x1: number) => {
    const g = x.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#34f5ff');
    g.addColorStop(0.5, '#8a5cff');
    g.addColorStop(1, '#ff3ea5');
    return g;
  };
  x.textBaseline = 'alphabetic';

  x.font = '400 24px Unbounded';
  x.fillStyle = '#eef3ff';
  x.fillText('dep', L, 78);
  const dw = x.measureText('dep').width;
  x.font = '900 24px Unbounded';
  x.fillStyle = grad(L + dw, L + dw + 90);
  x.fillText('globe', L + dw, 78);

  const fit = (text: string, font: (px: number) => string, px: number, maxW: number) => {
    let p = px;
    x.font = font(p);
    while (x.measureText(text).width > maxW && p > 14) x.font = font(--p);
    return p;
  };

  const repo = m.result.repo;
  fit(repo, (p) => `600 ${p}px "JetBrains Mono"`, 30, 520);
  x.fillStyle = '#34f5ff';
  x.fillText(repo, L, 168);

  x.font = '500 28px "Space Grotesk"';
  x.fillStyle = '#8b93b8';
  x.fillText('is built by', L, 214);

  const people = fmt(m.stats.people);
  const px = fit(people, (p) => `900 ${p}px Unbounded`, 132, 520);
  x.fillStyle = grad(L, L + x.measureText(people).width);
  x.fillText(people, L, 214 + px * 0.95);

  const y2 = 214 + px * 0.95 + 58;
  x.font = '400 38px Unbounded';
  x.fillStyle = '#eef3ff';
  const pre = 'humans in ';
  x.fillText(pre, L, y2);
  const pw = x.measureText(pre).width;
  x.font = '900 38px Unbounded';
  x.fillStyle = '#ff3ea5';
  const cn = `${m.stats.countries}`;
  x.fillText(cn, L + pw, y2);
  const cw = x.measureText(cn).width;
  x.font = '400 38px Unbounded';
  x.fillStyle = '#eef3ff';
  x.fillText(' countries', L + pw + cw, y2);

  // flags
  const top = m.countries.slice(0, 6);
  let fx = L;
  const fy = y2 + 72;
  for (const c of top) {
    x.font = '36px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    x.fillText(c.flag, fx, fy);
    x.font = '600 14px "JetBrains Mono"';
    x.fillStyle = '#8b93b8';
    x.fillText(`${Math.round(c.share * 100)}%`, fx + 2, fy + 24);
    x.fillStyle = '#eef3ff';
    fx += 84;
  }

  x.font = '600 17px "JetBrains Mono"';
  x.fillStyle = '#545b80';
  x.fillText('Who wrote YOUR code? →', L, H - 44);
  const qw = x.measureText('Who wrote YOUR code? → ').width;
  x.fillStyle = '#c6ff3d';
  x.fillText(siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''), L + qw, H - 44);

  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}
