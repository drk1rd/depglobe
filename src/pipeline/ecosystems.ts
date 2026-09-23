// Token-free people data via ecosyste.ms (open data, CORS, 5k req/hr per visitor IP).
import type { Ecosystem, Entity, Pkg } from '../types';
import { cacheGet, cacheSet } from './cache';
import type { RepoInfo } from './github';
import { isBot, pool } from './util';

const REPOS = 'https://repos.ecosyste.ms/api/v1/hosts/GitHub';
const COMMITS = 'https://commits.ecosyste.ms/api/v1/hosts/GitHub';
const TOP_COMMITTERS = 5;

export const avatarFor = (login: string) => `https://avatars.githubusercontent.com/${login}`;

class Budget {
  exhausted = false;
  async get<T>(url: string): Promise<T | null> {
    if (this.exhausted) return null;
    const res = await fetch(url);
    if (Number(res.headers.get('x-ratelimit-remaining') ?? '999') < 25) this.exhausted = true;
    if (res.status === 429) {
      this.exhausted = true;
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  }
}

export interface EcoRepo extends Omit<RepoInfo, 'entities'> {
  logins: string[]; // owner first, then top committers
}

/** Repo metadata + committers for many repos. Missing data just yields fewer people. */
export async function fetchReposEco(
  repos: string[],
  onEach: (info: EcoRepo, done: number) => void,
): Promise<{ infos: Map<string, EcoRepo>; exhausted: boolean }> {
  const budget = new Budget();
  const infos = new Map<string, EcoRepo>();
  let done = 0;
  await pool(repos, 10, async (repo) => {
    let info = await cacheGet<EcoRepo>(`eco:repo:${repo}`);
    if (!info && !budget.exhausted) {
      const [meta, commits] = await Promise.all([
        budget.get<any>(`${REPOS}/repositories/${repo}`),
        budget.get<any>(`${COMMITS}/repositories/${repo}`),
      ]);
      const humans = ((commits?.committers ?? []) as any[])
        .filter((c) => c.login && !isBot(c.login))
        .sort((a, b) => b.count - a.count);
      const total = humans.reduce((s, c) => s + c.count, 0) || 1;
      const owner: string = meta?.owner ?? repo.split('/')[0];
      info = {
        repo,
        archived: meta?.archived,
        pushedAt: meta?.pushed_at,
        stars: meta?.stargazers_count,
        // "effective" maintainers: anyone with ≥5% of all-time commits
        humans: commits ? humans.filter((c) => c.count / total >= 0.05).length : undefined,
        logins: [owner, ...humans.map((c) => c.login as string).filter((l) => l.toLowerCase() !== owner.toLowerCase())].slice(
          0,
          TOP_COMMITTERS + 1,
        ),
      };
      if (meta || commits) void cacheSet(`eco:repo:${repo}`, info);
    }
    if (info) {
      infos.set(repo, info);
      onEach(info, ++done);
    }
  });
  return { infos, exhausted: budget.exhausted };
}

/** Profile (location) for many logins. */
export async function fetchOwnersEco(
  logins: string[],
  onEach: (e: Entity, done: number) => void,
): Promise<{ exhausted: boolean }> {
  const budget = new Budget();
  let done = 0;
  await pool(logins, 12, async (login) => {
    let e = await cacheGet<Entity>(`eco:owner:${login.toLowerCase()}`);
    if (!e && !budget.exhausted) {
      const o = await budget.get<any>(`${REPOS}/owners/${login}`);
      e = {
        login: o?.login ?? login,
        kind: o?.kind === 'organization' ? 'Organization' : 'User',
        name: o?.name ?? undefined,
        avatar: avatarFor(o?.login ?? login),
        location: o?.location ?? undefined,
      };
      if (o) void cacheSet(`eco:owner:${login.toLowerCase()}`, e);
    }
    if (e) onEach(e, ++done);
  });
  return { exhausted: budget.exhausted };
}

const ECO_MAP: Record<string, Ecosystem> = {
  npm: 'npm', pypi: 'pypi', go: 'go', maven: 'maven', cargo: 'cargo', nuget: 'nuget',
  rubygems: 'rubygems', packagist: 'composer', actions: 'actions',
};

/** Direct dependencies parsed from the repo's manifests — fallback when GitHub's SBOM is rate-limited. */
export async function fetchManifestPackages(owner: string, repo: string): Promise<Pkg[]> {
  const res = await fetch(`${REPOS}/repositories/${owner}/${repo}/manifests`);
  if (res.status === 404) throw new Error(`Couldn't find ${owner}/${repo}.`);
  if (!res.ok) throw new Error('GitHub and ecosyste.ms are both rate-limiting right now. Add a token or try again later.');
  const manifests: any[] = await res.json();
  const byId = new Map<string, Pkg>();
  for (const m of manifests) {
    const ecosystem = ECO_MAP[m.ecosystem];
    if (!ecosystem) continue;
    for (const d of m.dependencies ?? []) {
      let name: string = d.package_name ?? '';
      if (!name) continue;
      if (ecosystem === 'composer' && !name.includes('/')) continue; // php, ext-*
      if (ecosystem === 'actions') name = name.split('/').slice(0, 2).join('/');
      if (ecosystem === 'pypi') name = name.toLowerCase().replace(/[-_.]+/g, '-');
      const id = `${ecosystem}:${name}`;
      const prev = byId.get(id);
      if (prev) prev.direct ||= d.direct !== false;
      else byId.set(id, { id, ecosystem, name, version: d.requirements ?? '', direct: d.direct !== false, entities: [] });
    }
  }
  return [...byId.values()];
}
