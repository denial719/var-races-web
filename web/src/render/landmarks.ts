// Each city's famous landmarks, built in 3D for the first-person view, standing where the map
// pictures paint them (map coordinates, y up). Plain coloured boxes and tapering blocks,
// shaded by which way each face points.
//
// The map pictures draw the tall ones as a side view rising up the picture from their base, so
// the 3D model stands on that base and the scenery is told to leave the area clear.
import * as THREE from 'three';
import type { MapDef } from '../wasm';
import { Builder, mix, rgb, shade, vertexColors, type Rgb } from './geom';

/** a map area (x0, y0, x1, y1) where the picture of a landmark is */
export type Area = [number, number, number, number];

type V2 = [number, number];
type V3 = [number, number, number];

/** half the road's width plus its walkway, on the city street circuits (crates/tools/src/cities.rs) */
const STREET_HALF = 46 + 18;

const cos = (deg: number) => Math.cos((deg * Math.PI) / 180);
const sin = (deg: number) => Math.sin((deg * Math.PI) / 180);

class Landmarks {
  readonly b = new Builder();
  readonly clear: Area[] = [];

  clearAbove(x: number, y: number, half: number, up: number): void {
    this.clear.push([x - half, y - 6, x + half, y + up]);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: Rgb): void {
    this.b.box(x0, y0, z0, x1, y1, z1, c);
  }

  frustum(x: number, y: number, z0: number, z1: number, r0: number, r1: number, c: Rgb): void {
    this.b.frustum(x, y, z0, z1, r0, r1, c);
  }

  /** a box turned to face angle a (radians): half-length hl along a, half-width hw across */
  obox(x: number, y: number, z0: number, z1: number, hl: number, hw: number, a: number, c: Rgb): void {
    const f: V2 = [Math.cos(a), Math.sin(a)], r: V2 = [-f[1], f[0]];
    const at = (s: number, t: number, z: number): V3 => [x + f[0] * s * hl + r[0] * t * hw, y + f[1] * s * hl + r[1] * t * hw, z];
    this.b.quad(at(-1, -1, z1), at(1, -1, z1), at(1, 1, z1), at(-1, 1, z1), c);
    const sides: [number, number, number, number, V2][] = [[1, -1, 1, 1, f], [1, 1, -1, 1, r], [-1, 1, -1, -1, [-f[0], -f[1]]], [-1, -1, 1, -1, [-r[0], -r[1]]]];
    for (const [s0, t0, s1, t1, n] of sides) {
      this.b.quad(at(s0, t0, z0), at(s1, t1, z0), at(s1, t1, z1), at(s0, t0, z1), shade(c, 0.74 + 0.15 * n[0] + 0.06 * n[1]));
    }
  }

  /** a square beam t thick from point p to point q (cables, girders, rods) */
  beam(p: V3, q: V3, t: number, c: Rgb): void {
    const d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const len = Math.hypot(...d);
    if (len < 0.01) return;
    // two directions square to the beam
    let u: V3 = Math.abs(d[2]) / len > 0.9 ? [1, 0, 0] : [-d[1], d[0], 0];
    const ul = Math.hypot(...u);
    u = [(u[0] / ul) * t / 2, (u[1] / ul) * t / 2, (u[2] / ul) * t / 2];
    let w: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const wl = Math.hypot(...w);
    w = [(w[0] / wl) * t / 2, (w[1] / wl) * t / 2, (w[2] / wl) * t / 2];
    const corner = (o: V3, su: number, sw: number): V3 => [o[0] + u[0] * su + w[0] * sw, o[1] + u[1] * su + w[1] * sw, o[2] + u[2] * su + w[2] * sw];
    const ring: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [a0, b0] = ring[i], [a1, b1] = ring[(i + 1) % 4];
      this.b.quad(corner(p, a0, b0), corner(q, a0, b0), corner(q, a1, b1), corner(p, a1, b1), shade(c, i % 2 ? 0.8 : 1));
    }
  }

  /**
   * A suspension bridge carrying the track over the water between points `from` and `to` (on
   * the track, in driving order): towers at the given shares of the way across, a main cable
   * each side sagging between them, and suspender ropes down to the deck.
   */
  suspensionBridge(map: MapDef, from: V2, to: V2, towers: number[], top: number, c: Rgb, dark: Rgb): void {
    const [a, b] = [nearestWaypoint(map, from), nearestWaypoint(map, to)];
    const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const f: V2 = [Math.cos(dir), Math.sin(dir)], r: V2 = [-f[1], f[0]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const point = (share: number, side: number): V2 => [a[0] + f[0] * len * share + r[0] * side, a[1] + f[1] * len * share + r[1] * side];
    const legs = STREET_HALF + 14;
    for (const share of towers) {
      for (const side of [-1, 1]) {
        const [x, y] = point(share, side * legs);
        this.obox(x, y, 0, top, 9, 7, dir, c);
      }
      for (const z of [top * 0.22, top * 0.55, top * 0.95]) {
        const [x, y] = point(share, 0);
        this.obox(x, y, z, z + 8, 5, legs, dir, dark);
      }
    }
    // the main cables: from the shore up to each tower and sagging between them
    const stops = [0, ...towers, 1];
    for (const side of [-1, 1]) {
      for (let span = 0; span + 1 < stops.length; span++) {
        const s0 = stops[span], s1 = stops[span + 1];
        const steps = Math.max(2, Math.floor(((s1 - s0) * len) / 14));
        const height = (t: number) => {
          if (span === 0) return 8 + (top - 8) * t * t;
          if (span === stops.length - 2) return 8 + (top - 8) * (1 - t) * (1 - t);
          return 16 + (top - 16) * Math.pow(2 * t - 1, 2);
        };
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps;
          const p0 = point(s0 + (s1 - s0) * t0, side * (STREET_HALF + 4)), p1 = point(s0 + (s1 - s0) * t1, side * (STREET_HALF + 4));
          this.beam([p0[0], p0[1], height(t0)], [p1[0], p1[1], height(t1)], 1.6, c);
          if (k % 2 === 0) this.beam([p0[0], p0[1], 4], [p0[0], p0[1], height(t0)], 0.5, c);
        }
      }
    }
  }

  /** a square tower block, with window bands if asked */
  tower(x: number, y: number, hx: number, hy: number, z0: number, z1: number, c: Rgb, windows: boolean): void {
    this.tower2(x - hx, y - hy, x + hx, y + hy, z0, z1, c, windows);
  }

  tower2(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, c: Rgb, windows: boolean): void {
    this.box(x0, y0, z0, x1, y1, z1, c);
    if (windows) {
      const glass = rgb(0x46546a);
      for (let z = z0 + 6; z + 3 < z1; z += 9) this.box(x0 - 0.2, y0 - 0.2, z, x1 + 0.2, y1 + 0.2, z + 3, glass);
    }
  }

  /** the four corner legs of an open lattice tower, between z0 and z1 */
  legsFrustum(x: number, y: number, z0: number, z1: number, r0: number, r1: number, leg: number, c: Rgb): void {
    if (leg >= r0 * 0.9) {
      this.frustum(x, y, z0, z1, r0, r1, c);
      return;
    }
    const l1 = (leg * r1) / Math.max(0.01, r0);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx0 = x + sx * (r0 - leg / 2), cy0 = y + sy * (r0 - leg / 2);
        const cx1 = x + sx * (r1 - l1 / 2), cy1 = y + sy * (r1 - l1 / 2);
        this.slantedPost(cx0, cy0, cx1, cy1, z0, z1, leg / 2, l1 / 2, c);
      }
    }
    // a cross-brace band round the tower at the top of the section
    const t = Math.max(1, (z1 - z0) * 0.12);
    this.frame(x, y, z1 - t, z1, r1, Math.max(1.2, l1 * 0.5), c);
  }

  /** a square post leaning from one centre to another */
  slantedPost(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, h0: number, h1: number, c: Rgb): void {
    const b = this.b;
    b.quad([x0 + h0, y0 - h0, z0], [x0 + h0, y0 + h0, z0], [x1 + h1, y1 + h1, z1], [x1 + h1, y1 - h1, z1], shade(c, 0.9));
    b.quad([x0 - h0, y0 + h0, z0], [x0 - h0, y0 - h0, z0], [x1 - h1, y1 - h1, z1], [x1 - h1, y1 + h1, z1], shade(c, 0.68));
    b.quad([x0 + h0, y0 + h0, z0], [x0 - h0, y0 + h0, z0], [x1 - h1, y1 + h1, z1], [x1 + h1, y1 + h1, z1], shade(c, 0.8));
    b.quad([x0 - h0, y0 - h0, z0], [x0 + h0, y0 - h0, z0], [x1 + h1, y1 - h1, z1], [x1 - h1, y1 - h1, z1], shade(c, 0.6));
  }

  /** a square ring of beams round (x, y) at half-width r */
  frame(x: number, y: number, z0: number, z1: number, r: number, t: number, c: Rgb): void {
    this.box(x - r, y - r, z0, x + r, y - r + t, z1, c);
    this.box(x - r, y + r - t, z0, x + r, y + r, z1, c);
    this.box(x - r, y - r, z0, x - r + t, y + r, z1, c);
    this.box(x + r - t, y - r, z0, x + r, y + r, z1, c);
  }

  /** an observation deck: a dark glass band with a light roof */
  deck(x: number, y: number, z: number, r: number, h: number, glass: Rgb, roof: Rgb): void {
    this.box(x - r, y - r, z, x + r, y + r, z + h * 0.75, glass);
    this.box(x - r - 1, y - r - 1, z + h * 0.75, x + r + 1, y + r + 1, z + h, roof);
  }

  /** a thin beam in the upright plane of a wheel, from (u0, v0) to (u1, v1) */
  plank(x: number, y: number, u0: number, v0: number, u1: number, v1: number, t: number, alongX: boolean, c: Rgb): void {
    const du = u1 - u0, dv = v1 - v0, len = Math.hypot(du, dv);
    if (len < 0.01) return;
    const nu = ((-dv / len) * t) / 2, nv = ((du / len) * t) / 2;
    const d = t / 2;
    const pts: [number, number][] = [[u0 + nu, v0 + nv], [u1 + nu, v1 + nv], [u1 - nu, v1 - nv], [u0 - nu, v0 - nv]];
    const at = (p: [number, number], side: number): [number, number, number] =>
      alongX ? [x + p[0], y + side * d, p[1]] : [x + side * d, y + p[0], p[1]];
    for (const side of [-1, 1]) {
      this.b.quad(at(pts[0], side), at(pts[1], side), at(pts[2], side), at(pts[3], side), side < 0 ? shade(c, 0.75) : c);
    }
    // the beam's edges
    for (let i = 0; i < 4; i++) {
      const p = pts[i], n = pts[(i + 1) % 4];
      this.b.quad(at(p, -1), at(n, -1), at(n, 1), at(p, 1), shade(c, 0.85));
    }
  }

  /** a beam along x from (x0, z0) to (x1, z1) at y = cy */
  plankX(x0: number, z0: number, x1: number, z1: number, cy: number, t: number, c: Rgb): void {
    const h = t / 2, b = this.b;
    b.quad([x0, cy - h, z0 + h], [x1, cy - h, z1 + h], [x1, cy + h, z1 + h], [x0, cy + h, z0 + h], c);
    b.quad([x0, cy - h, z0 - h], [x1, cy - h, z1 - h], [x1, cy - h, z1 + h], [x0, cy - h, z0 + h], shade(c, 0.7));
    b.quad([x1, cy + h, z1 - h], [x0, cy + h, z0 - h], [x0, cy + h, z0 + h], [x1, cy + h, z1 + h], shade(c, 0.85));
  }

  // ---------------------------------------------------------------- across the track

  /** where the track passes nearest `at`, and which way it runs there (radians) */
  private trackAt(map: MapDef, at: V2): { x: number; y: number; dir: number } {
    const w = map.waypoints as V2[];
    let i = 0;
    for (let k = 1; k < w.length; k++) if (Math.hypot(w[k][0] - at[0], w[k][1] - at[1]) < Math.hypot(w[i][0] - at[0], w[i][1] - at[1])) i = k;
    const a = w[(i + w.length - 1) % w.length], b = w[(i + 1) % w.length];
    return { x: w[i][0], y: w[i][1], dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }

  /** a point `along` the track and `across` it (left of travel) from a place on it */
  private off(p: { x: number; y: number; dir: number }, along: number, across: number): V2 {
    return [p.x + Math.cos(p.dir) * along - Math.sin(p.dir) * across, p.y + Math.sin(p.dir) * along + Math.cos(p.dir) * across];
  }

  /** a big red torii standing over the road */
  torii(map: MapDef, at: V2): void {
    const p = this.trackAt(map, at), red = rgb(0xd8342c), black = rgb(0x2a2a30), legs = STREET_HALF + 8;
    for (const side of [-1, 1]) {
      const [x, y] = this.off(p, 0, side * legs);
      this.frustum(x, y, 0, 70, 4.5, 3.6, red);
      this.frustum(x, y, 0, 5, 6, 6, black);
    }
    const [cx, cy] = this.off(p, 0, 0);
    this.obox(cx, cy, 56, 62, 4, legs + 4, p.dir, red);
    this.obox(cx, cy, 70, 74, 5, legs + 16, p.dir, red);
    this.obox(cx, cy, 74, 78, 6, legs + 20, p.dir, black);
  }

  /** one of Brooklyn Bridge's granite towers over the road, the road running through its arch */
  brooklynTower(map: MapDef, at: V2): void {
    const p = this.trackAt(map, at), stone = rgb(0xd6c6a3), dark = rgb(0x9a8a6a), legs = STREET_HALF + 4;
    for (const side of [-1, 1]) {
      const [x, y] = this.off(p, 0, side * legs);
      this.obox(x, y, 0, 120, 10, 12, p.dir, stone);
    }
    const [cx, cy] = this.off(p, 0, 0);
    this.obox(cx, cy, 80, 130, 10, legs + 12, p.dir, stone);
    this.obox(cx, cy, 130, 134, 11, legs + 13, p.dir, dark);
    // the cables fanning down from the tower top
    for (const side of [-1, 1]) {
      const [x, y] = this.off(p, 0, side * (legs + 6));
      for (const along of [-160, 160]) {
        const [ex, ey] = this.off(p, along, side * (legs + 6));
        this.beam([x, y, 126], [ex, ey, 10], 1.4, rgb(0x6f6a62));
      }
    }
  }

  /** Tower Bridge: two stone towers astride the road with spires, and the blue high walkways */
  towerBridgeAt(map: MapDef, at: V2): void {
    const p = this.trackAt(map, at), stone = rgb(0xd6c6a3), blue = rgb(0x4f7fbf), slate = rgb(0x6d7b88);
    const legs = STREET_HALF + 12;
    for (const along of [-40, 40]) {
      for (const side of [-1, 1]) {
        const [x, y] = this.off(p, along, side * legs);
        this.obox(x, y, 0, 105, 18, 14, p.dir, stone);
        this.frustum(x, y, 105, 128, 13, 2, slate);
      }
      const [cx, cy] = this.off(p, along, 0);
      this.obox(cx, cy, 64, 105, 18, legs, p.dir, stone);
    }
    for (const side of [-1, 1]) {
      const [x, y] = this.off(p, 0, side * legs);
      this.obox(x, y, 92, 100, 26, 6, p.dir, blue);
    }
  }

  /** the L: Chicago's elevated railway on its steel posts, crossing over the road */
  elevatedRail(map: MapDef, at: V2): void {
    const p = this.trackAt(map, at), steel = rgb(0x3a3c42), reach = STREET_HALF + 90;
    const across = p.dir + Math.PI / 2;
    for (const side of [-1, 1]) {
      for (const k of [1, 2]) {
        const [x, y] = this.off(p, 0, side * (STREET_HALF + 8 + (k - 1) * 70));
        for (const along of [-14, 14]) {
          const [px, py] = this.off({ x, y, dir: p.dir }, along, 0);
          this.frustum(px, py, 0, 34, 1.6, 1.6, steel);
        }
      }
    }
    const [cx, cy] = this.off(p, 0, 0);
    this.obox(cx, cy, 34, 40, reach, 18, across, rgb(0x5a3a22));
    this.obox(cx, cy, 40, 43, reach, 16, across, rgb(0x8d8f96));
    // a train passing over
    this.obox(cx, cy, 43, 56, 70, 9, across, rgb(0xc9ccd2));
    this.obox(cx, cy, 49, 52, 70.5, 9.5, across, rgb(0x3f6fbf));
  }

  /** Pont Alexandre III's four tall pylons with gilded horses, at each end of the bridge */
  alexandre(map: MapDef, at: V2): void {
    const p = this.trackAt(map, at), stone = rgb(0xd8ceb6), gold = rgb(0xf2c84b);
    for (const along of [-50, 50]) {
      for (const side of [-1, 1]) {
        const [x, y] = this.off(p, along, side * (STREET_HALF + 8));
        this.frustum(x, y, 0, 60, 6, 5, stone);
        this.frustum(x, y, 60, 72, 6, 3, gold);
      }
    }
  }

  /**
   * The things lining a famous stretch of track (from, to, in driving order), standing just
   * behind the kerbs: neon billboards on posts (Times Square, Shibuya) or night market stalls
   * under strings of red lanterns.
   */
  lining(map: MapDef, from: V2, to: V2, kind: 'neon' | 'lanterns'): void {
    const path = waypointsBetween(map, from, to);
    const neon = [rgb(0xff4fa3), rgb(0x3fe0ff), rgb(0xffe23f), rgb(0x8cff5a), rgb(0xff7a3f), rgb(0xb57cff)];
    path.forEach((p, i) => {
      if (i === 0 || i === path.length - 1) return;
      const a = path[i - 1], b = path[i + 1];
      const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (const side of [-1, 1]) {
        const off = side * (STREET_HALF + 16);
        const x = p[0] - Math.sin(dir) * off, y = p[1] + Math.cos(dir) * off;
        if (kind === 'neon') {
          this.frustum(x, y, 0, 18, 1.2, 1.2, rgb(0x3a3c42));
          this.obox(x, y, 18, 40, 13, 1.5, dir, neon[(i * 2 + (side > 0 ? 1 : 0)) % neon.length]);
        } else {
          this.obox(x, y, 0, 8, 9, 6, dir, rgb(0x7a4a2a));
          this.obox(x, y, 12, 14, 11, 8, dir, [rgb(0xd9433b), rgb(0x2f8f6a), rgb(0x3b6fd9), rgb(0xe08a2e)][i % 4]);
          this.frustum(x, y, 8, 12, 0.6, 0.6, rgb(0x5a3a22));
          this.box(x - 1.5, y - 1.5, 18, x + 1.5, y + 1.5, 22, rgb(0xff5a4a));
        }
      }
    });
  }

  // ---------------------------------------------------------------- Tokyo

  /** Tokyo Skytree: a slim white lattice tower, two observation decks and a mast */
  skytree(x: number, y: number): void {
    this.clearAbove(x, y, 30, 330);
    const white = rgb(0xe8eef4);
    this.legsFrustum(x, y, 0, 200, 22, 10, 6, white);
    this.frustum(x, y, 200, 300, 10, 7, white);
    this.deck(x, y, 190, 13, 14, rgb(0x46546a), white);
    this.deck(x, y, 260, 10, 10, rgb(0x46546a), white);
    this.frustum(x, y, 300, 360, 4, 1.5, rgb(0xd9dde3));
  }

  /** Senso-ji: the Kaminarimon gate with its red lantern, the hall and the five-storey pagoda */
  sensoji(x: number, y: number): void {
    const red = rgb(0xd8342c), roof = rgb(0x3f4f48);
    this.clear.push([x - 50, y - 30, x + 80, y + 140]);
    this.box(x - 20, y - 6, 0, x + 20, y + 6, 22, red);
    this.box(x - 24, y - 9, 22, x + 24, y + 9, 28, roof);
    this.frustum(x, y, 6, 18, 6, 6, rgb(0xff5a4a));
    // the hall up the path
    this.box(x - 30, y + 110, 0, x + 30, y + 140, 24, rgb(0xf1e7d0));
    this.frustum(x, y + 125, 24, 44, 36, 14, roof);
    // the pagoda
    const px = x + 48, py = y + 60;
    for (let k = 0; k < 5; k++) {
      const z = k * 16, w = 16 - k * 2;
      this.box(px - w + 4, py - w + 4, z, px + w - 4, py + w - 4, z + 10, red);
      this.frustum(px, py, z + 10, z + 16, w + 2, w - 4, roof);
    }
    this.frustum(px, py, 80, 100, 2, 1, rgb(0xf2c84b));
  }

  /** the Imperial Palace's long white halls under green roofs, inside its walls */
  imperialPalace(x: number, y: number): void {
    const wall = rgb(0xb9b2a4), roof = rgb(0x3f6f5a), hall = rgb(0xf3eee2);
    this.clear.push([x - 160, y - 125, x + 160, y + 125]);
    for (const [a, b, c, d] of [[-150, -110, 150, -102], [-150, 102, 150, 110], [-150, -110, -142, 110], [142, -110, 150, 110]]) {
      this.box(x + a, y + b, 0, x + c, y + d, 10, wall);
    }
    for (const [hx, hy, w] of [[-66 + 39, 36 - 12, 39], [18 + 24, 12 - 12, 24], [-30 + 33, -30 - 12, 33]]) {
      this.box(x + hx - w, y + hy - 9, 0, x + hx + w, y + hy + 9, 14, hall);
      this.frustum(x + hx, y + hy, 14, 22, w + 3, w - 6, roof);
    }
  }

  /** Tokyo Big Sight: four upside-down pyramids on legs */
  bigSight(x: number, y: number): void {
    this.clear.push([x - 110, y - 50, x + 110, y + 50]);
    for (const [k, dx] of [-72, -24, 24, 72].entries()) {
      const cy = y + (k % 2 ? -9 : 0);
      this.frustum(x + dx, cy, 0, 26, 3, 3, rgb(0x6f7a85));
      this.frustum(x + dx, cy, 26, 62, 6, 26, rgb(0xb8c6d2));
    }
  }

  /** the life-size Gundam on Odaiba */
  gundam(x: number, y: number): void {
    const white = rgb(0xf3f1ea), blue = rgb(0x2f5fb8), red = rgb(0xd8342c);
    this.clear.push([x - 20, y - 20, x + 20, y + 50]);
    this.box(x - 12, y - 8, 0, x + 12, y + 8, 4, rgb(0x8d8f96));
    for (const dx of [-5, 5]) {
      this.box(x + dx - 3, y - 3, 4, x + dx + 3, y + 3, 26, white);
      this.box(x + dx - 3, y - 3, 4, x + dx + 3, y + 3, 8, red);
    }
    this.box(x - 9, y - 4, 26, x + 9, y + 4, 34, red);
    this.box(x - 8, y - 5, 34, x + 8, y + 5, 48, blue);
    for (const dx of [-12, 12]) this.box(x + dx - 3, y - 3, 30, x + dx + 3, y + 3, 48, white);
    this.box(x - 4, y - 4, 48, x + 4, y + 4, 56, white);
    this.box(x - 1, y - 1, 56, x + 1, y + 1, 60, rgb(0xf2c84b));
  }

  /** Mount Fuji on the horizon, snow on its peak */
  fuji(x: number, y: number): void {
    this.frustum(x, y, 0, 260, 900, 120, rgb(0x5b6f94));
    this.frustum(x, y, 260, 330, 120, 18, rgb(0xf4f6fa));
  }

  // ---------------------------------------------------------------- New York

  /** a glass skyscraper of stacked tiers: (half width, height, colour) from the ground up */
  skyscraper(x: number, y: number, tiers: [number, number, Rgb][], spire: number, spireColour: Rgb): void {
    let z = 0;
    const widest = Math.max(...tiers.map((t) => t[0]));
    this.clearAbove(x, y, widest + 8, 260);
    for (const [r, h, c] of tiers) {
      this.tower(x, y, r, r, z, z + h, c, true);
      z += h;
    }
    this.frustum(x, y, z, z + spire, 2, 0.8, spireColour);
  }

  /** the Chrysler Building's terraced steel crown */
  chrysler(x: number, y: number): void {
    this.clearAbove(x, y, 30, 220);
    const brick = rgb(0xd9d4ca), steel = rgb(0xc9ced6);
    this.tower(x, y, 24, 24, 0, 120, brick, true);
    let z = 120;
    for (const r of [18, 14, 10, 7]) {
      this.frustum(x, y, z, z + 12, r, r - 3, steel);
      z += 12;
    }
    this.frustum(x, y, z, z + 40, 3, 0.5, rgb(0xd9dde3));
  }

  /** Rockefeller Center's Christmas tree over the rink */
  rockefellerTree(x: number, y: number): void {
    this.clear.push([x - 34, y - 24, x + 34, y + 70]);
    this.box(x - 30, y - 18, 0, x + 30, y + 18, 1, rgb(0xcfe8f4));
    this.frustum(x, y + 40, 0, 6, 3, 3, rgb(0x5a3a22));
    this.frustum(x, y + 40, 6, 60, 16, 1, rgb(0x2f6a34));
    this.frustum(x, y + 40, 60, 66, 3, 0, rgb(0xffe58a));
  }

  // ---------------------------------------------------------------- Chicago

  /** Marina City's two round corncob towers */
  marinaCity(x: number, y: number): void {
    this.clearAbove(x, y, 100, 160);
    for (const dx of [-72, 72]) {
      for (let z = 0; z < 140; z += 6) {
        this.frustum(x + dx, y + 40, z, z + 3, 20, 20, rgb(0xe8e4dc));
        this.frustum(x + dx, y + 40, z + 3, z + 6, 15, 15, rgb(0x8f8a80));
      }
    }
  }

  /** Buckingham Fountain: tiers of pink granite in a round pool */
  fountain(x: number, y: number): void {
    this.clear.push([x - 50, y - 50, x + 50, y + 50]);
    this.frustum(x, y, 0, 3, 42, 42, rgb(0xd6c6a3));
    this.frustum(x, y, 3, 4, 38, 38, rgb(0x5aa7c8));
    this.frustum(x, y, 0, 10, 22, 20, rgb(0xe8b8a8));
    this.frustum(x, y, 10, 16, 13, 11, rgb(0xe8b8a8));
    this.frustum(x, y, 16, 30, 2, 0.5, rgb(0xdff2ff));
  }

  /** a ballpark: a bowl of stands round the field (Wrigley's green ivy walls if `ivy`) */
  ballpark(x: number, y: number, r: number, seats: Rgb, ivy: boolean): void {
    this.clear.push([x - r - 20, y - r - 20, x + r + 20, y + r + 20]);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, hw = (Math.PI * r) / 24 + 1;
      this.obox(x + Math.cos(a) * r, y + Math.sin(a) * r, 0, 16, 8, hw, a, ivy && k % 2 ? rgb(0x2f7a32) : seats);
    }
    for (const a of [0.6, 2.2, 3.8, 5.4]) this.frustum(x + Math.cos(a) * (r + 8), y + Math.sin(a) * (r + 8), 0, 40, 1.6, 1.2, rgb(0xd9dde3));
  }

  // ---------------------------------------------------------------- London

  /** the Shard: a tall glass shard narrowing to a point */
  shard(x: number, y: number): void {
    this.clearAbove(x, y, 48, 240);
    this.frustum(x, y, 0, 230, 40, 4, rgb(0x9fc4dc));
    this.frustum(x, y, 230, 250, 4, 0.5, rgb(0xd9e8f2));
  }

  /** the Gherkin: a rounded glass tower */
  gherkin(x: number, y: number): void {
    this.clearAbove(x, y, 30, 160);
    for (let i = 0; i < 12; i++) {
      const t0 = i / 12, t1 = (i + 1) / 12;
      const r = (t: number) => 8 + 18 * Math.sin(Math.PI * (0.15 + 0.75 * t));
      this.frustum(x, y, t0 * 130, t1 * 130, r(t0), r(t1), i % 2 ? rgb(0x2f5f7a) : rgb(0x4f8fa8));
    }
  }

  /** St Paul's Cathedral: the great dome on its drum above the nave */
  stPauls(x: number, y: number): void {
    this.clearAbove(x, y, 50, 120);
    const stone = rgb(0xe8e2d4);
    this.box(x - 40, y + 10, 0, x + 40, y + 50, 40, stone);
    this.frustum(x, y + 30, 40, 64, 24, 22, stone);
    this.frustum(x, y + 30, 64, 84, 22, 10, rgb(0x8a959e));
    this.frustum(x, y + 30, 84, 100, 3, 1, rgb(0xf2c84b));
  }

  /** Nelson's Column in Trafalgar Square */
  nelson(x: number, y: number): void {
    this.clear.push([x - 20, y - 20, x + 20, y + 20]);
    this.box(x - 9, y - 9, 0, x + 9, y + 9, 14, rgb(0xb9b2a4));
    this.frustum(x, y, 14, 130, 4, 3.2, rgb(0xd6c6a3));
    this.frustum(x, y, 130, 140, 3, 2, rgb(0x5a5c63));
  }

  /** the Tower of London: the White Tower with its four turrets */
  whiteTower(x: number, y: number): void {
    this.clear.push([x - 80, y - 70, x + 80, y + 70]);
    const stone = rgb(0xeee8da);
    this.box(x - 27, y - 24, 0, x + 27, y + 30, 44, stone);
    for (const [dx, dy] of [[-27, -24], [27, -24], [-27, 30], [27, 30]]) this.frustum(x + dx, y + dy, 44, 58, 6, 4, rgb(0x6f8f9a));
  }

  // ---------------------------------------------------------------- Paris

  /** Les Invalides: the gilded dome on its drum */
  invalides(x: number, y: number): void {
    this.clearAbove(x, y, 50, 100);
    this.box(x - 30, y - 10, 0, x + 30, y + 30, 30, rgb(0xe3dccf));
    this.frustum(x, y + 10, 30, 52, 20, 18, rgb(0xe8e2d4));
    this.frustum(x, y + 10, 52, 74, 18, 6, rgb(0xf2c84b));
    this.frustum(x, y + 10, 74, 96, 2, 0.6, rgb(0xd9a822));
  }

  /** the obelisk in the Place de la Concorde */
  obelisk(x: number, y: number): void {
    this.clear.push([x - 14, y - 14, x + 14, y + 14]);
    this.box(x - 6, y - 6, 0, x + 6, y + 6, 8, rgb(0xb9b2a4));
    this.frustum(x, y, 8, 78, 4, 2.6, rgb(0xe8d7b0));
    this.frustum(x, y, 78, 84, 2.6, 0, rgb(0xf2c84b));
  }

  /** the Louvre's glass pyramid */
  louvrePyramid(x: number, y: number): void {
    this.frustum(x, y + 18, 0, 34, 34, 0.5, rgb(0x9fd3f0));
  }

  /** the Moulin Rouge: the red windmill on its cabaret */
  moulinRouge(x: number, y: number): void {
    this.clearAbove(x, y, 34, 70);
    const red = rgb(0xd8342c);
    this.box(x - 30, y, 0, x + 30, y + 24, 20, red);
    this.box(x - 9, y + 6, 20, x + 9, y + 20, 46, rgb(0xc8302c));
    for (const a of [45, 135, 225, 315]) {
      this.beam([x, y + 4, 44], [x + cos(a) * 26, y + 4, 44 + sin(a) * 26], 3, rgb(0xb22a24));
    }
  }

  /** Sacre-Coeur: white domes on top of Montmartre */
  sacreCoeur(x: number, y: number): void {
    this.clearAbove(x, y, 60, 120);
    const white = rgb(0xf6f3ea);
    this.box(x - 40, y + 10, 0, x + 40, y + 60, 34, white);
    this.frustum(x, y + 35, 34, 70, 18, 4, white);
    for (const dx of [-28, 28]) this.frustum(x + dx, y + 20, 34, 52, 9, 2, white);
    this.frustum(x, y + 70, 34, 90, 6, 1, white);
  }

  // ---------------------------------------------------------------- Taipei

  /** the Grand Hotel: a vast red palace under golden roofs */
  grandHotel(x: number, y: number): void {
    this.clearAbove(x, y, 100, 100);
    const red = rgb(0xc8302c), gold = rgb(0xe8b832);
    this.box(x - 90, y, 0, x + 90, y + 40, 40, red);
    this.frustum(x, y + 20, 40, 50, 92, 70, gold);
    this.box(x - 30, y + 5, 40, x + 30, y + 35, 62, red);
    this.frustum(x, y + 20, 62, 76, 34, 12, gold);
  }

  /** the National Palace Museum: a long hall under green-tiled roofs */
  palaceMuseum(x: number, y: number): void {
    this.clearAbove(x, y, 80, 70);
    const cream = rgb(0xf3ead2), green = rgb(0x2f7a4a);
    this.box(x - 72, y, 0, x + 72, y + 30, 24, cream);
    this.frustum(x, y + 15, 24, 32, 74, 60, green);
    this.box(x - 30, y + 4, 32, x + 30, y + 26, 46, cream);
    this.frustum(x, y + 15, 46, 56, 32, 14, green);
  }

  /** the Maokong gondola: cabins on a cable over its pylons */
  gondola(x0: number, y0: number, x1: number, y1: number): void {
    const steps = 6;
    let last: V3 | null = null;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      this.frustum(x, y, 0, 40, 2, 1.5, rgb(0x8d8f96));
      const top: V3 = [x, y, 40];
      if (last) {
        this.beam(last, top, 0.8, rgb(0x3a3c42));
        const m: V3 = [(last[0] + x) / 2, (last[1] + y) / 2, 32];
        this.box(m[0] - 4, m[1] - 4, m[2] - 6, m[0] + 4, m[1] + 4, m[2] + 2, k % 2 ? rgb(0x3fae49) : rgb(0xf2c84b));
      }
      last = top;
    }
  }

  /** the Red House in Ximending: an octagonal red-brick theatre */
  redHouse(x: number, y: number): void {
    this.clear.push([x - 30, y - 30, x + 30, y + 30]);
    this.frustum(x, y, 0, 26, 24, 24, rgb(0xb5523b));
    this.frustum(x, y, 26, 36, 18, 6, rgb(0x5a5c63));
  }

  // ---------------------------------------------------------------- the landmarks

  /** Tokyo Tower: an orange and white lattice tower with two observation decks */
  tokyoTower(x: number, y: number): void {
    this.clearAbove(x, y, 60, 240);
    const h = 230, bands = 10;
    for (let i = 0; i < bands; i++) {
      const z0 = (h * i) / bands, z1 = (h * (i + 1)) / bands;
      const r0 = halfAt(z0 / h, 42), r1 = halfAt(z1 / h, 42);
      this.legsFrustum(x, y, z0, z1, r0, r1, Math.max(2, r0 * 0.22), i % 2 === 0 ? rgb(0xf05a28) : rgb(0xf2efe8));
    }
    this.deck(x, y, 0.38 * h, halfAt(0.38, 42) + 6, 9, rgb(0x3a4a5e), rgb(0xf2efe8));
    this.deck(x, y, 0.72 * h, halfAt(0.72, 42) + 3, 6, rgb(0x3a4a5e), rgb(0xf2efe8));
    this.box(x - 1.5, y - 1.5, h, x + 1.5, y + 1.5, h + 25, rgb(0xf2efe8));
  }

  /** the Empire State Building: stepped limestone tiers and its mast */
  empireState(x: number, y: number): void {
    this.clearAbove(x, y, 45, 240);
    for (const [r, z0, z1] of [[39, 0, 120], [27, 120, 175], [18, 175, 215], [9, 215, 235]]) {
      this.tower(x, y, r, r * 0.7, z0, z1, rgb(0xcfc8b8), true);
    }
    this.box(x - 4, y - 4, 235, x + 4, y + 4, 252, rgb(0xb7b0a2));
    this.box(x - 1, y - 1, 252, x + 1, y + 1, 290, rgb(0xe8e2d4));
  }

  /** the Flatiron: a wedge of a building on its triangular block */
  flatiron(x: number, y: number): void {
    this.clear.push([x - 4, y - 70, x + 46, y + 4]);
    for (let i = 0; i < 11; i++) {
      const y0 = y - i * 6, y1 = y - (i + 1) * 6;
      const w = 6 + (i + 1) * 3.4;
      this.tower2(x, y1, x + w, y0, 0, 72, rgb(0xdccaa6), i === 0);
    }
  }

  /** the Statue of Liberty: green, torch held high, on her pedestal */
  liberty(x: number, y: number): void {
    const stone = rgb(0xc9bfa9), green = rgb(0x6fb8a0);
    this.frustum(x, y, 0, 6, 18, 16, stone);
    this.box(x - 8, y - 8, 6, x + 8, y + 8, 30, stone);
    this.frustum(x, y, 30, 34, 9, 7, stone);
    this.frustum(x, y, 34, 58, 5, 3.2, green);
    this.box(x - 2, y - 2, 58, x + 2, y + 2, 63, green);
    for (let k = 0; k < 7; k++) {
      const a = k * 51;
      const cx = x + cos(a) * 2.6, cy = y + sin(a) * 2.6;
      this.box(cx - 0.5, cy - 0.5, 62, cx + 0.5, cy + 0.5, 65, green);
    }
    this.box(x + 3, y - 1, 52, x + 5, y + 1, 70, green);
    this.box(x + 2.5, y - 1.5, 70, x + 5.5, y + 1.5, 73, rgb(0xffd84a));
  }

  /** Willis Tower: nine black bundled tubes stepping up, two white antennas */
  willis(x: number, y: number): void {
    this.clearAbove(x, y, 42, 220);
    const s = 13;
    const tubes = [[-1, -1, 150], [0, -1, 210], [1, -1, 170], [-1, 0, 190], [0, 0, 245], [1, 0, 210], [-1, 1, 170], [0, 1, 230], [1, 1, 150]];
    for (const [tx, ty, th] of tubes) this.tower(x + tx * s, y + 20 + ty * s, s / 2, s / 2, 0, th, rgb(0x30333b), true);
    this.box(x - 4, y + 18, 245, x - 2.5, y + 19.5, 300, rgb(0xf2f2f2));
    this.box(x + 2.5, y + 18, 245, x + 4, y + 19.5, 290, rgb(0xf2f2f2));
  }

  /** Cloud Gate (the Bean): a squashed, shiny steel blob with an arch under it */
  bean(x: number, y: number): void {
    const steel = rgb(0xc3cbd6);
    for (let i = 0; i < 6; i++) {
      const z0 = 4 + i * 3, z1 = z0 + 3;
      const t = (z0 + 1.5 - 12) / 10;
      const k = Math.sqrt(Math.max(0.05, 1 - t * t));
      this.box(x - 27 * k, y - 15 * k, z0, x + 27 * k, y + 15 * k, z1, mix(steel, rgb(0x7fc0ff), i / 10));
    }
    this.box(x - 27, y - 9, 0, x - 16, y + 9, 4, steel);
    this.box(x + 16, y - 9, 0, x + 27, y + 9, 4, steel);
  }

  /** a Ferris wheel standing on its legs (Navy Pier's, or the London Eye) */
  ferrisWheel(x: number, y: number, r: number, alongX: boolean, rim: Rgb): void {
    const hub = r + 6, spokes = 18;
    for (let k = 0; k < 60; k++) {
      const a = k * 6, a2 = a + 6;
      this.plank(x, y, cos(a) * r, sin(a) * r + hub, cos(a2) * r, sin(a2) * r + hub, 1.6, alongX, rim);
    }
    for (let k = 0; k < spokes; k++) {
      const a = (k * 360) / spokes;
      this.plank(x, y, 0, hub, cos(a) * r, sin(a) * r + hub, 0.5, alongX, rgb(0xb7bec8));
      const pu = cos(a) * (r + 2), pv = sin(a) * (r + 2) + hub;
      const px = alongX ? x + pu : x, py = alongX ? y : y + pu;
      this.box(px - 2, py - 2, pv - 2, px + 2, py + 2, pv + 2, rgb(0x9fd3ef));
    }
    this.plank(x, y, 0, hub, -r * 0.45, 0, 2.4, alongX, rgb(0x8a8f99));
    this.plank(x, y, 0, hub, r * 0.45, 0, 2.4, alongX, rgb(0x8a8f99));
  }

  /** the Palace of Westminster: a long gothic block with pinnacles */
  parliament(x: number, y: number): void {
    this.clear.push([x, y - 4, x + 510, y + 70]);
    const stone = rgb(0xd8c48e);
    this.box(x, y, 0, x + 510, y + 42, 48, stone);
    for (let px = x + 6; px < x + 505; px += 36) this.box(px, y - 1, 48, px + 6, y + 5, 60, rgb(0xb79f6c));
    this.tower(x + 495, y + 21, 18, 18, 0, 110, stone, true);
  }

  /** Big Ben: clock faces near the top, and its spire */
  bigBen(x: number, y: number): void {
    this.clearAbove(x, y, 20, 215);
    const stone = rgb(0xd2bd86), face = rgb(0xf6f1df);
    this.tower(x, y, 12, 12, 0, 135, stone, false);
    this.box(x - 13, y - 13, 135, x + 13, y + 13, 160, rgb(0xe9d9a6));
    this.box(x - 8, y - 13.4, 139, x + 8, y - 13, 155, face);
    this.box(x - 8, y + 13, 139, x + 8, y + 13.4, 155, face);
    this.box(x - 13.4, y - 8, 139, x - 13, y + 8, 155, face);
    this.box(x + 13, y - 8, 139, x + 13.4, y + 8, 155, face);
    this.frustum(x, y, 160, 205, 12, 1, rgb(0x5f6e5a));
  }


  /** the Eiffel Tower: four splayed iron legs meeting at the first level, a needle above */
  eiffel(x: number, y: number): void {
    this.clearAbove(x, y, 66, 225);
    const iron = rgb(0x7a6550), light = rgb(0xa58b6e);
    const h = 260, bands = 14;
    for (let i = 0; i < bands; i++) {
      const z0 = (h * i) / bands, z1 = (h * (i + 1)) / bands;
      const r0 = halfAt(z0 / h, 62, 2.2), r1 = halfAt(z1 / h, 62, 2.2);
      const leg = z0 < h * 0.22 ? Math.max(4, r0 * 0.3) : r0;
      this.legsFrustum(x, y, z0, z1, r0, r1, leg, i % 2 === 0 ? iron : light);
    }
    this.deck(x, y, h * 0.22, halfAt(0.22, 62, 2.2) + 4, 6, rgb(0x5a4a3c), light);
    this.deck(x, y, h * 0.48, halfAt(0.48, 62, 2.2) + 2, 5, rgb(0x5a4a3c), light);
    this.box(x - 1.5, y - 1.5, h, x + 1.5, y + 1.5, h + 20, iron);
  }

  /** the Arc de Triomphe in the middle of its round plaza */
  arc(x: number, y: number): void {
    this.clear.push([x - 40, y - 30, x + 40, y + 30]);
    const stone = rgb(0xe3d6b8);
    this.box(x - 25, y - 12, 0, x - 9, y + 12, 40, stone);
    this.box(x + 9, y - 12, 0, x + 25, y + 12, 40, stone);
    this.box(x - 25, y - 12, 28, x + 25, y + 12, 52, stone);
    this.box(x - 26, y - 13, 52, x + 26, y + 13, 55, rgb(0xcbbd9e));
  }

  /** Taipei 101: eight flared green-glass sections stacked like bamboo, and its spire */
  taipei101(x: number, y: number): void {
    this.clearAbove(x, y, 32, 250);
    const glass = rgb(0x5f9a8e), light = rgb(0x9fc7bd);
    this.tower(x, y, 27, 27, 0, 48, glass, true);
    this.frustum(x, y, 48, 54, 27, 18, light);
    let z = 54;
    for (let seg = 0; seg < 8; seg++) {
      this.frustum(x, y, z, z + 22, 15, 21, seg % 2 === 0 ? glass : rgb(0x6aa89a));
      this.frustum(x, y, z + 22, z + 24, 21, 15, light);
      z += 24;
    }
    this.frustum(x, y, z, z + 14, 12, 8, glass);
    this.box(x - 2, y - 2, z + 14, x + 2, y + 2, z + 50, rgb(0xd9e4e0));
  }

  /** the Golden Gate: two tall orange towers, main cables and suspender ropes */
  /** the Palace of Fine Arts: an open rotunda of columns under a terracotta dome, and its colonnade */
  palaceOfFineArts(x: number, y: number): void {
    const ochre = rgb(0xd28b5a), stone = rgb(0xd9a982);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      this.frustum(x + Math.cos(a) * 20, y + Math.sin(a) * 20, 0, 34, 2.6, 2.2, stone);
    }
    this.frustum(x, y, 34, 42, 25, 24, ochre);
    this.frustum(x, y, 42, 56, 23, 15, ochre);
    this.frustum(x, y, 56, 63, 15, 6, rgb(0x7f9a8a));
    this.clear.push([x - 100, y - 50, x + 100, y + 50]);
    // the colonnade curving round behind it
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI * (k / 16);
      this.frustum(x + Math.cos(a) * 90, y + Math.sin(a) * 42, 0, 20, 2.2, 2, stone);
    }
  }

  /** Oracle Park: a bowl of stands round the field, and light towers */
  oraclePark(x: number, y: number): void {
    const seats = rgb(0x4a4c55), steel = rgb(0xd9dde3);
    this.clear.push([x - 160, y - 160, x + 160, y + 160]);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r = 138, hw = (Math.PI * r) / 24 + 1;
      this.obox(x + Math.cos(a) * r, y + Math.sin(a) * r, 0, 18 + (k % 2) * 4, 9, hw, a, k % 3 === 0 ? rgb(0xf08a2e) : seats);
    }
    for (const a of [0.4, 1.4, 2.6, 3.8, 5.0]) this.frustum(x + Math.cos(a) * 150, y + Math.sin(a) * 150, 0, 46, 2, 1.5, steel);
    // the giant Coke bottle behind left field
    this.frustum(x - 102, y - 90, 0, 26, 7, 4, rgb(0xb5523b));
  }

  /** the Dragon Gate into Chinatown: red pillars under green tiled roofs */
  dragonGate(x: number, y: number): void {
    const red = rgb(0xc8302c), green = rgb(0x3f8f5a);
    for (const dx of [-30, -12, 12, 30]) this.box(x + dx - 2, y - 2, 0, x + dx + 2, y + 2, Math.abs(dx) > 20 ? 14 : 18, red);
    this.box(x - 36, y - 5, 14, x - 8, y + 5, 17, green);
    this.box(x + 8, y - 5, 14, x + 36, y + 5, 17, green);
    this.box(x - 16, y - 6, 18, x + 16, y + 6, 22, green);
    this.box(x - 3, y - 2, 22, x + 3, y + 2, 25, rgb(0xf2c84b));
  }

  /** a cable car halfway along a stretch of track, at the kerb */
  cableCar(map: MapDef, from: V2, to: V2): void {
    const path = waypointsBetween(map, from, to);
    const i = Math.floor(path.length / 2);
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const x = path[i][0] - Math.sin(dir) * 21, y = path[i][1] + Math.cos(dir) * 21;
    this.obox(x, y, 0, 9, 30, 11, dir, rgb(0xc8302c));
    this.obox(x, y, 9, 11, 30, 11, dir, rgb(0xf2e6c8));
    this.obox(x, y, 11, 13, 31, 12, dir, rgb(0x8a5a3a));
  }

  /** the Transamerica Pyramid: a slender white pyramid with two shoulders */
  transamerica(x: number, y: number): void {
    this.clear.push([x - 40, y - 40, x + 40, y + 40]);
    const white = rgb(0xf1eee6);
    this.frustum(x, y, 0, 200, 30, 3, white);
    this.box(x - 22, y - 6, 120, x - 14, y + 6, 140, rgb(0xdcd8cc));
    this.box(x + 14, y - 6, 120, x + 22, y + 6, 140, rgb(0xdcd8cc));
    this.frustum(x, y, 200, 230, 3, 0.5, white);
  }

  /** Coit Tower on Telegraph Hill: a white fluted column */
  coit(x: number, y: number): void {
    this.clear.push([x - 22, y - 22, x + 22, y + 22]);
    this.frustum(x, y, 0, 75, 14, 13, rgb(0xf0eadb));
    this.frustum(x, y, 75, 82, 15, 15, rgb(0xd9d2c0));
  }

  /** the Ferry Building on the Embarcadero, and its clock tower */
  ferryBuilding(x0: number, y0: number, x1: number, y1: number): void {
    this.clear.push([x0 - 5, y0 - 5, x1 + 5, y1 + 5]);
    this.box(x0, y0, 0, x1, y1, 34, rgb(0xdccdb0));
    this.box(x0 + 2, y0 + 2, 34, x1 - 2, y1 - 2, 40, rgb(0x9a8a70));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.tower(cx, cy, 12, 12, 40, 105, rgb(0xc7b08a), false);
    this.box(cx - 12.5, cy - 6, 85, cx + 12.5, cy + 6, 97, rgb(0xf6f1df));
    this.frustum(cx, cy, 105, 125, 9, 1, rgb(0x2f6f62));
  }

  /** Alcatraz: the cell house on the rock, and its lighthouse */
  alcatraz(x: number, y: number): void {
    this.box(x - 27, y - 9, 0, x + 21, y + 6, 22, rgb(0xece8de));
    this.box(x - 27, y - 9, 22, x + 21, y + 6, 25, rgb(0xb9b2a4));
    this.tower(x + 36, y + 12, 3, 3, 0, 42, rgb(0xf2f2f2), false);
    this.box(x + 33.5, y + 9.5, 42, x + 38.5, y + 14.5, 47, rgb(0xffe08a));
  }
}

/** a tower's half-width at a share of its height: wide feet, narrowing fast */
function halfAt(t: number, base: number, power = 1.6): number {
  return base * Math.pow(1 - t, power) + 3;
}

/** a map's landmarks as one mesh (null if it has none), and the areas they stand on */
export function buildLandmarks(map: MapDef): { mesh: THREE.Mesh | null; clear: Area[] } {
  const l = new Landmarks();
  switch (map.id) {
    // as crates/tools/src/cities.rs paints them
    case 'tokyo':
      l.suspensionBridge(map, [2010, 1000], [2570, 470], [0.3, 0.7], 170, rgb(0xf3f4f6), rgb(0xb7bec8)); // the Rainbow Bridge
      l.torii(map, [390, 530]);
      l.lining(map, [1154, 523], [700, 600], 'neon'); // Shibuya
      l.tokyoTower(1525, 430);
      l.skytree(205, 1260);
      l.sensoji(360, 990);
      l.imperialPalace(1300, 1050);
      l.bigSight(2265, 105);
      l.gundam(2560, 120);
      l.fuji(-1400, 2900);
      break;
    case 'nyc':
      l.brooklynTower(map, [1350, 215]);
      l.brooklynTower(map, [1525, 170]);
      l.lining(map, [1050, 1300], [620, 1110], 'neon'); // Times Square
      l.skyscraper(1150, 470, [[30, 138, rgb(0x9fc4dc)], [21, 90, rgb(0xb8d4e6)], [12, 48, rgb(0xcfe2ee)]], 54, rgb(0xd9dde3)); // One World Trade Center
      l.empireState(1100, 830);
      l.chrysler(1240, 1010);
      l.flatiron(820, 510);
      l.rockefellerTree(910, 1300);
      l.ferrisWheel(2560, 260, 60, true, rgb(0xd9433b)); // Coney Island's Wonder Wheel
      l.liberty(330, 60);
      break;
    case 'chicago':
      l.elevatedRail(map, [454, 440]);
      l.willis(700, 1000);
      l.skyscraper(1080, 1300, [[27, 156, rgb(0x3a3c42)], [21, 18, rgb(0x2a2a30)]], 48, rgb(0xd9dde3)); // the John Hancock Center
      l.marinaCity(900, 1240);
      l.bean(1330, 720);
      l.fountain(1030, 520);
      l.ballpark(650, 1330, 92, rgb(0x3b6fd9), true); // Wrigley Field
      l.ballpark(2420, 150, 70, rgb(0x9aa0a8), false); // Soldier Field
      l.ferrisWheel(2860, 1490, 33, true, rgb(0xd9433b)); // Navy Pier
      break;
    case 'london':
      l.towerBridgeAt(map, [1880, 690]);
      l.parliament(660, 780);
      l.bigBen(630, 775);
      l.ferrisWheel(640, 600, 66, true, rgb(0xd9dde3)); // the London Eye
      l.nelson(1300, 230);
      l.stPauls(1150, 1200);
      l.gherkin(1600, 1300);
      l.shard(2180, 440);
      l.whiteTower(2150, 900);
      break;
    case 'paris':
      l.alexandre(map, [953, 574]);
      l.eiffel(600, 360);
      l.arc(1600, 1380);
      l.louvrePyramid(1420, 760);
      l.obelisk(1090, 650);
      l.sacreCoeur(360, 1250);
      l.moulinRouge(560, 1440);
      l.invalides(1330, 340);
      break;
    case 'taipei':
      l.taipei101(1700, 830);
      l.grandHotel(950, 1420);
      l.palaceMuseum(1450, 1470);
      l.gondola(2520, 300, 2840, 820);
      l.redHouse(360, 220);
      l.lining(map, [1800, 200], [950, 170], 'lanterns'); // Shilin Night Market
      break;
    case 'sf':
      // as crates/tools/src/sf.rs paints them
      l.suspensionBridge(map, [655, 1520], [1700, 1462], [0.27, 0.73], 220, rgb(0xc0362c), rgb(0x8f2a22)); // the Golden Gate
      l.suspensionBridge(map, [2560, 1010], [2255, 650], [0.3, 0.7], 150, rgb(0xc9ced6), rgb(0x8a929e)); // the Bay Bridge
      l.transamerica(1950, 700);
      l.coit(1600, 985);
      l.ferryBuilding(2400, 518, 2650, 572);
      l.alcatraz(2690, 1540);
      l.palaceOfFineArts(450, 1290);
      l.oraclePark(2430, 240);
      l.dragonGate(1380, 560);
      l.cableCar(map, [980, 355], [420, 450]);
      break;
  }
  return { mesh: l.b.empty ? null : l.b.mesh(vertexColors()), clear: l.clear };
}

/** the waypoint of the map's track nearest to p */
function nearestWaypoint(map: MapDef, p: V2): V2 {
  let best: V2 = [p[0], p[1]], d = Infinity;
  for (const w of map.waypoints as V2[]) {
    const e = Math.hypot(w[0] - p[0], w[1] - p[1]);
    if (e < d) [best, d] = [w, e];
  }
  return best;
}

/** the waypoints driven from the one nearest `from` to the one nearest `to` */
function waypointsBetween(map: MapDef, from: V2, to: V2): V2[] {
  const w = map.waypoints as V2[];
  const near = (p: V2) => w.reduce((bi, q, i) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(w[bi][0] - p[0], w[bi][1] - p[1]) ? i : bi), 0);
  const out: V2[] = [];
  for (let i = near(from), k = 0; k < w.length; i = (i + 1) % w.length, k++) {
    out.push(w[i]);
    if (i === near(to)) break;
  }
  return out;
}
