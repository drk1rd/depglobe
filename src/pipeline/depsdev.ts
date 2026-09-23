import type { Pkg } from '../types';
import { cached } from './cache';
import { fetchJson } from './util';

const API = 'https://api.deps.dev/v3';
const SYSTEM: Partial<Record<Pkg['ecosystem'], string>> = {
  npm: 'NPM', pypi: 'PYPI', go: 'GO', maven: 'MAVEN', cargo: 'CARGO', nuget: 'NUGET', rubygems: 'RUBYGEMS',
};

const enc = encodeURIComponent;
const GH = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i;

function repoFromUrl(url?: string): string | undefined {
  const m = url && GH.exec(url);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : undefined;
}

function repoFromVersion(v: any): string | undefined {
  const rel: any[] = v?.relatedProjects ?? [];
  for (const type of ['SOURCE_REPO', 'ISSUE_TRACKER']) {
    const hit = rel.find((r) => r.relationType === type && r.projectKey?.id?.startsWith('github.com/'));
    if (hit) return hit.projectKey.id.slice('github.com/'.length).toLowerCase();
  }
  for (const l of v?.links ?? []) if (l.label === 'SOURCE_REPO') return repoFromUrl(l.url);
  return undefined;
}

/** Map a package to its GitHub source repo (owner/name, lowercase). */
export async function resolveRepo(p: Pkg): Promise<string | undefined> {
  if (p.ecosystem === 'actions') return p.name.split('/').slice(0, 2).join('/').toLowerCase();
  if (p.ecosystem === 'go' && p.name.startsWith('github.com/'))
    return p.name.split('/').slice(1, 3).join('/').toLowerCase();
  if (p.ecosystem === 'composer') return p.name.toLowerCase(); // packagist vendor/name ≈ GitHub owner/repo
  const sys = SYSTEM[p.ecosystem];
  if (!sys) return undefined;

  return cached<string | null>(`dd:repo:${p.id}`, async () => {
    const base = `${API}/systems/${sys}/packages/${enc(p.name)}`;
    if (p.version && !/[\^~><=*| ,]/.test(p.version)) {
      try {
        const r = repoFromVersion(await fetchJson(`${base}/versions/${enc(p.version)}`));
        if (r) return r;
      } catch {}
    }
    const pkg: any = await fetchJson(base);
    const versions: any[] = pkg.versions ?? [];
    const def = versions.find((v) => v.isDefault) ?? versions[versions.length - 1];
    if (!def) return null;
    return repoFromVersion(await fetchJson(`${base}/versions/${enc(def.versionKey.version)}`)) ?? null;
  }).then((r) => r ?? undefined);
}

export interface ProjectInfo {
  scorecard?: number;
  stars?: number;
}

export function fetchProject(repo: string): Promise<ProjectInfo> {
  return cached(`dd:proj:${repo}`, async () => {
    try {
      const d: any = await fetchJson(`${API}/projects/${enc(`github.com/${repo}`)}`);
      return { scorecard: d.scorecard?.overallScore, stars: d.starsCount };
    } catch {
      return {};
    }
  });
}
