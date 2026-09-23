import countriesTable from './data/countries.json';
import type { Pkg, Place, Result } from './types';

type CountryInfo = { cc: string; name: string; flag: string; ccn3: string; lat: number; lng: number };
export const COUNTRIES = new Map<string, CountryInfo>(
  (countriesTable as [string, string, string, string, number, number][]).map(([cc, name, flag, ccn3, lat, lng]) => [
    cc,
    { cc, name, flag, ccn3, lat, lng },
  ]),
);
export const CCN3_TO_CC = new Map([...COUNTRIES.values()].map((c) => [c.ccn3, c.cc]));

export interface PlaceAgg {
  place: Place;
  weight: number; // share-of-packages units
  pkgs: Set<string>;
  people: Set<string>;
}

export interface CountryAgg {
  cc: string;
  name: string;
  flag: string;
  weight: number;
  share: number; // of located weight
  pkgs: number;
  people: number;
}

export interface RiskItem {
  pkg: Pkg;
  detail: string;
}

export interface Model {
  result: Result;
  places: PlaceAgg[];
  countries: CountryAgg[];
  hq?: Place;
  stats: {
    packages: number;
    sbomTotal: number;
    people: number;
    orgs: number;
    countries: number;
    locatedPct: number;
    unknownPct: number;
  };
  risk: {
    single: RiskItem[];
    abandoned: RiskItem[];
    lowScore: RiskItem[];
    topCountryShare: number;
    countriesFor50: number;
    hasPeopleData: boolean;
  };
}

const TWO_YEARS = 2 * 365 * 24 * 3600 * 1000;

export function buildModel(result: Result, hqOverride?: string): Model {
  const places = new Map<string, PlaceAgg>();
  const countries = new Map<string, CountryAgg>();
  const people = new Set<string>();
  const orgs = new Set<string>();
  let unknown = 0;

  for (const p of result.packages) {
    const located = p.entities.filter((k) => result.entities[k]?.placeId);
    for (const k of p.entities) {
      const e = result.entities[k];
      if (!e) continue;
      (e.kind === 'User' ? people : orgs).add(k);
    }
    if (!located.length) {
      unknown++;
      continue;
    }
    const w = 1 / located.length;
    for (const k of located) {
      const place = result.places[result.entities[k].placeId!];
      if (!place) continue;
      const agg = places.get(place.id) ?? { place, weight: 0, pkgs: new Set(), people: new Set() };
      agg.weight += w;
      agg.pkgs.add(p.id);
      agg.people.add(k);
      places.set(place.id, agg);

      const c = countries.get(place.cc) ?? {
        cc: place.cc,
        name: place.country,
        flag: place.flag,
        weight: 0,
        share: 0,
        pkgs: 0,
        people: 0,
      };
      c.weight += w;
      countries.set(place.cc, c);
    }
  }

  // per-country package and people counts (distinct)
  const cPkgs = new Map<string, Set<string>>();
  const cPeople = new Map<string, Set<string>>();
  for (const agg of places.values()) {
    const cc = agg.place.cc;
    if (!cPkgs.has(cc)) cPkgs.set(cc, new Set());
    if (!cPeople.has(cc)) cPeople.set(cc, new Set());
    agg.pkgs.forEach((x) => cPkgs.get(cc)!.add(x));
    agg.people.forEach((x) => cPeople.get(cc)!.add(x));
  }
  const totalW = [...countries.values()].reduce((s, c) => s + c.weight, 0) || 1;
  for (const c of countries.values()) {
    c.share = c.weight / totalW;
    c.pkgs = cPkgs.get(c.cc)?.size ?? 0;
    c.people = cPeople.get(c.cc)?.size ?? 0;
  }
  const countryList = [...countries.values()].sort((a, b) => b.weight - a.weight);
  const placeList = [...places.values()].sort((a, b) => b.weight - a.weight);

  let acc = 0;
  let countriesFor50 = 0;
  for (const c of countryList) {
    if (acc >= 0.5) break;
    acc += c.share;
    countriesFor50++;
  }

  const hqId = hqOverride ?? result.hq?.placeId;
  const hq = (hqId && (result.places[hqId] ?? places.get(hqId)?.place)) || placeList[0]?.place;

  const now = Date.now();
  const single: RiskItem[] = [];
  const abandoned: RiskItem[] = [];
  const lowScore: RiskItem[] = [];
  for (const p of result.packages) {
    if (p.humans === 1) single.push({ pkg: p, detail: `@${result.entities[p.entities[1] ?? p.entities[0]]?.login ?? '?'}` });
    if (p.archived) abandoned.push({ pkg: p, detail: 'archived' });
    else if (p.pushedAt && now - Date.parse(p.pushedAt) > TWO_YEARS)
      abandoned.push({ pkg: p, detail: `last push ${new Date(p.pushedAt).getFullYear()}` });
    if (p.scorecard !== undefined && p.scorecard < 4) lowScore.push({ pkg: p, detail: `Scorecard ${p.scorecard.toFixed(1)}` });
  }
  lowScore.sort((a, b) => a.pkg.scorecard! - b.pkg.scorecard!);

  const n = result.packages.length || 1;
  return {
    result,
    places: placeList,
    countries: countryList,
    hq,
    stats: {
      packages: result.packages.length,
      sbomTotal: result.sbomTotal,
      people: people.size,
      orgs: orgs.size,
      countries: countries.size,
      locatedPct: Math.round(((n - unknown) / n) * 100),
      unknownPct: Math.round((unknown / n) * 100),
    },
    risk: {
      single,
      abandoned,
      lowScore,
      topCountryShare: countryList[0]?.share ?? 0,
      countriesFor50,
      hasPeopleData: result.mode !== 'anon',
    },
  };
}
