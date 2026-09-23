// Generates src/data/places.json — the offline gazetteer used by the geocoder.
// Sources: GeoNames via `all-the-cities` (CC-BY) and `world-countries` (ODbL).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cities: any[] = require('all-the-cities');
const countries: any[] = require('world-countries');

const MIN_POP = 50_000;

// Small towns that punch far above their population in open source.
const TECH_TOWNS: [string, string, string][] = [
  ['Mountain View', 'US', 'CA'], ['Palo Alto', 'US', 'CA'], ['Menlo Park', 'US', 'CA'],
  ['Cupertino', 'US', 'CA'], ['Redmond', 'US', 'WA'], ['Kirkland', 'US', 'WA'],
  ['Boulder', 'US', 'CO'], ['Cambridge', 'US', 'MA'], ['Somerville', 'US', 'MA'],
  ['Los Gatos', 'US', 'CA'], ['Redwood City', 'US', 'CA'], ['Santa Cruz', 'US', 'CA'],
  ['Zug', 'CH', 'ZG'], ['Lausanne', 'CH', 'VD'], ['Delft', 'NL', '11'], ['Waterloo', 'CA', '08'],
  ['Ithaca', 'US', 'NY'], ['Princeton', 'US', 'NJ'], ['Chapel Hill', 'US', 'NC'],
  ['Durham', 'US', 'NC'], ['Ann Arbor', 'US', 'MI'], ['Oxford', 'GB', 'ENG'], ['Cambridge', 'GB', 'ENG'],
  ['Tartu', 'EE', '0079'], ['Espoo', 'FI', '18'], ['Karlsruhe', 'DE', '01'], ['Darmstadt', 'DE', '05'],
  ['Heidelberg', 'DE', '01'], ['Tübingen', 'DE', '01'], ['Leuven', 'BE', 'VLG'], ['Lund', 'SE', '27'],
  ['Uppsala', 'SE', '21'], ['Trondheim', 'NO', '50'], ['Aarhus', 'DK', '82'], ['Brno', 'CZ', '78'],
  ['Kraków', 'PL', '77'], ['Wrocław', 'PL', '72'], ['Cluj-Napoca', 'RO', '13'], ['Lviv', 'UA', '15'],
  ['Kharkiv', 'UA', '07'], ['Novosibirsk', 'RU', '53'], ['Hsinchu', 'TW', '04'], ['Tsukuba', 'JP', '08'],
  ['Pune', 'IN', '16'], ['Hyderabad', 'IN', '40'], ['Noida', 'IN', '36'], ['Gurgaon', 'IN', '10'],
  ['Chennai', 'IN', '25'], ['Kochi', 'IN', '13'], ['Thiruvananthapuram', 'IN', '13'],
];

const round = (n: number) => Math.round(n * 100) / 100;

type Row = [name: string, cc: string, admin: string, lat: number, lng: number, popK: number];
const out: Row[] = [];
const seen = new Set<number>();
const add = (c: any) => {
  if (seen.has(c.cityId)) return;
  seen.add(c.cityId);
  const [lng, lat] = c.loc.coordinates;
  out.push([c.name, c.country, c.adminCode ?? '', round(lat), round(lng), Math.round(c.population / 1000)]);
};

for (const c of cities) if (c.population >= MIN_POP) add(c);
for (const [name, cc, admin] of TECH_TOWNS) {
  const hit = cities
    .filter((c) => c.name === name && c.country === cc)
    .sort((a, b) => (b.adminCode === admin ? 1 : 0) - (a.adminCode === admin ? 1 : 0) || b.population - a.population)[0];
  if (hit) add(hit);
  else console.warn('tech town not found:', name, cc);
}
out.sort((a, b) => b[5] - a[5]);

type CountryRow = [cc: string, name: string, lat: number, lng: number, flag: string, aliases: string[], ccn3: string];
const countryRows: CountryRow[] = countries
  .filter((c) => c.latlng?.length === 2)
  .map((c) => {
    const aliases = new Set<string>();
    aliases.add(c.name.common);
    aliases.add(c.name.official);
    aliases.add(c.cca3);
    for (const n of Object.values<any>(c.name.native ?? {})) {
      aliases.add(n.common);
      aliases.add(n.official);
    }
    for (const s of c.altSpellings ?? []) if (s.length > 2) aliases.add(s);
    aliases.delete(c.name.common);
    return [c.cca2, c.name.common, round(c.latlng[0]), round(c.latlng[1]), c.flag, [...aliases], c.ccn3 ?? ''];
  });

writeFileSync(
  new URL('../src/data/places.json', import.meta.url),
  JSON.stringify({ countries: countryRows, cities: out }),
);
console.log(`wrote ${countryRows.length} countries, ${out.length} cities`);

// A small table the UI loads eagerly (flags, names, numeric ids for the world-atlas shapes).
writeFileSync(
  new URL('../src/data/countries.json', import.meta.url),
  JSON.stringify(countryRows.map(([cc, name, lat, lng, flag, , ccn3]) => [cc, name, flag, ccn3, lat, lng])),
);
