import type { Entity, Pkg, Progress, Result } from '../types';
import { fetchProject, resolveRepo } from './depsdev';
import { geocode } from './geocode';
import { fetchOwnersREST, fetchReposGraphQL, fetchUserREST, ghHeaders, type RepoInfo } from './github';
import { fetchManifestPackages, fetchOwnersEco, fetchReposEco } from './ecosystems';
import { fetchSbom, parseRepoInput, SbomError } from './sbom';
import { pool } from './util';

export { parseRepoInput };

export interface RunOptions {
  token?: string;
  cap?: number;
  onProgress?: (p: Progress) => void;
  onPartial?: (r: Result) => void;
}

const key = (login: string) => login.toLowerCase();

export async function mapRepo(input: string, opts: RunOptions = {}): Promise<Result> {
  const { token, onProgress = () => {}, onPartial = () => {} } = opts;
  // Without a token every lookup is a separate ~0.5s call, so keep scans snappy.
  const cap = opts.cap ?? (token ? 400 : 200);
  const parsed = parseRepoInput(input);
  if (!parsed) throw new Error('That doesn’t look like a GitHub repo. Try owner/name or a github.com URL.');
  const { owner, repo } = parsed;
  const target = `${owner}/${repo}`.toLowerCase();

  // 1 — SBOM
  onProgress({ stage: 'sbom', message: `Pulling the SBOM for ${owner}/${repo}` });
  let sbomPackages: Pkg[];
  try {
    sbomPackages = (await fetchSbom(owner, repo, token)).packages;
  } catch (e) {
    if (!(e instanceof SbomError)) throw e;
    const rateLimited = !token && (e.status === 403 || e.status === 429);
    // 404 also covers "repo exists but GitHub hasn't built its dependency graph" (e.g. just made public).
    if (!rateLimited && e.status !== 404) throw e;
    onProgress({
      stage: 'sbom',
      message: rateLimited
        ? 'GitHub anonymous limit hit → reading manifests via ecosyste.ms (direct deps)'
        : 'No GitHub dependency graph → reading manifests via ecosyste.ms (direct deps)',
    });
    try {
      sbomPackages = await fetchManifestPackages(owner, repo);
    } catch {
      throw e;
    }
    if (!sbomPackages.length) throw e;
  }
  const all = sbomPackages.sort((a, b) => Number(b.direct) - Number(a.direct));
  const packages = all.slice(0, cap);
  const ecos = new Set(packages.map((p) => p.ecosystem));
  onProgress({
    stage: 'sbom',
    message: `${all.length.toLocaleString()} packages across ${[...ecos].join(', ') || 'no ecosystems'}`,
  });
  if (!packages.length) throw new Error(`GitHub found no dependencies for ${owner}/${repo}.`);

  const result: Result = {
    repo: `${owner}/${repo}`,
    generatedAt: new Date().toISOString(),
    mode: token ? 'token' : 'open',
    sbomTotal: all.length,
    capped: all.length > cap,
    packages,
    entities: {},
    places: {},
  };

  let lastEmit = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 200) return;
    lastEmit = now;
    onPartial({ ...result, packages: [...result.packages] });
  };

  const addEntity = (e: Entity): string => {
    const k = key(e.login);
    const existing = result.entities[k];
    if (existing?.placeId !== undefined || (existing && !e.location)) return k;
    const place = geocode(e.location);
    if (place) result.places[place.id] ??= place;
    result.entities[k] = { ...e, placeId: place?.id };
    return k;
  };

  // 2 — deps.dev: package → source repo
  onProgress({ stage: 'resolve', message: 'Tracing packages to their source repos', done: 0, total: packages.length });
  await pool(
    packages,
    12,
    async (p) => {
      p.repo = await resolveRepo(p);
    },
    (done) => onProgress({ stage: 'resolve', message: 'Tracing packages to their source repos', done, total: packages.length }),
  );
  const repos = [...new Set(packages.map((p) => p.repo).filter((r): r is string => !!r && r !== target))];
  onProgress({ stage: 'resolve', message: `${repos.length} unique source repos` });

  // 3 — scorecards (in parallel with GitHub)
  const scorecards = pool(repos, 12, async (r) => {
    const info = await fetchProject(r);
    for (const p of packages) if (p.repo === r) Object.assign(p, { scorecard: info.scorecard, stars: p.stars ?? info.stars });
  });

  // 4 — GitHub people
  const applyRepo = (info: RepoInfo) => {
    const logins = info.entities.map(addEntity);
    for (const p of packages)
      if (p.repo === info.repo)
        Object.assign(p, {
          entities: logins,
          archived: info.archived,
          pushedAt: info.pushedAt,
          stars: info.stars,
          humans: info.humans,
        });
  };

  if (token) {
    const total = repos.length + 1;
    onProgress({ stage: 'people', message: 'Finding the humans behind each repo', done: 0, total });
    const infos = await fetchReposGraphQL([target, ...repos], token, (batch, done) => {
      for (const info of batch) if (info.repo !== target) applyRepo(info);
      onProgress({ stage: 'people', message: 'Finding the humans behind each repo', done, total });
      emit();
    });
    const t = infos.get(target);
    if (t) {
      const cands = t.entities.map(addEntity);
      const hq = cands.find((k) => result.entities[k]?.placeId);
      if (hq) result.hq = { login: result.entities[hq].login, placeId: result.entities[hq].placeId! };
    }
  } else {
    await peopleFromEcosystems();
  }

  async function peopleFromEcosystems() {
    const total = repos.length + 1;
    onProgress({ stage: 'people', message: 'Reading repo histories via ecosyste.ms', done: 0, total });
    const { infos } = await fetchReposEco([target, ...repos], (_info, done) =>
      onProgress({ stage: 'people', message: 'Reading repo histories via ecosyste.ms', done, total }),
    );
    if (!infos.size) return peopleFromGithubRest();

    // Attach logins now; people light up on the globe as their profiles arrive.
    const weight = new Map<string, number>();
    for (const [r, info] of infos) {
      if (r === target) continue;
      const keys = info.logins.map(key);
      for (const p of packages)
        if (p.repo === r)
          Object.assign(p, { entities: keys, archived: info.archived, pushedAt: info.pushedAt, stars: info.stars, humans: info.humans });
      const w = packages.filter((p) => p.repo === r).length;
      for (const k of keys) weight.set(k, (weight.get(k) ?? 0) + w);
    }
    const t = infos.get(target);
    const hqCands = (t?.logins ?? [owner]).map(key);
    const logins = [...new Set([...hqCands, ...[...weight.keys()].sort((a, b) => weight.get(b)! - weight.get(a)!)])];

    onProgress({ stage: 'people', message: `Locating ${logins.length} maintainers`, done: 0, total: logins.length });
    const { exhausted } = await fetchOwnersEco(logins, (e, done) => {
      addEntity(e);
      onProgress({ stage: 'people', message: `Locating ${logins.length} maintainers`, done, total: logins.length });
      emit();
    });
    const hq = hqCands.find((k) => result.entities[k]?.placeId);
    if (hq) result.hq = { login: result.entities[hq].login, placeId: result.entities[hq].placeId! };
    if (exhausted) onProgress({ stage: 'people', message: 'ecosyste.ms hourly limit reached — some maintainers left unplaced.' });
  }

  async function peopleFromGithubRest() {
    result.mode = 'anon';
    let remaining = 55;
    try {
      const rl: any = await (await fetch('https://api.github.com/rate_limit', { headers: ghHeaders() })).json();
      remaining = rl?.resources?.core?.remaining ?? remaining;
    } catch {}
    const hqUser = remaining > 1 ? await fetchUserREST(owner) : undefined;
    if (hqUser) {
      const k = addEntity(hqUser);
      if (result.entities[k].placeId) result.hq = { login: hqUser.login, placeId: result.entities[k].placeId! };
    }
    // Owners that cover the most packages first, so a small budget goes furthest.
    const weight = new Map<string, number>();
    for (const p of packages) if (p.repo && p.repo !== target) {
      const o = p.repo.split('/')[0];
      weight.set(o, (weight.get(o) ?? 0) + 1);
    }
    const owners = [...weight.keys()].sort((a, b) => weight.get(b)! - weight.get(a)!);
    const budget = Math.max(0, remaining - 3);
    onProgress({ stage: 'people', message: `Looking up ${owners.length} maintainers (no token: ${budget} requests left)`, done: 0, total: owners.length });
    const { exhausted } = await fetchOwnersREST(owners, budget, (e, done) => {
      const k = addEntity(e);
      for (const p of packages) if (p.repo?.split('/')[0] === k) p.entities = [k];
      onProgress({ stage: 'people', message: 'Looking up maintainers', done, total: owners.length });
      emit();
    });
    if (exhausted)
      onProgress({ stage: 'people', message: 'Anonymous GitHub budget used up. Add a token to see everyone.' });
  }

  await scorecards;
  onProgress({ stage: 'geo', message: 'Placing everyone on the map' });
  result.generatedAt = new Date().toISOString();
  emit(true);
  onProgress({ stage: 'done', message: 'Done' });
  return result;
}

export type { Pkg };
