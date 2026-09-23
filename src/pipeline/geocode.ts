// Offline, fuzzy-ish geocoder for GitHub's free-text `location` field.
import data from '../data/places.json';
import type { Place } from '../types';

type CountryRow = [cc: string, name: string, lat: number, lng: number, flag: string, aliases: string[]];
type CityRow = [name: string, cc: string, admin: string, lat: number, lng: number, popK: number];

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’'`".]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const JUNK = new Set(
  'remote|earth|planet earth|the earth|world|worldwide|global|globe|internet|the internet|online|cloud|the cloud|everywhere|anywhere|nowhere|somewhere|home|localhost|127001|::1|devnull|/dev/null|universe|the universe|mars|moon|space|cyberspace|matrix|the matrix|github|here|there|n/a|na|none|unknown|null|undefined|~|0000|milky way|solar system|third rock from the sun|terra|metaverse|web|www|europe|asia|africa|north america|south america|latin america|oceania|eu|emea|apac|middle east|scandinavia|nordics|balkans'.split(
    '|',
  ),
);

// Regions that stand in for their country (plus a representative point).
const REGIONS: [aliases: string, cc: string, lat: number, lng: number, label: string][] = [
  ['england', 'GB', 52.5, -1.5, 'England'], ['scotland', 'GB', 56.5, -4.2, 'Scotland'],
  ['wales', 'GB', 52.3, -3.7, 'Wales'], ['northern ireland', 'GB', 54.6, -6.7, 'Northern Ireland'],
  ['uk|u k|great britain|britain', 'GB', 54, -2.5, 'United Kingdom'],
  ['usa|us|u s|u s a|america|united states of america|estados unidos|etats-unis', 'US', 39.8, -98.6, 'United States'],
  ['holland|the netherlands|nederland', 'NL', 52.2, 5.3, 'Netherlands'],
  ['korea|south korea|republic of korea|한국|대한민국', 'KR', 36.5, 127.9, 'South Korea'],
  ['russia|россия|russian federation', 'RU', 55.75, 37.62, 'Russia'],
  ['czechia|czech republic|cesko', 'CZ', 49.8, 15.5, 'Czechia'],
  ['turkey|turkiye', 'TR', 39, 35, 'Türkiye'], ['vietnam|viet nam', 'VN', 16, 106, 'Vietnam'],
  ['prc|mainland china|中国|中国大陆|china mainland', 'CN', 35, 105, 'China'],
  ['taiwan|台灣|台湾|roc', 'TW', 23.7, 121, 'Taiwan'], ['日本|nippon', 'JP', 36, 138, 'Japan'],
  ['uae|emirates', 'AE', 24, 54, 'United Arab Emirates'], ['deutschland', 'DE', 51, 9, 'Germany'],
  ['brasil', 'BR', -10, -55, 'Brazil'], ['espana', 'ES', 40, -4, 'Spain'], ['italia', 'IT', 42.8, 12.8, 'Italy'],
  ['polska', 'PL', 52, 20, 'Poland'], ['schweiz|suisse|svizzera', 'CH', 47, 8, 'Switzerland'],
  ['osterreich', 'AT', 47.3, 13.3, 'Austria'], ['sverige', 'SE', 62, 15, 'Sweden'],
  ['norge', 'NO', 62, 10, 'Norway'], ['danmark', 'DK', 56, 10, 'Denmark'], ['suomi', 'FI', 64, 26, 'Finland'],
  ['україна|ukraina', 'UA', 49, 32, 'Ukraine'], ['bharat|भारत', 'IN', 22, 79, 'India'],
  // US states
  ['california', 'US', 36.8, -119.4, 'California'], ['texas', 'US', 31, -100, 'Texas'],
  ['washington state|wa state', 'US', 47.4, -120.7, 'Washington'], ['oregon', 'US', 44, -120.5, 'Oregon'],
  ['new york state', 'US', 43, -75, 'New York'], ['massachusetts', 'US', 42.4, -71.4, 'Massachusetts'],
  ['colorado', 'US', 39, -105.5, 'Colorado'], ['florida', 'US', 28, -81.7, 'Florida'],
  ['illinois', 'US', 40, -89.2, 'Illinois'], ['north carolina', 'US', 35.6, -79.4, 'North Carolina'],
  ['virginia', 'US', 37.5, -78.8, 'Virginia'], ['georgia usa', 'US', 32.7, -83.4, 'Georgia'],
  ['utah', 'US', 39.3, -111.7, 'Utah'], ['arizona', 'US', 34.3, -111.7, 'Arizona'],
  ['michigan', 'US', 44.3, -85.4, 'Michigan'], ['pennsylvania', 'US', 40.9, -77.8, 'Pennsylvania'],
  ['ohio', 'US', 40.3, -82.8, 'Ohio'], ['minnesota', 'US', 46.3, -94.3, 'Minnesota'],
  ['new jersey', 'US', 40.1, -74.7, 'New Jersey'], ['maryland', 'US', 39, -76.8, 'Maryland'],
  ['wisconsin', 'US', 44.6, -89.9, 'Wisconsin'], ['tennessee', 'US', 35.9, -86.4, 'Tennessee'],
  // elsewhere
  ['bay area|sf bay area|san francisco bay area|silicon valley', 'US', 37.55, -122.1, 'SF Bay Area'],
  ['ontario', 'CA', 44, -79.5, 'Ontario'], ['quebec', 'CA', 46.8, -71.2, 'Québec'],
  ['british columbia', 'CA', 49.3, -123, 'British Columbia'], ['alberta', 'CA', 51, -114, 'Alberta'],
  ['karnataka', 'IN', 12.97, 77.59, 'Karnataka'], ['maharashtra', 'IN', 19, 74, 'Maharashtra'],
  ['tamil nadu', 'IN', 11, 78.6, 'Tamil Nadu'], ['kerala', 'IN', 10.5, 76.3, 'Kerala'],
  ['telangana', 'IN', 17.4, 78.5, 'Telangana'], ['bavaria|bayern', 'DE', 48.9, 11.4, 'Bavaria'],
  ['nsw|new south wales', 'AU', -33.9, 151, 'New South Wales'], ['victoria australia', 'AU', -37.8, 145, 'Victoria'],
];

const CITY_ALIASES: Record<string, string> = {
  sf: 'san francisco', nyc: 'new york city', 'new york': 'new york city', 'new york ny': 'new york city',
  manhattan: 'new york city', la: 'los angeles', dc: 'washington dc', 'washington dc': 'washington dc',
  'washington d c': 'washington dc', munchen: 'munich', cologne: 'koln', wien: 'vienna', praha: 'prague',
  roma: 'rome', milano: 'milan', lisboa: 'lisbon', warszawa: 'warsaw', moskva: 'moscow', москва: 'moscow',
  'st petersburg': 'saint petersburg', spb: 'saint petersburg', 'sankt-peterburg': 'saint petersburg',
  kiev: 'kyiv', київ: 'kyiv', киев: 'kyiv', bangalore: 'bengaluru', bombay: 'mumbai', calcutta: 'kolkata',
  madras: 'chennai', gurugram: 'gurgaon', 北京: 'beijing', 上海: 'shanghai', 深圳: 'shenzhen', 杭州: 'hangzhou',
  广州: 'guangzhou', 成都: 'chengdu', 南京: 'nanjing', 武汉: 'wuhan', 西安: "xi'an", 东京: 'tokyo', 東京: 'tokyo',
  서울: 'seoul', 台北: 'taipei', 臺北: 'taipei', 香港: 'hong kong', hk: 'hong kong', montreal: 'montreal',
  zurich: 'zurich', geneve: 'geneva', 'tel aviv-yafo': 'tel aviv', tlv: 'tel aviv', cdmx: 'mexico city',
  saigon: 'ho chi minh city', hcmc: 'ho chi minh city', 'frankfurt am main': 'frankfurt am main',
  frankfurt: 'frankfurt am main', ams: 'amsterdam', ber: 'berlin', sg: 'singapore', 'st louis': 'st louis',
};

const US_STATES = new Set(
  'al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc'.split(
    ' ',
  ),
);

interface Index {
  countries: Map<string, CountryRow>; // cc → row
  countryAlias: Map<string, string>; // alias → cc
  regions: Map<string, (typeof REGIONS)[number]>;
  cities: Map<string, CityRow[]>;
}

let index: Index | null = null;
function getIndex(): Index {
  if (index) return index;
  const countries = new Map<string, CountryRow>();
  const countryAlias = new Map<string, string>();
  for (const row of (data as any).countries as CountryRow[]) {
    countries.set(row[0], row);
    countryAlias.set(norm(row[1]), row[0]);
    for (const a of row[5]) {
      const n = norm(a);
      if (n.length > 2 && !countryAlias.has(n)) countryAlias.set(n, row[0]);
    }
  }
  const regions = new Map<string, (typeof REGIONS)[number]>();
  for (const r of REGIONS) for (const a of r[0].split('|')) regions.set(norm(a), r);
  const cities = new Map<string, CityRow[]>();
  for (const row of (data as any).cities as CityRow[]) {
    const k = norm(row[0]).replace(/,/g, '');
    const list = cities.get(k) ?? [];
    list.push(row);
    cities.set(k, list);
  }
  index = { countries, countryAlias, regions, cities };
  return index;
}

const FLAG_RE = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/u;
const flagToCc = (a: string, b: string) =>
  String.fromCharCode(a.codePointAt(0)! - 0x1f1e6 + 65, b.codePointAt(0)! - 0x1f1e6 + 65);

function countryPlace(ix: Index, cc: string): Place | null {
  const c = ix.countries.get(cc);
  if (!c) return null;
  return { id: `k:${cc}`, label: c[1], cc, country: c[1], flag: c[4], lat: c[2], lng: c[3], precision: 'country' };
}

function cityPlace(ix: Index, row: CityRow): Place {
  const c = ix.countries.get(row[1]);
  const country = c?.[1] ?? row[1];
  return {
    id: `c:${row[0]}|${row[1]}|${row[2]}`,
    label: `${row[0]}, ${country}`,
    cc: row[1],
    country,
    flag: c?.[4] ?? '',
    lat: row[3],
    lng: row[4],
    precision: 'city',
  };
}

function regionPlace(ix: Index, r: (typeof REGIONS)[number]): Place {
  const c = ix.countries.get(r[1]);
  const country = c?.[1] ?? r[1];
  const same = r[4] === country;
  return {
    id: same ? `k:${r[1]}` : `r:${r[4]}|${r[1]}`,
    label: same ? country : `${r[4]}, ${country}`,
    cc: r[1],
    country,
    flag: c?.[4] ?? '',
    lat: same && c ? c[2] : r[2],
    lng: same && c ? c[3] : r[3],
    precision: same ? 'country' : 'city',
  };
}

const memo = new Map<string, Place | null>();

export function geocode(raw?: string | null): Place | null {
  if (!raw) return null;
  if (memo.has(raw)) return memo.get(raw)!;
  const out = geocodeUncached(raw);
  memo.set(raw, out);
  return out;
}

function geocodeUncached(raw: string): Place | null {
  const ix = getIndex();
  const cleaned = raw
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]/gu, (m) => (FLAG_RE.test(m) ? m : ' '));
  const flag = FLAG_RE.exec(cleaned);
  const flagCc = flag ? flagToCc(flag[1], flag[2]) : undefined;
  const s = norm(cleaned.replace(new RegExp(FLAG_RE.source, 'gu'), ' '));

  if (!s && flagCc) return countryPlace(ix, flagCc);
  if (!s || JUNK.has(s)) return flagCc ? countryPlace(ix, flagCc) : null;

  const rawTokens = cleaned
    .split(/[,;|/•·()[\]\n]| - | – | — | and | & | or /)
    .map((t) => t.replace(FLAG_RE, '').trim())
    .filter(Boolean);
  const tokens = rawTokens.map(norm).filter((t) => t && !JUNK.has(t));
  if (!tokens.length && flagCc) return countryPlace(ix, flagCc);

  const hints = new Set<string>(flagCc ? [flagCc] : []);
  let usState: string | undefined;
  let region: (typeof REGIONS)[number] | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const cc = ix.countryAlias.get(t);
    if (cc) hints.add(cc);
    const r = ix.regions.get(t);
    if (r) {
      hints.add(r[1]);
      region ??= r;
    }
    // "Portland, OR" — a 2-letter uppercase token after the first is almost always a US state.
    if (i > 0 && t.length === 2 && US_STATES.has(t) && /^[A-Z]{2}$/.test(rawTokens[i] ?? '')) {
      hints.add('US');
      usState = t.toUpperCase();
    }
  }

  const cityCands = (t: string) => ix.cities.get(norm(CITY_ALIASES[t] ?? t).replace(/,/g, '')) ?? [];

  // 1) a city whose country agrees with a hint
  for (const t of tokens) {
    const list = cityCands(t);
    if (!list.length) continue;
    const agree = list.filter((c) => hints.has(c[1]));
    if (agree.length) {
      const best = (usState && agree.find((c) => c[2] === usState)) || agree[0];
      return cityPlace(ix, best);
    }
  }
  // 2) a region or a country
  if (region) return regionPlace(ix, region);
  if (hints.size) return countryPlace(ix, [...hints][0]);
  // 3) a city alone — take the biggest namesake
  for (const t of tokens) {
    const list = cityCands(t);
    if (list.length) return cityPlace(ix, list[0]);
  }
  // 4) scan word n-grams for anything recognisable ("Software engineer in Berlin")
  const words = s.replace(/[^\p{L}\p{N} -]/gu, ' ').split(' ').filter(Boolean);
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const g = words.slice(i, i + n).join(' ');
      if (g.length < 3) continue;
      const cc = ix.countryAlias.get(g);
      if (cc) return countryPlace(ix, cc);
      const r = ix.regions.get(g);
      if (r && g.length > 3) return regionPlace(ix, r);
      const c = cityCands(g)[0];
      if (c && c[5] >= 500) return cityPlace(ix, c);
    }
  }
  return null;
}
