export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const counting = new WeakMap<HTMLElement, number>();
/** Animate a number from its current value to `to`. */
export function countUp(el: HTMLElement, to: number, ms = 1200, suffix = '') {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = String(to);
  const t0 = performance.now();
  cancelAnimationFrame(counting.get(el) ?? 0);
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(from + (to - from) * e) + suffix;
    if (k < 1) counting.set(el, requestAnimationFrame(step));
  };
  counting.set(el, requestAnimationFrame(step));
}

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'err' = 'info', ms = 4200) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind === 'err' ? 'err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

export const avatar = (url?: string, size = 52) =>
  url ? `${url}${url.includes('?') ? '&' : '?'}s=${size}` : '';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
