// Smoke-test the pipeline against arbitrary repos: GITHUB_TOKEN=$(gh auth token) npx tsx scripts/smoke.ts owner/repo ...
import { mapRepo } from '../src/pipeline/index';
import { buildModel } from '../src/model';

const token = process.env.GITHUB_TOKEN || undefined;
for (const repo of process.argv.slice(2)) {
  const t0 = Date.now();
  try {
    const r = await mapRepo(repo, { token });
    const m = buildModel(r);
    const ecos = [...new Set(r.packages.map((p) => p.ecosystem))].join(',');
    const resolved = r.packages.filter((p) => p.repo).length;
    console.log(
      `✓ ${repo.padEnd(28)} ${String(m.stats.packages).padStart(3)}/${r.sbomTotal} pkgs [${ecos}] · ${resolved} → repo · ${m.stats.people} people · ${m.stats.countries} countries · ${m.stats.unknownPct}% unknown · HQ ${m.hq?.label ?? '—'} · risk ${m.risk.single.length}/${m.risk.abandoned.length}/${m.risk.lowScore.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
  } catch (e) {
    console.log(`✗ ${repo.padEnd(28)} ${(e as Error).message} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
