import { buildModel, type Model } from './model';
import type { Progress, Result } from './types';
import { $, countUp, esc, sleep, toast } from './view/fx';
import { GlobeView } from './view/globe';
import { renderHeadline, renderStrip, renderTab, type Tab } from './view/panel';
import { makeShareCard } from './view/share';
import { startStars } from './view/stars';

/** Set this to the project's GitHub URL once it's public. */
/** Set to the project's GitHub URL to show a ★ Star link (only once the repo is public). */
const SOURCE_URL = '';
const BG_DEMO = 'vercel/next.js';
const TOKEN_KEY = 'depglobe.token';

interface DemoEntry { repo: string; file: string; packages: number; people: number; countries: number; top: string; featured?: boolean }

type Mode = 'hero' | 'scan' | 'result';

const state = {
  demos: [] as DemoEntry[],
  result: undefined as Result | undefined,
  model: undefined as Model | undefined,
  hqOverride: undefined as string | undefined,
  tab: 'countries' as Tab,
  runId: 0,
  touring: false,
  snapshot: false,
};

// ---------- token ----------
const store = {
  get: () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (t: string, remember: boolean) => {
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
      if (remember) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  },
  clear: () => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
    } catch {}
  },
};
const syncTokenUi = () => {
  const has = !!store.get();
  document.body.classList.toggle('has-token', has);
  $('#token-label').textContent = has ? 'Turbo ✓' : 'Turbo';
};

// ---------- boot ----------
startStars($<HTMLCanvasElement>('#stars'));
const globe = new GlobeView($('#globe'));
globe.onPick = (agg) => {
  if (!state.result) return;
  state.hqOverride = agg.place.id;
  showResult(state.result, { fly: false });
  toast(`⌂ HQ moved to ${agg.place.flag} ${agg.place.label}`);
};
syncTokenUi();
if (SOURCE_URL) $<HTMLAnchorElement>('#gh-link').href = SOURCE_URL;
else $('#gh-link').hidden = true;

function setMode(mode: Mode) {
  document.body.dataset.mode = mode;
  $('#hero').hidden = mode !== 'hero';
  $('#scan').hidden = mode !== 'scan';
  $('#result').hidden = mode !== 'result';
  globe.setMode(mode);
  if (mode !== 'result') stopTour();
}

async function loadDemos() {
  try {
    state.demos = await (await fetch('demos/index.json')).json();
  } catch {
    state.demos = [];
  }
  const featured = state.demos.filter((d) => d.featured);
  const chips = (featured.length ? featured : state.demos.slice(0, 10))
    .map(
      (d) =>
        `<button type="button" class="chip" data-repo="${esc(d.repo)}">${esc(d.repo)} <em>${d.top}</em></button>`,
    )
    .join('');
  $('#demos').innerHTML = chips;
  $('#demos')
    .querySelectorAll<HTMLElement>('.chip')
    .forEach((c) => c.addEventListener('click', () => go(c.dataset.repo!)));

  const others = state.demos.filter((d) => !d.featured).sort(() => Math.random() - 0.5).slice(0, 24);
  const items = [...featured, ...others]
    .map((d) => `<span><b>${esc(d.repo)}</b> → ${d.people.toLocaleString()} humans · ${d.countries} countries ${d.top}</span><i>✦</i>`)
    .join('');
  $('.ticker-track').innerHTML = items + items;

  $('#repo-list').innerHTML = state.demos.map((d) => `<option value="${esc(d.repo)}">⚡ instant · ${d.people.toLocaleString()} humans</option>`).join('');
  if (state.demos.length > 20) $('#instant-count').textContent = `${state.demos.length} popular repos load instantly · any other repo scans live · no token needed`;
}

const findDemo = (repo: string) => state.demos.find((d) => d.repo.toLowerCase() === repo.toLowerCase());

async function fetchDemo(d: DemoEntry): Promise<Result> {
  return (await fetch(d.file)).json();
}

async function heroBackdrop() {
  const d = findDemo(BG_DEMO) ?? state.demos[0];
  if (!d || state.model) return;
  try {
    const r = await fetchDemo(d);
    if (document.body.dataset.mode === 'hero' && !state.model) globe.render(buildModel(r));
  } catch {}
}

// ---------- routing ----------
function parseRepo(input: string): string | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = /(?:github\.com\/)?([\w.-]+)\/([\w.-]+)/i.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

function go(input: string, opts: { live?: boolean } = {}) {
  const repo = parseRepo(input);
  if (!repo) {
    toast('That doesn’t look like a GitHub repo. Try owner/name.', 'err');
    return;
  }
  const url = new URL(location.href);
  url.searchParams.set('repo', repo);
  if (opts.live) url.searchParams.set('live', '1');
  else url.searchParams.delete('live');
  history.pushState({}, '', url);
  route();
}

function route() {
  const params = new URLSearchParams(location.search);
  const repo = params.get('repo');
  if (repo) void run(repo, params.has('live'));
  else {
    state.runId++;
    setMode('hero');
    void heroBackdrop();
  }
}
addEventListener('popstate', route);

// ---------- scan ----------
let t0 = 0;
const term = $('#term');
function log(html: string, cls = '') {
  const div = document.createElement('div');
  div.innerHTML = `<span class="t">[+${((performance.now() - t0) / 1000).toFixed(1).padStart(4, ' ')}s]</span> <span class="${cls}">${html}</span>`;
  term.appendChild(div);
  while (term.children.length > 40) term.firstChild!.remove();
}

const STAGE_RANGE: Record<Progress['stage'], [number, number]> = {
  sbom: [2, 10],
  resolve: [10, 48],
  people: [48, 96],
  geo: [96, 99],
  done: [100, 100],
};
function setBar(p: Progress) {
  const [a, b] = STAGE_RANGE[p.stage];
  const k = p.total ? (p.done ?? 0) / p.total : 0;
  $('#bar').style.width = `${a + (b - a) * k}%`;
}

function scanCounters(m: Model, pkgs: number) {
  countUp($('#c-pkgs'), pkgs, 400);
  countUp($('#c-people'), m.stats.people, 400);
  countUp($('#c-countries'), m.stats.countries, 400);
}

function makePersonLogger() {
  const logged = new Set<string>();
  return (r: Result, max = 4) => {
    const fresh: string[] = [];
    for (const p of r.packages)
      for (const k of p.entities) {
        const e = r.entities[k];
        if (!e?.placeId || logged.has(k)) continue;
        logged.add(k);
        fresh.push(k);
      }
    for (const k of fresh.slice(0, max)) {
      const e = r.entities[k];
      const pl = r.places[e.placeId!];
      log(`<span class="ok">+</span> <span class="hi">@${esc(e.login)}</span> → ${pl.flag} ${esc(pl.label)}`);
    }
    if (fresh.length > max) log(`<span class="t">  …and ${fresh.length - max} more</span>`);
  };
}

async function run(repo: string, forceLive: boolean) {
  const id = ++state.runId;
  const alive = () => id === state.runId;
  state.hqOverride = undefined;
  state.model = undefined;
  setMode('scan');
  $('#scan-repo').textContent = repo;
  term.innerHTML = '';
  $('#bar').style.width = '0%';
  ['#c-pkgs', '#c-people', '#c-countries'].forEach((s) => {
    $(s).dataset.v = '0';
    $(s).textContent = '0';
  });
  globe.clear();
  t0 = performance.now();
  const token = store.get();
  $('#anon-note').hidden = true;

  const demo = !forceLive ? findDemo(repo) : undefined;
  state.snapshot = !!demo;
  try {
    let result: Result;
    if (demo) {
      log(`cache hit: <span class="hi">${esc(demo.repo)}</span> (precomputed)`, 'ok');
      $('#anon-note').hidden = true;
      result = await fetchDemo(demo);
      if (!alive()) return;
      await replay(result, alive);
    } else {
      log(`target: <span class="hi">github.com/${esc(repo)}</span>`);
      log(token ? 'auth: token ✓ (GitHub GraphQL)' : 'auth: none needed → open data via ecosyste.ms + deps.dev', 'ok');
      const { mapRepo } = await import('./pipeline/index');
      const logPeople = makePersonLogger();
      let lastStageMsg = '';
      result = await mapRepo(repo, {
        token,
        onProgress: (p) => {
          if (!alive()) return;
          setBar(p);
          if (p.stage === 'sbom' || (p.message !== lastStageMsg && p.done === undefined)) {
            log(esc(p.message), p.stage === 'done' ? 'ok' : p.message.includes('token') ? 'warn' : '');
          } else if (p.message !== lastStageMsg) log(esc(p.message) + '…');
          lastStageMsg = p.message;
          if (p.stage === 'resolve' && p.total) countUp($('#c-pkgs'), p.total, 400);
        },
        onPartial: (r) => {
          if (!alive()) return;
          const m = buildModel(r);
          globe.render(m, { ping: true });
          scanCounters(m, r.packages.length);
          logPeople(r);
        },
      });
      if (!alive()) return;
    }
    $('#bar').style.width = '100%';
    log('mapped. rendering globe ✦', 'pk');
    await sleep(demo ? 350 : 700);
    if (!alive()) return;
    showResult(result, { fly: true });
  } catch (e) {
    if (!alive()) return;
    console.error(e);
    toast((e as Error).message || 'Something went wrong.', 'err', 7000);
    const url = new URL(location.href);
    url.searchParams.delete('repo');
    url.searchParams.delete('live');
    history.replaceState({}, '', url);
    setMode('hero');
    ($('#repo') as HTMLInputElement).value = repo;
  }
}

/** Replay a precomputed result as if it were streaming in. */
async function replay(result: Result, alive: () => boolean) {
  const eco = [...new Set(result.packages.map((p) => p.ecosystem))];
  log(`SBOM: ${result.sbomTotal.toLocaleString()} packages across ${eco.join(', ')}`);
  if (result.capped) log(`capped to the top ${result.packages.length} (direct deps first)`, 'warn');
  log('tracing packages → source repos via deps.dev…');
  const logPeople = makePersonLogger();
  const steps = 28;
  const n = result.packages.length;
  for (let i = 1; i <= steps; i++) {
    if (!alive()) return;
    const partial = { ...result, packages: result.packages.slice(0, Math.ceil((n * i) / steps)) };
    const m = buildModel(partial);
    globe.render(m, { ping: true });
    scanCounters(m, partial.packages.length);
    logPeople(partial, 2);
    $('#bar').style.width = `${(i / steps) * 100}%`;
    await sleep(85);
  }
}

// ---------- result ----------
function showResult(result: Result, opts: { fly: boolean }) {
  state.result = result;
  const m = buildModel(result, state.hqOverride);
  state.model = m;
  if (document.body.dataset.mode !== 'result') setMode('result');
  globe.render(m);
  globe.setPins(m);
  renderHeadline(m);
  if (state.snapshot) {
    const when = new Date(result.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    $('#r-meta').insertAdjacentHTML('beforeend', ` · snapshot ${when} <button type="button" class="link" id="rescan">↻ rescan live</button>`);
    $('#rescan').addEventListener('click', () => go(result.repo, { live: true }));
  }
  if (opts.fly) {
    renderStrip(m);
    renderTab(state.tab, m, panelHooks);
    const focus = m.hq ?? m.places[0]?.place;
    if (focus) globe.flyTo(focus.lat, focus.lng, globe.restAltitude(), 1800);
    setTimeout(() => globe.resumeRotate(), 2600);
  } else if (state.tab === 'risk' || state.tab === 'countries') renderTab(state.tab, m, panelHooks);
  document.title = `${result.repo} · ${m.stats.people.toLocaleString()} humans in ${m.stats.countries} countries — depglobe`;
}

const panelHooks = {
  onCountry: (cc: string) => {
    const m = state.model;
    const top = m?.places.find((p) => p.place.cc === cc);
    if (top) globe.flyTo(top.place.lat, top.place.lng, innerWidth <= 900 ? 2.4 : 1.5, 1400);
  },
  onNeedToken: () => openToken(),
};

document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab as Tab;
    if (state.model) renderTab(state.tab, state.model, panelHooks);
    $('#panel').classList.add('open');
  }),
);
$('#sheet-handle').addEventListener('click', () => $('#panel').classList.toggle('open'));

// ---------- tour ----------
let tourId = 0;
function stopTour() {
  if (!state.touring) return;
  tourId++;
  state.touring = false;
  document.body.classList.remove('touring');
  $('#tour-caption').classList.remove('show');
  $('#tour-btn').classList.remove('on');
  $('#tour-btn').textContent = '▶ Fly tour';
}

async function tour() {
  const m = state.model;
  if (!m) return;
  if (state.touring) return stopTour();
  const id = ++tourId;
  const on = () => state.touring && id === tourId;
  state.touring = true;
  document.body.classList.add('touring');
  $('#tour-btn').classList.add('on');
  $('#tour-btn').textContent = '■ Stop';
  const cap = $('#tour-caption');
  const stops = m.countries.slice(0, 7);
  for (const c of stops) {
    if (!on()) return;
    const p = m.places.find((a) => a.place.cc === c.cc);
    if (!p) continue;
    globe.flyTo(p.place.lat, p.place.lng, innerWidth <= 900 ? 2.2 : 1.25, 1700);
    cap.classList.remove('show');
    await sleep(900);
    if (!on()) return;
    cap.innerHTML = `<div class="tc-flag">${c.flag}</div><div class="tc-name">${esc(c.name)}</div>
      <div class="tc-sub">${(c.share * 100).toFixed(1)}% of the supply chain · ${c.people.toLocaleString()} humans · ${c.pkgs} packages</div>`;
    cap.classList.add('show');
    await sleep(2600);
  }
  if (!on()) return;
  cap.classList.remove('show');
  const f = m.hq ?? m.places[0]?.place;
  if (f) globe.flyTo(f.lat, f.lng, globe.restAltitude(), 2000);
  await sleep(2000);
  stopTour();
  globe.resumeRotate();
}
$('#tour-btn').addEventListener('click', () => void tour());

// ---------- share ----------
const shareDlg = $<HTMLDialogElement>('#share-dlg');
let shareBlob: Blob | undefined;
const siteUrl = () => `${location.origin}${location.pathname}`;
const shareLink = () => (state.result ? `${siteUrl()}?repo=${state.result.repo}` : siteUrl());
const shareText = () => {
  const m = state.model!;
  return `${m.result.repo} is built by ${m.stats.people.toLocaleString()} humans in ${m.stats.countries} countries 🌍\n\n${m.countries
    .slice(0, 8)
    .map((c) => c.flag)
    .join('')}\n\nWho wrote YOUR code?`;
};

$('#share-btn').addEventListener('click', async () => {
  if (!state.model) return;
  shareDlg.showModal();
  const img = $<HTMLImageElement>('#share-img');
  img.removeAttribute('src');
  shareBlob = await makeShareCard(state.model, globe, siteUrl());
  img.src = URL.createObjectURL(shareBlob);
  const file = new File([shareBlob], 'depglobe.png', { type: 'image/png' });
  $('#share-native').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
});
$('#share-close').addEventListener('click', () => shareDlg.close());
shareDlg.addEventListener('click', (e) => e.target === shareDlg && shareDlg.close());
$('#share-x').addEventListener('click', () =>
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(shareText())}&url=${encodeURIComponent(shareLink())}`, '_blank', 'noopener'),
);
$('#share-li').addEventListener('click', () =>
  window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareLink())}`, '_blank', 'noopener'),
);
$('#share-dl').addEventListener('click', () => {
  if (!shareBlob || !state.result) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(shareBlob);
  a.download = `depglobe-${state.result.repo.replace('/', '-')}.png`;
  a.click();
});
$('#share-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shareLink());
    toast('Link copied ✓');
  } catch {
    toast(shareLink());
  }
});
$('#share-native').addEventListener('click', async () => {
  if (!shareBlob) return;
  try {
    await navigator.share({ files: [new File([shareBlob], 'depglobe.png', { type: 'image/png' })], text: shareText(), url: shareLink() });
  } catch {}
});

// ---------- token dialog ----------
const tokenDlg = $<HTMLDialogElement>('#token-dlg');
function openToken() {
  ($('#token-input') as HTMLInputElement).value = store.get() ?? '';
  let remembered = false;
  try {
    remembered = !!localStorage.getItem(TOKEN_KEY);
  } catch {}
  ($('#token-remember') as HTMLInputElement).checked = remembered;
  tokenDlg.showModal();
}
$('#token-btn').addEventListener('click', openToken);
document.querySelectorAll('[data-open-token]').forEach((b) => b.addEventListener('click', openToken));
$('#token-form').addEventListener('submit', () => {
  const t = ($('#token-input') as HTMLInputElement).value.trim();
  if (t) store.set(t, ($('#token-remember') as HTMLInputElement).checked);
  else store.clear();
  syncTokenUi();
  if (t) toast('Token saved — committers + risk checks unlocked.');
});
$('#token-clear').addEventListener('click', () => {
  store.clear();
  syncTokenUi();
  tokenDlg.close();
  toast('Token forgotten.');
});
tokenDlg.addEventListener('click', (e) => e.target === tokenDlg && tokenDlg.close());

// ---------- hero ----------
$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = ($('#repo') as HTMLInputElement).value;
  if (v.trim()) go(v);
  else ($('#repo') as HTMLInputElement).focus();
});
$('#new-btn').addEventListener('click', () => {
  const url = new URL(location.href);
  url.search = '';
  history.pushState({}, '', url);
  route();
  setTimeout(() => ($('#repo') as HTMLInputElement).focus(), 300);
});
$('#home').addEventListener('click', (e) => {
  e.preventDefault();
  $('#new-btn').click();
});
addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement)?.matches?.('input, textarea');
  if (e.key === '/' && !typing && document.body.dataset.mode === 'hero') {
    e.preventDefault();
    ($('#repo') as HTMLInputElement).focus();
  }
  if (e.key === 'Escape') stopTour();
});
addEventListener('paste', (e) => {
  if (document.body.dataset.mode !== 'hero' || (e.target as HTMLElement)?.matches?.('input')) return;
  const text = e.clipboardData?.getData('text') ?? '';
  if (parseRepo(text)) go(text);
});

await loadDemos();
route();

if (import.meta.env.DEV) Object.assign(window, { __depglobe: { state, globe } });
