// Precomputes globes so visitors get instant results for popular repos, no token needed.
//
//   GITHUB_TOKEN=$(gh auth token) npm run build:demos                      # featured set
//   GITHUB_TOKEN=$(gh auth token) npm run build:demos -- owner/a owner/b   # specific repos
//   GITHUB_TOKEN=$(gh auth token) npm run build:demos -- --file top.txt --limit 400 --concurrency 3
//
// Existing snapshots are skipped unless --force is passed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildModel } from '../src/model';
import { mapRepo } from '../src/pipeline/index';
import type { Result } from '../src/types';
import { pool } from '../src/pipeline/util';

const FEATURED = [
  'vercel/next.js', 'react/react', 'django/django', 'kubernetes/kubernetes', 'rust-lang/cargo', 'expressjs/express',
  'fastapi/fastapi', 'rails/rails', 'denoland/deno', 'sveltejs/svelte',
];
const MIN_PACKAGES = 10;
const MIN_PEOPLE = 15;

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('Set GITHUB_TOKEN (e.g. GITHUB_TOKEN=$(gh auth token)).');
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : undefined;
};
const force = argv.includes('--force') && !!argv.splice(argv.indexOf('--force'), 1);
const file = flag('--file');
const limit = Number(flag('--limit') ?? Infinity);
const concurrency = Number(flag('--concurrency') ?? 1);
let repos = argv.length ? argv : FEATURED;
if (file) repos = readFileSync(file, 'utf8').split('\n').map((l) => l.split('\t')[0].trim()).filter(Boolean);
repos = repos.slice(0, limit);

const dir = new URL('../public/demos/', import.meta.url);
mkdirSync(dir, { recursive: true });
const indexFile = new URL('index.json', dir);
type Entry = { repo: string; file: string; packages: number; people: number; countries: number; top: string; featured?: boolean };
const index: Entry[] = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : [];
const slugOf = (repo: string) => repo.replace('/', '__');
const saveIndex = () => {
  for (const e of index) {
    if (FEATURED.some((f) => f.toLowerCase() === e.repo.toLowerCase())) e.featured = true;
    else delete e.featured;
  }
  index.sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || b.people - a.people);
  writeFileSync(indexFile, JSON.stringify(index));
};

/** Drop fields the UI can rebuild (avatars from login) or never shows. */
function slim(r: Result): Result {
  const entities: Result['entities'] = {};
  for (const [k, e] of Object.entries(r.entities)) entities[k] = { login: e.login, kind: e.kind, placeId: e.placeId };
  return {
    ...r,
    entities,
    packages: r.packages.map(({ version: _v, ...p }) => ({ ...p, version: '' })),
  };
}

let done = 0;
await pool(repos, concurrency, async (repo) => {
  const n = ++done;
  const tag = `[${n}/${repos.length}] ${repo}`;
  if (!force && existsSync(new URL(`${slugOf(repo)}.json`, dir))) return console.log(`${tag} · skip (exists)`);
  const t0 = Date.now();
  try {
    const result = await mapRepo(repo, { token });
    const m = buildModel(result);
    if (m.stats.packages < MIN_PACKAGES || m.stats.people < MIN_PEOPLE)
      return console.log(`${tag} · skip (only ${m.stats.packages} pkgs / ${m.stats.people} people)`);
    const slug = slugOf(result.repo);
    writeFileSync(new URL(`${slug}.json`, dir), JSON.stringify(slim(result)));
    const entry: Entry = {
      repo: result.repo,
      file: `demos/${slug}.json`,
      packages: m.stats.packages,
      people: m.stats.people,
      countries: m.stats.countries,
      top: m.countries.slice(0, 3).map((c) => c.flag).join(''),
      ...(FEATURED.some((f) => f.toLowerCase() === result.repo.toLowerCase()) ? { featured: true } : {}),
    };
    const i = index.findIndex((e) => e.repo.toLowerCase() === result.repo.toLowerCase());
    if (i >= 0) index[i] = entry;
    else index.push(entry);
    saveIndex();
    console.log(`${tag} · ${m.stats.packages} pkgs · ${m.stats.people} people · ${m.stats.countries} countries · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (e) {
    console.log(`${tag} · FAILED: ${(e as Error).message}`);
  }
});
saveIndex();
console.log(`index: ${index.length} repos`);
