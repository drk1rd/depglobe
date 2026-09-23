# depglobe

> Paste any GitHub repo URL and see **where in the world your code comes from.**

A spinning 3D globe of every human and org behind a repo's dependencies — any language — with a risk layer for companies and a share card built to be posted.

![depglobe](public/og.jpg)

## How it works

```
repo URL
  → GitHub SBOM API            every dependency, every ecosystem, one call
  → dedupe, cap 400            direct deps first (manifest ranges ≈ direct)
  → deps.dev                   package → GitHub source repo + OpenSSF Scorecard
  → GitHub GraphQL (token)     owner + top 5 recent committers + archived/pushedAt, 20 repos per query
    GitHub REST   (no token)   repo owners only, within the 60 req/hr budget
  → offline geocoder           ~9k cities + 250 countries + aliases, flags, US states, CJK names
  → globe.gl                   dot-hex countries lit by share, pillars per place, arcs to HQ
```

Everything runs in the browser. The token (optional) is kept in `sessionStorage` (or `localStorage` if you tick *remember*) and is only sent to `api.github.com`. Results are cached in IndexedDB for 7 days.

## Develop

```bash
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run build:places` | Regenerate `src/data/places.json` + `countries.json` from GeoNames / world-countries |
| `npm run build:demos` | Precompute demo globes into `public/demos/` (needs `GITHUB_TOKEN`) |

Regenerate or add demos:

```bash
GITHUB_TOKEN=$(gh auth token) npm run build:demos -- facebook/react pallets/flask
```

Demo repos load instantly with no token and replay the scan animation. `?repo=owner/name` deep-links to any repo; add `&live=1` to force a live scan of a demo repo.

## Risk panel

- 🌐 **Jurisdiction concentration** — share of located dependency weight per country, and how many countries cover half of it
- 🧍 **Single maintainer** — one human author across the last 60 commits
- 🪦 **Abandoned** — archived, or no push in 2+ years
- 🛡 **Low OpenSSF Scorecard** — below 4/10

Flags describe **packages, never people**. Location is self-reported free text, and where someone lives says nothing about trustworthiness — this is about concentration and sovereignty.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml` (enable *Settings → Pages → Source: GitHub Actions* once). The build uses relative paths, so it also works on Cloudflare Pages or any static host.

## Data & credits

GitHub dependency-graph SBOM + GraphQL APIs · [deps.dev](https://deps.dev) (Open Source Insights) · [OpenSSF Scorecard](https://scorecard.dev) · [GeoNames](https://www.geonames.org) via `all-the-cities` (CC BY 4.0) · `world-countries` · Natural Earth via `world-atlas` · [globe.gl](https://globe.gl)

## Roadmap

- **v2 — Metro view:** a second tab that renders the repo's *internal* architecture as a subway map (modules → stations, import chains → lines). Globe = where your code comes from; Metro = how it's wired.
- `npx depglobe <url>` CLI reusing `src/pipeline`
- Per-repo OG images via a small edge function
