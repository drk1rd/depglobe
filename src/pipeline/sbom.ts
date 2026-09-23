import type { Ecosystem, Pkg } from '../types';
import { fetchJson, HttpError } from './util';
import { ghHeaders } from './github';

const TYPE_MAP: Record<string, Ecosystem> = {
  npm: 'npm', pypi: 'pypi', golang: 'go', maven: 'maven', cargo: 'cargo',
  nuget: 'nuget', gem: 'rubygems', composer: 'composer', githubactions: 'actions', github: 'actions',
};

export function parsePurl(purl: string): { ecosystem: Ecosystem; name: string; version: string } | null {
  const m = /^pkg:([^/]+)\/([^@?#]+)(?:@([^?#]*))?/.exec(purl);
  if (!m) return null;
  const ecosystem = TYPE_MAP[m[1].toLowerCase()] ?? 'other';
  const parts = m[2].split('/').map(decodeURIComponent);
  const version = m[3] ? decodeURIComponent(m[3]) : '';
  let name: string;
  if (ecosystem === 'maven') name = parts.join(':');
  else name = parts.join('/');
  if (ecosystem === 'pypi') name = name.toLowerCase().replace(/[-_.]+/g, '-');
  return { ecosystem, name, version };
}

/** Versions straight from a manifest look like ranges; lockfile entries are exact. */
const looksLikeRange = (v: string) => !v || /[\^~><=*|xX ]|\.\*|,/.test(v);

export class SbomError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m =
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(s) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export async function fetchSbom(owner: string, repo: string, token?: string): Promise<{ packages: Pkg[] }> {
  let data: any;
  const url = `https://api.github.com/repos/${owner}/${repo}/dependency-graph/sbom`;
  try {
    // Huge monorepos often time out on GitHub's side at first; retries usually hit a warmed-up SBOM.
    for (let attempt = 0; ; attempt++) {
      try {
        data = await fetchJson(url, { headers: ghHeaders(token) });
        break;
      } catch (e) {
        if (!(e instanceof HttpError) || e.status < 500 || attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, [2000, 5000, 10000][attempt]));
      }
    }
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 404)
        throw new SbomError(404, `Couldn't find ${owner}/${repo}, or its dependency graph is turned off.`);
      if (e.status === 403 || e.status === 429)
        throw new SbomError(e.status, 'GitHub rate limit hit. Add a token to get 5,000 requests/hour.');
      if (e.status === 401) throw new SbomError(401, 'That GitHub token was rejected. Check it and try again.');
      if (e.status >= 500)
        throw new SbomError(
          e.status,
          `GitHub timed out generating the SBOM for ${owner}/${repo} (it happens on giant monorepos). Try again in a minute.`,
        );
    }
    throw e;
  }

  const self = `${owner}/${repo}`.toLowerCase();
  const byId = new Map<string, Pkg>();
  for (const p of data?.sbom?.packages ?? []) {
    const ref = (p.externalRefs ?? []).find((r: any) => r.referenceType === 'purl');
    if (!ref) continue;
    const parsed = parsePurl(ref.referenceLocator);
    if (!parsed || parsed.ecosystem === 'other') continue;
    const id = `${parsed.ecosystem}:${parsed.name}`;
    if (parsed.ecosystem === 'actions' && parsed.name.toLowerCase() === self) continue;
    const direct = looksLikeRange(parsed.version);
    const prev = byId.get(id);
    if (prev) {
      prev.direct ||= direct;
      if (!looksLikeRange(parsed.version)) prev.version = parsed.version;
      continue;
    }
    byId.set(id, { id, ...parsed, direct, entities: [] });
  }
  return { packages: [...byId.values()] };
}
