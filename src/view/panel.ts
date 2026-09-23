import type { Model, RiskItem } from '../model';
import { $, countUp, esc, fmt, toast } from './fx';
import { buildInsights, type Insight } from './insights';

export type Tab = 'countries' | 'story' | 'risk' | 'packages';

let factTimer = 0;
let lastInsights: Insight[] = [];

/** Rotating "did you know" line under the headline meta, cycling the first 3 insights every 5s. */
function renderFact(m: Model) {
  clearInterval(factTimer);
  const meta = $('#r-meta');
  let el = document.getElementById('r-fact');
  if (!el) {
    el = document.createElement('p');
    el.id = 'r-fact';
    el.className = 'fact';
    meta.insertAdjacentElement('afterend', el);
  }
  const facts = buildInsights(m).slice(0, 3);
  if (!facts.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const line = (f: Insight) => `<span class="fact-e">${f.emoji}</span> ${esc(f.title)} — ${esc(f.body)}`;
  let i = 0;
  el.innerHTML = line(facts[0]!);
  requestAnimationFrame(() => el!.classList.add('show'));
  if (facts.length < 2) return;
  factTimer = window.setInterval(() => {
    el!.classList.remove('show');
    setTimeout(() => {
      i = (i + 1) % facts.length;
      el!.innerHTML = line(facts[i]!);
      el!.classList.add('show');
    }, 420);
  }, 5000);
}

const STACK_COLORS = ['#ff4d00', '#ff8a4d', '#f4f1ea', '#9a958b', '#5c5952', '#262626'];
const repoLink = (repo?: string) => (repo ? `https://github.com/${repo}` : '#');

export interface PanelHooks {
  onCountry: (cc: string) => void;
  onNeedToken: () => void;
}

export function renderHeadline(m: Model) {
  const r = m.result;
  const a = $<HTMLAnchorElement>('#r-repo');
  a.textContent = r.repo;
  a.href = `https://github.com/${r.repo}`;
  countUp($('#r-people'), m.stats.people, 1600);
  countUp($('#r-countries'), m.stats.countries, 1600);
  const bits = [
    `${fmt(m.stats.packages)} packages mapped`,
    r.capped ? `<b>top ${fmt(m.stats.packages)} of ${fmt(r.sbomTotal)}</b>` : '',
    m.hq ? `HQ ⌂ ${esc(m.hq.label)}` : '',
    r.mode === 'anon' ? '<b>owners only — add a token for committers</b>' : '',
    r.mode === 'open' ? 'open data via ecosyste.ms' : '',
  ].filter(Boolean);
  $('#r-meta').innerHTML = bits.join(' · ');
  renderFact(m);
}

export function renderStrip(m: Model) {
  const s = m.stats;
  $('#strip').innerHTML = `
    <div class="stat pk"><b data-n="${s.packages}">0</b><span>packages</span></div>
    <div class="stat pp"><b data-n="${s.people}">0</b><span>humans</span></div>
    <div class="stat ct"><b data-n="${s.countries}">0</b><span>countries</span></div>
    <div class="stat"><b data-n="${s.orgs}">0</b><span>orgs</span></div>
    <div class="stat uk"><b data-n="${s.unknownPct}" data-suffix="%">0</b><span>🌫 unplaced</span></div>`;
  $('#strip')
    .querySelectorAll<HTMLElement>('b[data-n]')
    .forEach((b, i) => setTimeout(() => countUp(b, Number(b.dataset.n), 1400, b.dataset.suffix ?? ''), i * 90));
}

export function renderTab(tab: Tab, m: Model, hooks: PanelHooks) {
  const body = $('#tab-body');
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  if (tab === 'countries') body.innerHTML = countries(m);
  else if (tab === 'story') body.innerHTML = story(m);
  else if (tab === 'risk') body.innerHTML = risk(m);
  else body.innerHTML = packages(m);
  body.scrollTop = 0;

  body.querySelectorAll<HTMLElement>('[data-cc]').forEach((el) => el.addEventListener('click', () => hooks.onCountry(el.dataset.cc!)));
  body.querySelectorAll<HTMLElement>('[data-copy-card]').forEach((el) =>
    el.addEventListener('click', async () => {
      const ins = lastInsights[Number(el.dataset.copyCard)];
      if (!ins) return;
      const text = `${ins.emoji} ${ins.title} — ${ins.body}\n${location.href}`;
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied ✓');
      } catch {
        toast(text);
      }
    }),
  );
  body.querySelectorAll<HTMLElement>('[data-share-card]').forEach((el) =>
    el.addEventListener('click', () => {
      const ins = lastInsights[Number(el.dataset.shareCard)];
      if (ins) document.dispatchEvent(new CustomEvent('depglobe:share-insight', { detail: ins }));
    }),
  );
  body.querySelectorAll<HTMLElement>('[data-open-token]').forEach((el) => el.addEventListener('click', hooks.onNeedToken));
  const search = body.querySelector<HTMLInputElement>('.search');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      body.querySelectorAll<HTMLElement>('.prow').forEach((row) => {
        row.hidden = !!q && !row.dataset.q!.includes(q);
      });
    });
  }
}

function countries(m: Model): string {
  const max = m.countries[0]?.share || 1;
  const rows = m.countries
    .map(
      (c, i) => `<div class="crow" data-cc="${c.cc}">
        <span class="rk">${i + 1}</span><span class="fl">${c.flag}</span>
        <span class="nm">${esc(c.name)}<span class="sub2">${fmt(c.people)} people · ${fmt(c.pkgs)} pkgs</span></span>
        <span class="pc">${(c.share * 100).toFixed(c.share < 0.1 ? 1 : 0)}%</span>
        <span class="bar2"><i style="width:${(c.share / max) * 100}%;animation-delay:${Math.min(i, 20) * 30}ms"></i></span>
      </div>`,
    )
    .join('');
  const unk = m.stats.unknownPct;
  return `${rows}
    <div class="crow unknown-row"><span class="rk">·</span><span class="fl">🌫</span>
      <span class="nm">Unknown<span class="sub2">no location on GitHub</span></span><span class="pc">${unk}%</span></div>
    <p class="ethics">Share = fraction of dependency packages, split across each package's located maintainers. Location is self-reported free text.</p>`;
}

function story(m: Model): string {
  lastInsights = buildInsights(m);
  if (!lastInsights.length) return `<p class="ethics">Not enough located data to tell a story yet.</p>`;
  const cards = lastInsights
    .map(
      (ins, i) => `<div class="icard k-${ins.kind}" style="--i:${i}">
        <div class="icard-top"><span class="icard-e">${ins.emoji}</span>
          <span class="icard-acts">
            <button type="button" class="icard-btn" data-copy-card="${i}" title="Copy as text">📋 Copy</button>
            <button type="button" class="icard-btn" data-share-card="${i}" title="Share this card" aria-label="Share this card">⤴</button>
          </span></div>
        ${ins.big ? `<div class="icard-big">${esc(ins.big)}</div>` : ''}
        <h4 class="icard-t">${esc(ins.title)}</h4>
        <p class="icard-b">${esc(ins.body)}</p>
      </div>`,
    )
    .join('');
  return `<div class="story">${cards}</div>
    <p class="ethics">Facts are computed from self-reported GitHub locations and describe <b>packages</b>, never people. Concentration, not suspicion.</p>`;
}

function list(items: RiskItem[], max = 8): string {
  if (!items.length) return '';
  const seen = new Set<string>();
  const uniq = items.filter((i) => {
    const k = i.pkg.repo ?? i.pkg.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const rows = uniq
    .slice(0, max)
    .map((i) => `<li><a href="${repoLink(i.pkg.repo)}" target="_blank" rel="noopener">${esc(i.pkg.name)}</a><span>${esc(i.detail)}</span></li>`)
    .join('');
  const more = uniq.length - max;
  return `<ul>${rows}${more > 0 ? `<li class="more">+${more} more</li>` : ''}</ul>`;
}

function risk(m: Model): string {
  const r = m.risk;
  const n = m.stats.packages || 1;
  const pct = (x: number) => `${Math.round((x / n) * 100)}%`;
  const top = m.countries.slice(0, 5);
  const rest = 1 - top.reduce((s, c) => s + c.share, 0);
  const stack = [...top.map((c, i) => ({ w: c.share, c: STACK_COLORS[i], l: `${c.flag} ${Math.round(c.share * 100)}%` })), { w: rest, c: STACK_COLORS[5], l: `other ${Math.round(rest * 100)}%` }];
  const concLevel = r.topCountryShare > 0.5 ? 'bad' : r.topCountryShare > 0.3 ? 'warn' : 'good';
  const lockedCard = (title: string, emoji: string) => `<div class="card"><h4>${emoji} ${title}<span class="n">—</span></h4>
      <p class="locked">Needs commit history. <button class="link" data-open-token type="button">Add a GitHub token</button></p></div>`;

  return `
    <div class="card">
      <h4>🌐 Jurisdiction concentration<span class="n ${concLevel}">${Math.round(r.topCountryShare * 100)}%</span></h4>
      <p>${top[0] ? `${top[0].flag} ${esc(top[0].name)} holds the largest share. ` : ''}<b>${r.countriesFor50}</b> ${r.countriesFor50 === 1 ? 'country covers' : 'countries cover'} half of your located supply chain.</p>
      <div class="stack">${stack.map((s) => `<i style="width:${s.w * 100}%;background:${s.c}"></i>`).join('')}</div>
      <div class="legend">${stack.map((s) => `<span style="color:${s.c}">■</span><span>${s.l}</span>`).join('')}</div>
    </div>
    ${
      r.hasPeopleData
        ? `<div class="card"><h4>🧍 Single maintainer<span class="n ${r.single.length ? 'warn' : 'good'}">${r.single.length}</span></h4>
            <p>${pct(r.single.length)} of packages ${
              m.result.mode === 'token' ? 'had one human author across their last 60 commits' : 'have one person behind nearly all commits'
            }. Bus factor: 1.</p>${list(r.single)}</div>`
        : lockedCard('Single maintainer', '🧍')
    }
    ${
      r.hasPeopleData
        ? `<div class="card"><h4>🪦 Abandoned or archived<span class="n ${r.abandoned.length ? 'bad' : 'good'}">${r.abandoned.length}</span></h4>
            <p>Archived, or no push in over two years.</p>${list(r.abandoned)}</div>`
        : lockedCard('Abandoned or archived', '🪦')
    }
    <div class="card"><h4>🛡 Low OpenSSF Scorecard<span class="n ${r.lowScore.length ? 'warn' : 'good'}">${r.lowScore.length}</span></h4>
      <p>Scorecard below 4 / 10 (via deps.dev) — weak branch protection, no code review, unsigned releases…</p>${list(r.lowScore)}</div>
    <p class="ethics">Flags describe <b>packages</b>, never people. Where someone lives says nothing about their trustworthiness — this view is about concentration and sovereignty, not suspicion.</p>`;
}

function packages(m: Model): string {
  const r = m.result;
  const rows = r.packages
    .map((p) => {
      const flags = [...new Set(p.entities.map((k) => r.places[r.entities[k]?.placeId ?? '']?.flag).filter(Boolean))].join('') || '🌫';
      const q = `${p.name} ${p.repo ?? ''} ${p.ecosystem}`.toLowerCase();
      return `<div class="prow" data-q="${esc(q)}"><span class="eco">${p.ecosystem}</span>
        <a class="pn" href="${repoLink(p.repo)}" target="_blank" rel="noopener">${esc(p.name)} ${p.direct ? '' : '<small>transitive</small>'}</a>
        <span class="pf">${flags}</span></div>`;
    })
    .join('');
  return `<input class="search" placeholder="Filter ${fmt(r.packages.length)} packages…" spellcheck="false">${rows}`;
}
