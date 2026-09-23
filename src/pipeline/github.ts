import type { Entity } from '../types';
import { cacheGet, cacheSet } from './cache';
import { chunk, fetchJson, HttpError, isBot, pool } from './util';

export const ghHeaders = (token?: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

export interface RepoInfo {
  repo: string;
  archived?: boolean;
  pushedAt?: string;
  stars?: number;
  humans?: number;
  entities: Entity[]; // owner first, then top committers
}

const TOP_COMMITTERS = 5;
const BATCH = 20;

const FRAGMENT = `fragment R on Repository {
  isArchived pushedAt stargazerCount
  owner { __typename login avatarUrl
    ... on User { name location }
    ... on Organization { name location } }
  defaultBranchRef { target { ... on Commit { history(first: 60) { nodes {
    author { user { login name location avatarUrl } } } } } } }
}`;

function toInfo(repo: string, r: any): RepoInfo | null {
  if (!r) return null;
  const owner: Entity = {
    login: r.owner.login,
    kind: r.owner.__typename === 'Organization' ? 'Organization' : 'User',
    name: r.owner.name ?? undefined,
    avatar: r.owner.avatarUrl,
    location: r.owner.location ?? undefined,
  };
  const counts = new Map<string, { n: number; e: Entity }>();
  for (const node of r.defaultBranchRef?.target?.history?.nodes ?? []) {
    const u = node?.author?.user;
    if (!u?.login || isBot(u.login)) continue;
    const c = counts.get(u.login) ?? {
      n: 0,
      e: { login: u.login, kind: 'User', name: u.name ?? undefined, avatar: u.avatarUrl, location: u.location ?? undefined },
    };
    c.n++;
    counts.set(u.login, c);
  }
  const committers = [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.e);
  const entities = [owner, ...committers.filter((c) => c.login !== owner.login).slice(0, TOP_COMMITTERS)];
  return {
    repo,
    archived: r.isArchived,
    pushedAt: r.pushedAt,
    stars: r.stargazerCount,
    humans: counts.size,
    entities,
  };
}

async function graphqlBatch(repos: string[], token: string): Promise<Map<string, RepoInfo | null>> {
  const fields = repos
    .map((full, i) => {
      const [owner, name] = full.split('/');
      return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ...R }`;
    })
    .join('\n');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `query {\n${fields}\n}\n${FRAGMENT}` }),
  });
  if (res.status === 401) throw new HttpError(401, 'That GitHub token was rejected.');
  if (!res.ok) throw new HttpError(res.status, `GitHub GraphQL ${res.status}`);
  const body: any = await res.json();
  if (!body.data) throw new HttpError(500, body.errors?.[0]?.message ?? 'GraphQL error');
  const out = new Map<string, RepoInfo | null>();
  repos.forEach((repo, i) => out.set(repo, toInfo(repo, body.data[`r${i}`])));
  return out;
}

/** Token mode: owner + top committers for many repos, 20 per GraphQL query. */
export async function fetchReposGraphQL(
  repos: string[],
  token: string,
  onBatch: (infos: RepoInfo[], done: number) => void,
): Promise<Map<string, RepoInfo>> {
  const out = new Map<string, RepoInfo>();
  const todo: string[] = [];
  for (const r of repos) {
    const hit = await cacheGet<RepoInfo>(`gh:repo:${r}`);
    if (hit) out.set(r, hit);
    else todo.push(r);
  }
  let done = out.size;
  if (out.size) onBatch([...out.values()], done);

  const run = async (batch: string[]): Promise<void> => {
    let res: Map<string, RepoInfo | null>;
    try {
      res = await graphqlBatch(batch, token);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw e;
      if (batch.length <= 2) return; // give up on these
      const half = Math.ceil(batch.length / 2);
      await run(batch.slice(0, half));
      await run(batch.slice(half));
      return;
    }
    const infos: RepoInfo[] = [];
    for (const [repo, info] of res) {
      if (!info) continue;
      out.set(repo, info);
      infos.push(info);
      void cacheSet(`gh:repo:${repo}`, info);
    }
    done += batch.length;
    onBatch(infos, done);
  };

  const errors: unknown[] = [];
  await pool(chunk(todo, BATCH), 3, (b) => run(b).catch((e) => void errors.push(e)));
  if (errors.length && !out.size) throw errors[0];
  return out;
}

/** Anonymous mode: just the owners' profiles, within a small request budget. */
export async function fetchOwnersREST(
  logins: string[],
  budget: number,
  onEach: (e: Entity, done: number) => void,
): Promise<{ entities: Map<string, Entity>; exhausted: boolean }> {
  const entities = new Map<string, Entity>();
  let spent = 0;
  let exhausted = false;
  let done = 0;
  await pool(logins, 4, async (login) => {
    let hit = await cacheGet<Entity>(`gh:user:${login}`);
    if (!hit && spent < budget && !exhausted) {
      spent++;
      const res = await fetch(`https://api.github.com/users/${login}`, { headers: ghHeaders() });
      if (Number(res.headers.get('x-ratelimit-remaining') ?? '99') <= 2) exhausted = true;
      if (res.status === 403 || res.status === 429) exhausted = true;
      else if (res.ok) {
        hit = toEntity(await res.json());
        void cacheSet(`gh:user:${login}`, hit);
      }
    }
    if (hit) {
      entities.set(login, hit);
      onEach(hit, ++done);
    }
  });
  return { entities, exhausted: exhausted || spent >= budget };
}

export async function fetchUserREST(login: string, token?: string): Promise<Entity | undefined> {
  try {
    return toEntity(await fetchJson(`https://api.github.com/users/${login}`, { headers: ghHeaders(token) }));
  } catch {
    return undefined;
  }
}

const toEntity = (u: any): Entity => ({
  login: u.login,
  kind: u.type === 'Organization' ? 'Organization' : 'User',
  name: u.name ?? undefined,
  avatar: u.avatar_url,
  location: u.location ?? undefined,
});
