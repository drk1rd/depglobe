import type { Model } from '../model';
import type { Place } from '../types';

export interface Insight {
  emoji: string;
  title: string;
  body: string;
  big?: string;
  kind: 'geo' | 'people' | 'risk' | 'fun';
}

const n = (x: number) => Math.round(x).toLocaleString('en-US');

// ISO alpha-2 → continent (AN = Antarctica, excluded from the "inhabited" count).
const CONTINENT_CODES: Record<string, string> = {
  AF: 'DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW IO',
  AS: 'AF AM AZ BH BD BT BN KH CN CX CC CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE',
  EU: 'AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB',
  NA: 'AI AG AW BS BB BZ BM BQ CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VG VI UM',
  SA: 'AR BO BR CL CO EC FK GF GY PY PE SR UY VE',
  OC: 'AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF',
  AN: 'AQ BV TF GS HM',
};
const CONTINENT_NAMES: Record<string, string> = {
  AF: 'Africa', AS: 'Asia', EU: 'Europe', NA: 'North America', SA: 'South America', OC: 'Oceania', AN: 'Antarctica',
};
const CC_TO_CONTINENT = new Map<string, string>();
for (const [cont, codes] of Object.entries(CONTINENT_CODES)) for (const cc of codes.split(' ')) CC_TO_CONTINENT.set(cc, cont);

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** "Berlin, Germany" → "Berlin"; "Germany" → "Germany". */
const cityOf = (p: Place) => (p.precision === 'city' ? p.label.split(',')[0]!.trim() : p.label);

export function buildInsights(m: Model): Insight[] {
  const out: Insight[] = [];
  const r = m.result;
  const located = m.places.filter((p) => Number.isFinite(p.place.lat) && Number.isFinite(p.place.lng));
  const totalW = located.reduce((s, p) => s + p.weight, 0) || 1;
  const pkgN = m.stats.packages;

  // Hometown — top city by weight.
  const topCity = m.places.find((p) => p.place.precision === 'city');
  if (topCity) {
    const city = cityOf(topCity.place);
    out.push({
      emoji: topCity.place.flag,
      kind: 'geo',
      big: city,
      title: 'Your code has a hometown',
      body: `More of your dependencies come from ${city} than anywhere else — ${n(topCity.pkgs.size)} packages, ${n(topCity.people.size)} humans.`,
    });
  }

  // Continents.
  if (m.countries.length) {
    const conts = new Set<string>();
    for (const c of m.countries) {
      const k = CC_TO_CONTINENT.get(c.cc);
      if (k && k !== 'AN') conts.add(k);
    }
    const missing = ['AF', 'AS', 'EU', 'NA', 'SA', 'OC'].filter((k) => !conts.has(k)).map((k) => CONTINENT_NAMES[k]);
    if (conts.size === 6) {
      out.push({
        emoji: '🌍',
        kind: 'geo',
        big: 'All 6',
        title: 'Every inhabited continent',
        body: 'Your dependency tree touches all six inhabited continents. Only Antarctica is left out — for now.',
      });
    } else if (conts.size >= 2) {
      out.push({
        emoji: '🌍',
        kind: 'geo',
        big: `${conts.size} of 6`,
        title: 'Continents reached',
        body: `Your code reaches ${conts.size} of the 6 inhabited continents. Still missing: ${missing.join(', ')}.`,
      });
    }
  }

  // Half the world.
  if (m.risk.countriesFor50 > 0 && m.countries.length > 1) {
    const k = m.risk.countriesFor50;
    const names = m.countries.slice(0, Math.min(k, 3)).map((c) => `${c.flag} ${c.name}`);
    out.push({
      emoji: '🌗',
      kind: 'geo',
      big: k === 1 ? '1 country' : `${k} countries`,
      title: k === 1 ? 'One country holds half' : 'Half the world, few flags',
      body:
        k === 1
          ? `${names[0]} alone accounts for half of your located supply chain. That's concentration, not a compliment.`
          : `Just ${k} countries cover half of your located supply chain, led by ${names.join(', ')}${k > 3 ? '…' : ''}.`,
    });
  }

  // Furthest maintainer.
  if (m.hq && located.length > 1) {
    let far = located[0]!;
    let farKm = -1;
    for (const p of located) {
      const km = haversineKm(m.hq, p.place);
      if (km > farKm) {
        farKm = km;
        far = p;
      }
    }
    if (farKm > 500) {
      const logins = [...far.people];
      const login = logins.find((k) => r.entities[k]?.kind === 'User') ?? logins[0];
      const who = login ? `@${login}` : 'Someone';
      out.push({
        emoji: '🛰',
        kind: 'geo',
        big: `${n(farKm)} km`,
        title: 'Your farthest maintainer',
        body: `${who} in ${far.place.flag} ${cityOf(far.place)} sits ${n(farKm)} km from HQ (${cityOf(m.hq)}) and still ships to you.`,
      });
    }
  }

  // Round the clock — distinct UTC offsets approximated from longitude.
  if (located.length) {
    const zones = new Set(located.map((p) => Math.round(p.place.lng / 15)));
    if (zones.size >= 8) {
      out.push({
        emoji: '🕰',
        kind: 'fun',
        big: `${zones.size} time zones`,
        title: 'Round the clock',
        body: `Your dependencies span ${zones.size} time zones — someone, somewhere, is awake maintaining your code right now.`,
      });
    }
  }

  // Bus stop — the one login that shows up in the most packages.
  if (m.risk.hasPeopleData && r.packages.length) {
    const count = new Map<string, number>();
    for (const p of r.packages)
      for (const k of new Set(p.entities)) if (r.entities[k]?.kind === 'User') count.set(k, (count.get(k) ?? 0) + 1);
    let best: [string, number] | undefined;
    for (const kv of count) if (!best || kv[1] > best[1]) best = kv;
    if (best && best[1] >= 3) {
      const e = r.entities[best[0]];
      const pl = e?.placeId ? r.places[e.placeId] : undefined;
      out.push({
        emoji: '🚌',
        kind: 'people',
        big: `${n(best[1])} packages`,
        title: 'Your MVP',
        body: `@${best[0]}${pl ? ` (${pl.flag} ${cityOf(pl)})` : ''} has a hand in ${n(best[1])} of the packages you depend on. Buy them a coffee.`,
      });
    }
  }

  // Lone wolves — single-maintainer packages.
  if (m.risk.hasPeopleData && m.risk.single.length > 0 && pkgN > 0) {
    const s = m.risk.single.length;
    const ratio = pkgN / s;
    const big = ratio >= 2 ? `1 in ${n(ratio)}` : `${Math.round((s / pkgN) * 100)}%`;
    out.push({
      emoji: '🐺',
      kind: 'risk',
      big,
      title: 'Lone wolves',
      body: `${big} of your packages rests on a single pair of hands — ${n(s)} in total. Be nice to them.`,
    });
  }

  // Ghost town — abandoned or archived.
  if (m.risk.hasPeopleData && m.risk.abandoned.length > 0) {
    const a = m.risk.abandoned.length;
    const archived = m.risk.abandoned.filter((x) => x.pkg.archived).length;
    out.push({
      emoji: '🏚',
      kind: 'risk',
      big: n(a),
      title: 'Ghost town',
      body: `${n(a)} ${a === 1 ? 'package hasn’t' : 'packages haven’t'} seen a push in two years${archived ? ` (${n(archived)} archived outright)` : ''}. Still running in production, though.`,
    });
  }

  // The long tail — countries with exactly one human.
  {
    const solo = m.countries.filter((c) => c.people === 1);
    if (solo.length >= 2) {
      const flags = solo.slice(0, 8).map((c) => c.flag).join(' ');
      out.push({
        emoji: '🧵',
        kind: 'people',
        big: `${n(solo.length)} countries`,
        title: 'The long tail',
        body: `${n(solo.length)} countries contribute exactly one human to your stack. ${flags}${solo.length > 8 ? ' …' : ''} Every one of them counts.`,
      });
    }
  }

  // Southern hemisphere share.
  if (located.length) {
    const south = located.filter((p) => p.place.lat < 0).reduce((s, p) => s + p.weight, 0) / totalW;
    const pct = Math.round(south * 100);
    if (pct > 3) {
      out.push({
        emoji: '🐧',
        kind: 'fun',
        big: `${pct}%`,
        title: 'Below the equator',
        body: `${pct}% of your located supply chain lives in the southern hemisphere. Their winter is your summer; your bugs are theirs year-round.`,
      });
    }
  }

  // Packages per human.
  if (m.stats.people > 0 && pkgN > 0) {
    const ratio = pkgN / m.stats.people;
    if (ratio >= 1.5) {
      out.push({
        emoji: '🧑‍🔧',
        kind: 'people',
        big: `${ratio.toFixed(1)}×`,
        title: 'Packages per human',
        body: `${n(pkgN)} packages, ${n(m.stats.people)} humans — that’s ${ratio.toFixed(1)} packages for every person keeping your stack alive.`,
      });
    } else {
      const inv = m.stats.people / pkgN;
      out.push({
        emoji: '🤝',
        kind: 'people',
        big: `${inv.toFixed(1)} humans`,
        title: 'Humans per package',
        body: `${n(m.stats.people)} humans behind ${n(pkgN)} packages — about ${inv.toFixed(1)} people per package. Many hands, light work.`,
      });
    }
  }

  return out.slice(0, 10);
}
