import Globe, { type GlobeInstance } from 'globe.gl';
import { MeshPhongMaterial } from 'three';
import { feature } from 'topojson-client';
import topo from 'world-atlas/countries-110m.json';
import { CCN3_TO_CC, type Model, type PlaceAgg } from '../model';
import type { Place } from '../types';
import { avatarFor } from '../pipeline/ecosystems';
import { avatar, esc, fmt } from './fx';

type Mode = 'hero' | 'scan' | 'result';

interface PointD { id: string; agg: PlaceAgg; lat: number; lng: number; alt: number; r: number; color: string }
interface ArcD { id: string; cc: string; startLat: number; startLng: number; endLat: number; endLng: number; stroke: number; t: number; gap: number }
interface RingD { lat: number; lng: number; color: string; until: number; speed: number; max: number }
interface PinD { id: string; lat: number; lng: number; el: HTMLElement }

// world-atlas has a few zero-area sliver polygons (e.g. in North Korea) that make h3 throw; drop them.
const solid = (poly: number[][][]) => new Set(poly[0].map((p) => p.join())).size >= 3;
const COUNTRY_FEATURES = ((feature(topo as any, (topo as any).objects.countries) as any).features as any[])
  .filter((f) => f.geometry)
  .map((f) =>
    f.geometry.type === 'MultiPolygon'
      ? { ...f, geometry: { ...f.geometry, coordinates: f.geometry.coordinates.filter(solid) } }
      : f,
  );

// cyan → violet → pink by importance, matching the brand gradient
const PILLAR = [[52, 245, 255], [138, 92, 255], [255, 62, 165]];
export function pillarColor(k: number): string {
  const t = Math.max(0, Math.min(1, k)) * 2;
  const i = Math.min(1, Math.floor(t));
  const f = t - i;
  const c = PILLAR[i].map((v, j) => Math.round(v + (PILLAR[i + 1][j] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export class GlobeView {
  g: GlobeInstance;
  mode: Mode = 'hero';
  model?: Model;
  onPick?: (agg: PlaceAgg) => void;
  onHover?: (agg: PlaceAgg | null) => void;
  private heat = new Map<string, number>();
  private focusCc?: string;
  private points = new Map<string, PointD>();
  private arcs = new Map<string, ArcD>();
  private rings: RingD[] = [];
  private pins = new Map<string, PinD>();
  private idleTimer = 0;

  constructor(el: HTMLElement) {
    this.g = new Globe(el, { animateIn: true, rendererConfig: { preserveDrawingBuffer: true, antialias: true, alpha: true } })
      .width(innerWidth)
      .height(innerHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .globeMaterial(new MeshPhongMaterial({ color: '#0a1033', emissive: '#050a26', emissiveIntensity: 0.9, shininess: 6 }))
      .showAtmosphere(true)
      .atmosphereColor('#4d6bff')
      .atmosphereAltitude(0.24)
      // countries as glowing dot-hexes, lit by how much of the supply chain lives there
      .hexPolygonsData(COUNTRY_FEATURES)
      .hexPolygonResolution(3)
      .hexPolygonMargin(0.42)
      .hexPolygonUseDots(true)
      .hexPolygonAltitude(0.004)
      .hexPolygonColor(this.hexColor)
      // maintainers
      .pointsData([])
      .pointLat('lat')
      .pointLng('lng')
      .pointAltitude('alt')
      .pointRadius('r')
      .pointColor('color')
      .pointResolution(8)
      .pointsTransitionDuration(900)
      .pointLabel((d: any) => this.tooltip(d as PointD))
      .onPointClick((d: any) => this.mode === 'result' && this.onPick?.((d as PointD).agg))
      .onPointHover((d: any) => {
        el.style.cursor = d && this.mode === 'result' ? 'pointer' : 'grab';
        this.onHover?.(d ? (d as PointD).agg : null);
      })
      // arcs to HQ
      .arcsData([])
      .arcColor(() => ['rgba(52,245,255,0.05)', 'rgba(52,245,255,0.75)', 'rgba(255,62,165,0.95)'])
      .arcStroke('stroke')
      .arcDashLength(0.42)
      .arcDashGap('gap')
      .arcDashInitialGap(() => Math.random() * 2)
      .arcDashAnimateTime('t')
      .arcAltitudeAutoScale(0.42)
      .arcsTransitionDuration(0)
      // pings
      .ringsData([])
      .ringColor((d: any) => (t: number) => (d as RingD).color.replace('$', String(Math.max(0, 1 - t))))
      .ringMaxRadius('max')
      .ringPropagationSpeed('speed')
      .ringRepeatPeriod(900)
      .ringAltitude(0.006)
      // labels
      .htmlElementsData([])
      .htmlElement((d: any) => (d as PinD).el)
      .htmlAltitude(0.03);

    const c = this.g.controls() as any;
    c.autoRotate = true;
    c.autoRotateSpeed = 0.5;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 130;
    c.maxDistance = 900;
    c.addEventListener('start', () => {
      c.autoRotate = false;
      clearTimeout(this.idleTimer);
    });
    c.addEventListener('end', () => {
      this.idleTimer = window.setTimeout(() => (c.autoRotate = true), 9000);
    });

    addEventListener('resize', () => {
      this.g.width(innerWidth).height(innerHeight);
      this.layout();
    });
    setInterval(() => this.pruneRings(), 500);
    this.layout(false);
  }

  private hexColor = (f: any): string => {
    const cc = CCN3_TO_CC.get(String(f.id));
    const t = cc ? this.heat.get(cc) : undefined;
    if (this.focusCc) {
      if (cc === this.focusCc) return '#ffffff';
      return t === undefined ? 'rgba(110,130,255,0.12)' : `hsla(${190 + 140 * t}, 100%, ${52 + 16 * t}%, 0.35)`;
    }
    if (t === undefined) return 'rgba(110,130,255,0.30)';
    const hue = 190 + 140 * t; // cyan → magenta
    return `hsl(${hue}, 100%, ${52 + 16 * t}%)`;
  };

  /** Light one country up (panel hover); pass undefined to clear. */
  highlightCountry(cc?: string) {
    if (this.focusCc === cc) return;
    this.focusCc = cc;
    this.g.hexPolygonColor((f: any) => this.hexColor(f));
    this.g.arcColor((d: any) =>
      !cc || (d as ArcD).cc === cc
        ? ['rgba(52,245,255,0.05)', 'rgba(52,245,255,0.75)', 'rgba(255,62,165,0.95)']
        : ['rgba(52,245,255,0.0)', 'rgba(52,245,255,0.08)', 'rgba(255,62,165,0.1)'],
    );
  }

  /** Cinematic entrance: drop in from deep space, then settle. */
  introFly() {
    const { alt } = this.layoutFor();
    const pov = this.g.pointOfView();
    this.g.pointOfView({ lat: 18, lng: pov.lng - 60, altitude: alt * 3.2 }, 0);
    setTimeout(() => this.g.pointOfView({ lat: 22, lng: pov.lng, altitude: alt }, 2600), 60);
  }

  /** Arcs grow out of the globe instead of popping in (used for the final result render). */
  setArcReveal(on: boolean) {
    this.g.arcsTransitionDuration(on ? 1400 : 0);
  }

  setMode(mode: Mode) {
    this.mode = mode;
    const c = this.g.controls() as any;
    c.autoRotateSpeed = mode === 'hero' ? 0.5 : mode === 'scan' ? 0.9 : 0.35;
    this.layout();
    if (mode !== 'result') this.g.htmlElementsData([]);
  }

  restAltitude(): number {
    return this.layoutFor().alt;
  }

  /** Shift the globe so it sits beside the UI rather than under it. */
  layout(animate = true) {
    const { off, alt } = this.layoutFor();
    this.g.globeOffset(off);
    const pov = this.g.pointOfView();
    this.g.pointOfView({ ...pov, altitude: alt }, animate ? 1200 : 0);
  }

  private layoutFor(): { off: [number, number]; alt: number } {
    const mobile = innerWidth <= 900;
    let off: [number, number] = [0, 0];
    let alt = 2.3;
    if (mobile) {
      off = [0, this.mode === 'result' ? -innerHeight * 0.2 : this.mode === 'scan' ? -innerHeight * 0.18 : -innerHeight * 0.16];
      alt = this.mode === 'result' ? 4.4 : 3.6;
    } else if (this.mode === 'hero') {
      off = [innerWidth * 0.25, 0];
      alt = innerWidth / innerHeight < 1.5 ? 2.9 : 2.3;
    } else if (this.mode === 'scan') {
      off = [innerWidth * 0.14, 0];
      alt = 2.25;
    } else {
      off = [-(380 + 32) / 2 + 40, 30];
      alt = innerWidth / innerHeight < 1.5 ? 3.3 : 2.85;
    }
    return { off, alt };
  }

  clear() {
    this.points.clear();
    this.arcs.clear();
    this.heat.clear();
    this.rings = [];
    this.g.pointsData([]).arcsData([]).ringsData([]).htmlElementsData([]);
    this.g.hexPolygonColor((f: any) => this.hexColor(f));
  }

  /** Render (or live-update) a model. New places ping as they appear. */
  render(model: Model, opts: { ping?: boolean } = {}) {
    this.model = model;
    const places = model.places.slice(0, 600);
    const maxW = places[0]?.weight || 1;

    // country heat
    const maxShare = model.countries[0]?.share || 1;
    this.heat.clear();
    for (const c of model.countries) this.heat.set(c.cc, Math.sqrt(c.share / maxShare));
    this.g.hexPolygonColor((f: any) => this.hexColor(f));

    // points
    const seen = new Set<string>();
    for (const agg of places) {
      const k = Math.sqrt(agg.weight / maxW);
      let d = this.points.get(agg.place.id);
      const isNew = !d;
      if (!d) {
        d = { id: agg.place.id, agg, lat: agg.place.lat, lng: agg.place.lng, alt: 0, r: 0, color: '' };
        this.points.set(d.id, d);
      }
      d.agg = agg;
      d.alt = 0.012 + 0.32 * k;
      d.r = 0.28 + 0.55 * k;
      d.color = pillarColor(k);
      seen.add(d.id);
      if (isNew && opts.ping) this.ping(d.lat, d.lng, 'rgba(52,245,255,$)', 2.2);
    }
    for (const id of this.points.keys()) if (!seen.has(id)) this.points.delete(id);
    this.g.pointsData([...this.points.values()]);

    // arcs
    const hq = model.hq;
    const prevArcs = this.arcs;
    this.arcs = new Map();
    if (hq) {
      for (const agg of places.slice(0, 260)) {
        if (agg.place.id === hq.id) continue;
        const dist = Math.hypot(agg.place.lat - hq.lat, agg.place.lng - hq.lng);
        if (dist < 1.2) continue;
        const k = Math.sqrt(agg.weight / maxW);
        const prev = prevArcs.get(agg.place.id);
        if (prev && prev.endLat === hq.lat && prev.endLng === hq.lng) {
          prev.stroke = 0.18 + 0.9 * k;
          this.arcs.set(prev.id, prev);
          continue;
        }
        this.arcs.set(agg.place.id, {
          id: agg.place.id,
          cc: agg.place.cc,
          startLat: agg.place.lat,
          startLng: agg.place.lng,
          endLat: hq.lat,
          endLng: hq.lng,
          stroke: 0.18 + 0.9 * k,
          t: 1800 + Math.random() * 2600,
          gap: 0.6 + Math.random() * 1.4,
        });
      }
    }
    this.g.arcsData([...this.arcs.values()]);
    this.setHqRing(hq);
    if (this.mode === 'result') this.setPins(model);
  }

  private setHqRing(hq?: Place) {
    this.rings = this.rings.filter((r) => r.until !== Infinity);
    if (hq) this.rings.push({ lat: hq.lat, lng: hq.lng, color: 'rgba(255,62,165,$)', until: Infinity, speed: 2.5, max: 7 });
    this.g.ringsData([...this.rings]);
  }

  ping(lat: number, lng: number, color: string, max = 3) {
    this.rings.push({ lat, lng, color, until: Date.now() + 1800, speed: 3, max });
    this.g.ringsData([...this.rings]);
  }

  private pruneRings() {
    const now = Date.now();
    const before = this.rings.length;
    this.rings = this.rings.filter((r) => r.until > now);
    if (this.rings.length !== before) this.g.ringsData([...this.rings]);
  }

  setPins(model: Model) {
    const pins: PinD[] = [];
    const mk = (id: string, lat: number, lng: number, html: string, cls: string) => {
      let p = this.pins.get(id);
      if (!p) {
        const el = document.createElement('div');
        p = { id, lat, lng, el };
        this.pins.set(id, p);
      }
      p.el.className = `pin ${cls}`;
      p.el.innerHTML = html;
      pins.push(p);
    };
    if (model.hq) mk(`hq:${model.hq.id}`, model.hq.lat, model.hq.lng, `⌂ HQ · ${esc(model.hq.label.split(',')[0])}`, '');
    const taken = model.hq ? [model.hq] : [];
    for (const agg of model.places.slice(0, 4)) {
      if (pins.length >= 3) break;
      if (taken.some((t) => Math.hypot(t.lat - agg.place.lat, t.lng - agg.place.lng) < 12)) continue;
      taken.push(agg.place);
      mk(`top:${agg.place.id}`, agg.place.lat, agg.place.lng, `${agg.place.flag} ${esc(agg.place.label.split(',')[0])} · ${agg.people.size}`, 'top');
    }
    this.g.htmlElementsData(pins);
  }

  private tooltip(d: PointD): string {
    const m = this.model;
    if (!m) return '';
    const a = d.agg;
    const people = [...a.people].map((k) => m.result.entities[k]).filter(Boolean);
    const pkgNames = [...a.pkgs].slice(0, 6).map((id) => id.split(':').slice(1).join(':'));
    const more = a.pkgs.size - pkgNames.length;
    return `<div class="tt-h">${a.place.flag} ${esc(a.place.label)}</div>
      <div class="tt-s">${fmt(a.people.size)} ${a.people.size === 1 ? 'maintainer' : 'maintainers'} · ${fmt(a.pkgs.size)} packages</div>
      <div class="tt-av">${people
        .slice(0, 14)
        .map((e) => `<img src="${esc(avatar(e.avatar ?? avatarFor(e.login), 52))}" alt="" title="@${esc(e.login)}" loading="lazy">`)
        .join('')}</div>
      <div class="tt-p">${pkgNames.map(esc).join(' · ')}${more > 0 ? ` · +${more} more` : ''}</div>
      ${this.mode === 'result' ? '<div class="tt-hint">click to make this HQ</div>' : ''}`;
  }

  flyTo(lat: number, lng: number, altitude = 1.6, ms = 1600) {
    (this.g.controls() as any).autoRotate = false;
    this.g.pointOfView({ lat, lng, altitude }, ms);
  }

  resumeRotate() {
    (this.g.controls() as any).autoRotate = true;
  }

  /** Where the globe sits on the WebGL canvas right now, in canvas pixels. */
  frameGeometry(): { canvas: HTMLCanvasElement; cx: number; cy: number; r: number } {
    const canvas = this.g.renderer().domElement;
    const off = this.g.globeOffset();
    const cam = this.g.camera() as any;
    const alt = this.g.pointOfView().altitude;
    const d = 100 * (1 + alt);
    const fov = (cam.fov * Math.PI) / 180;
    const rCss = (innerHeight / 2) * (Math.tan(Math.asin(100 / d)) / Math.tan(fov / 2));
    const scale = canvas.width / innerWidth;
    return { canvas, cx: (innerWidth / 2 + off[0]) * scale, cy: (innerHeight / 2 + off[1]) * scale, r: rCss * scale * 1.06 };
  }

  /** Square crop of the globe for the share card. */
  async snapshot(): Promise<{ img: HTMLImageElement; cx: number; cy: number; r: number }> {
    const { canvas, cx, cy, r } = this.frameGeometry();
    const img = new Image();
    img.src = canvas.toDataURL('image/png');
    await img.decode();
    return { img, cx, cy, r };
  }

}
